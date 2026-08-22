# Live Coordinator (Dev) Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Chat with Coordinator" button on `/support-dev` a real, live connection to the actual `hermes-dev-coordinator` agent — not a simulated description of the role — while every other role/environment on `/support-dev` and `/support-pro` keeps today's simulated chat unchanged.

**Architecture:** Reuse the existing `AgentRequest` → `hermes-bridge` → `hermes` CLI oneshot pipeline that already powers the default profile's chat/dispatch. Add a nullable `profile` column to `AgentRequest`; when set, `hermes-bridge` execs the CLI with `HERMES_HOME` pointed at that profile's directory (already bind-mounted into the bridge container) and `--continue` for a persistent named session, instead of the default profile. A new API route creates these requests; the frontend chat modal polls a new single-request GET endpoint until the reply lands, instead of the old synchronous OpenRouter call.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Prisma, `hermes-bridge/bridge.mjs` (plain Node, no build step), existing `AgentChat`/`AgentCard`/`support-team-page` components from the 2026-08-20 V-Decent Support Team feature.

## Global Constraints

- No test framework exists in this repo — verification is `npx tsc` for TS/TSX files, `node --check` for the plain-JS bridge script, `npx prisma validate` for schema changes, plus a final live check against the deployed app. Do not add a test framework.
- This repo uses `prisma db push --accept-data-loss` on every container boot (`docker-entrypoint.sh`), not migration files (`prisma/migrations/` does not exist). Schema changes are plain edits to `prisma/schema.prisma`.
- Dynamic API route params use the Next 16 async signature: `{ params }: { params: Promise<{ env: string }> }`, then `const { env } = await params;`.
- All new routes are already covered by the existing global auth gate in `src/middleware.ts` (blanket matcher) and its `x-internal-secret` bypass (checked against `INTERNAL_API_SECRET`) — no middleware changes needed.
- This increment wires live chat for **`coordinator` × `dev` only**. The other 9 profiles (apps/edge/infra/verifier × dev/prod, and the prod coordinator) keep using the existing simulated `/api/agent-chat` path, unchanged.
- `hermes -z` (oneshot mode) auto-bypasses Hermes's own per-tool approval prompts — this is the approved, intended behavior for this feature (see design spec's Safety Considerations), not something to add guardrails against in this plan.
- Design spec: `docs/superpowers/specs/2026-08-21-live-coordinator-chat-design.md`.

---

### Task 1: Schema — add `profile` to `AgentRequest`

**Files:**
- Modify: `prisma/schema.prisma:439-458`

**Interfaces:**
- Produces (used by Tasks 2, 4): `AgentRequest.profile` — nullable `String`, e.g. `"vdecent-dev-coordinator"`; `null` means "default profile" (today's unchanged behavior).

- [ ] **Step 1: Add the column**

Current (`prisma/schema.prisma:439-458`):

```prisma
model AgentRequest {
  id            String    @id @default(cuid())
  origin        String    @default("web")     // "web" | "hermes"
  kind          String    @default("oneshot") // "oneshot" | "kanban" | "chat"
  title         String
  prompt        String?
  sideEffecting Boolean   @default(false)
  status        String    @default("queued")  // queued | awaiting_approval | approved | running | done | failed | rejected
  result        String?
  error         String?
  hermesTaskId  String?
  decidedAt     DateTime?
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([status])
  @@index([createdAt])
}
```

Replace with:

```prisma
model AgentRequest {
  id            String    @id @default(cuid())
  origin        String    @default("web")     // "web" | "hermes"
  kind          String    @default("oneshot") // "oneshot" | "kanban" | "chat"
  title         String
  prompt        String?
  profile       String?   // e.g. "vdecent-dev-coordinator"; null = default profile
  sideEffecting Boolean   @default(false)
  status        String    @default("queued")  // queued | awaiting_approval | approved | running | done | failed | rejected
  result        String?
  error         String?
  hermesTaskId  String?
  decidedAt     DateTime?
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([status])
  @@index([createdAt])
}
```

- [ ] **Step 2: Validate and regenerate the Prisma client**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: completes without error; the generated client now has `profile` on `AgentRequest` (needed for Task 4's `npx tsc` to pass).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat: add profile column to AgentRequest

Nullable field identifying which Hermes profile (e.g.
vdecent-dev-coordinator) a chat request targets; null means the
default profile, matching today's unchanged behavior.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 2: Bridge — profile-targeted oneshot exec with session continuity

**Files:**
- Modify: `hermes-bridge/bridge.mjs:60-63` (the `hermes()` helper)
- Modify: `hermes-bridge/bridge.mjs:248-296` (`runRequest()`, specifically the `oneshot`/`chat` branch at line 253)

**Interfaces:**
- Consumes: `AgentRequest.profile` (Task 1).
- Produces: when a `chat`-kind request has a non-null `profile`, the CLI runs with `HERMES_HOME` set to that profile's directory and `--continue "dashboard-<profile>"` for session continuity — instead of the default profile's oneshot.

- [ ] **Step 1: Let the `hermes()` helper accept an env override**

Current (`hermes-bridge/bridge.mjs:60-63`):

```js
async function hermes(args, { timeout = 30000 } = {}) {
  const { stdout } = await execFileP(HERMES, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}
```

Replace with:

```js
async function hermes(args, { timeout = 30000, env } = {}) {
  const { stdout } = await execFileP(HERMES, args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    ...(env ? { env } : {}),
  });
  return stdout;
}
```

- [ ] **Step 2: Add a `profileHome()` helper right after `toDate()`**

Find (`hermes-bridge/bridge.mjs:65-67`):

```js
function toDate(unixSeconds) {
  return unixSeconds != null ? new Date(unixSeconds * 1000) : null;
}
```

Add immediately after it:

```js
function profileHome(profile) {
  return path.join(process.env.HERMES_HOME || path.join(os.homedir(), ".hermes"), "profiles", profile);
}
```

(`path` and `os` are already imported at the top of the file — no new imports needed.)

- [ ] **Step 3: Route profile-targeted chat requests through the new helpers**

Current (`hermes-bridge/bridge.mjs:253-255`):

```js
    if (r.kind === "oneshot" || r.kind === "chat") {
      result = (await hermes(["-z", r.prompt || r.title], { timeout: RUN_TIMEOUT_MS })).trim();
    } else if (r.kind === "kanban") {
```

Replace with:

```js
    if (r.kind === "oneshot" || r.kind === "chat") {
      if (r.kind === "chat" && r.profile) {
        const args = ["-z", r.prompt || r.title, "--continue", `dashboard-${r.profile}`];
        const env = { ...process.env, HERMES_HOME: profileHome(r.profile) };
        result = (await hermes(args, { timeout: RUN_TIMEOUT_MS, env })).trim();
      } else {
        result = (await hermes(["-z", r.prompt || r.title], { timeout: RUN_TIMEOUT_MS })).trim();
      }
    } else if (r.kind === "kanban") {
```

- [ ] **Step 4: Verify the script is syntactically valid**

Run: `node --check hermes-bridge/bridge.mjs`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add hermes-bridge/bridge.mjs
git commit -m "$(cat <<'EOF'
feat: run profile-targeted chat requests as the named Hermes profile

When an AgentRequest carries a profile (e.g. vdecent-dev-coordinator),
hermes-bridge execs the oneshot CLI with HERMES_HOME pointed at that
profile's directory and --continue for a persistent named session,
instead of the default profile. Requests with no profile are
unaffected.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 3: API — GET a single `AgentRequest` by id

**Files:**
- Modify: `src/app/api/hermes/requests/[id]/route.ts`

**Interfaces:**
- Produces (used by Task 6): `GET /api/hermes/requests/:id` → `{ request: AgentRequest }` on success, `{ error: "not found" }` (404) if missing.

- [ ] **Step 1: Add the GET handler**

Current full file:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const action = (b.action || "").toString(); // approve | reject | edit
  const existing = await prisma.agentRequest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["awaiting_approval", "queued"].includes(existing.status))
    return NextResponse.json({ error: `cannot decide a ${existing.status} request` }, { status: 409 });

  const data: Record<string, unknown> = { decidedAt: new Date() };
  if (action === "approve") data.status = "approved";
  else if (action === "reject") data.status = "rejected";
  else if (action === "edit") { data.status = "approved"; if (b.prompt) data.prompt = b.prompt.toString(); if (b.title) data.title = b.title.toString().slice(0, 200); }
  else return NextResponse.json({ error: "action must be approve|reject|edit" }, { status: 400 });

  const row = await prisma.agentRequest.update({ where: { id }, data });
  return NextResponse.json({ request: row });
}
```

Replace with:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await prisma.agentRequest.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ request: row });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const action = (b.action || "").toString(); // approve | reject | edit
  const existing = await prisma.agentRequest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["awaiting_approval", "queued"].includes(existing.status))
    return NextResponse.json({ error: `cannot decide a ${existing.status} request` }, { status: 409 });

  const data: Record<string, unknown> = { decidedAt: new Date() };
  if (action === "approve") data.status = "approved";
  else if (action === "reject") data.status = "rejected";
  else if (action === "edit") { data.status = "approved"; if (b.prompt) data.prompt = b.prompt.toString(); if (b.title) data.title = b.title.toString().slice(0, 200); }
  else return NextResponse.json({ error: "action must be approve|reject|edit" }, { status: 400 });

  const row = await prisma.agentRequest.update({ where: { id }, data });
  return NextResponse.json({ request: row });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/hermes/requests/\[id\]/route.ts
git commit -m "$(cat <<'EOF'
feat: add GET handler for a single AgentRequest

Lets the frontend poll one request's status/result directly instead
of re-fetching the whole recent-requests list.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 4: API — create a live chat `AgentRequest`

**Files:**
- Create: `src/app/api/support-team/[env]/chat/route.ts`

**Interfaces:**
- Consumes: `AgentRequest` model with `profile` (Task 1).
- Produces (used by Task 6): `POST /api/support-team/:env/chat` with body `{ role: string, message: string }` → `{ requestId: string }` (201-equivalent 200 response) on success; `{ error: string }` (400) for an invalid `env`/`role`/empty `message`.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ROLE_IDS = new Set(["coordinator", "apps", "edge", "infra", "verifier"]);

function isVDecentEnv(value: string): value is "dev" | "pro" {
  return value === "dev" || value === "pro";
}

export async function POST(req: Request, { params }: { params: Promise<{ env: string }> }) {
  const { env } = await params;
  if (!isVDecentEnv(env)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

  const b = await req.json().catch(() => ({}));
  const role = (b.role || "").toString();
  const message = (b.message || "").toString().trim();
  if (!ROLE_IDS.has(role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const profile = `vdecent-${env === "dev" ? "dev" : "prod"}-${role}`;
  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: "chat",
      title: message.slice(0, 200),
      prompt: message,
      profile,
      sideEffecting: false,
      status: "queued",
    },
  });
  return NextResponse.json({ requestId: row.id });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/support-team/\[env\]/chat/route.ts
git commit -m "$(cat <<'EOF'
feat: add live chat dispatch route for support-team profiles

POST /api/support-team/:env/chat queues an AgentRequest targeting
vdecent-{env}-{role}, picked up by hermes-bridge and run as that
real Hermes profile.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 5: API + type — mark the dev coordinator as `live`

**Files:**
- Modify: `src/components/agent-card.tsx:9-18` (the `Agent` interface)
- Modify: `src/app/api/support-team/[env]/route.ts`

**Interfaces:**
- Produces (used by Task 6): `Agent.live?: boolean` — `true` only for `{ env: "dev", id: "coordinator" }` this increment; the single toggle point for extending live chat to more profiles later.

- [ ] **Step 1: Add `live` to the `Agent` type**

Current (`src/components/agent-card.tsx:9-18`):

```tsx
export interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  status: "idle" | "working" | "error" | "offline";
  currentTask?: string;
  lastActive?: string;
  tasksCompleted: number;
  totalCost: number;
  recentActivity: AgentActivity[];
}
```

Replace with:

```tsx
export interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  status: "idle" | "working" | "error" | "offline";
  currentTask?: string;
  lastActive?: string;
  tasksCompleted: number;
  totalCost: number;
  recentActivity: AgentActivity[];
  live?: boolean;
}
```

- [ ] **Step 2: Mark the dev coordinator live in the roster route**

Find, near the top of `src/app/api/support-team/[env]/route.ts`, right after the `ROSTER` array and its `ROLE_IDS` set:

```ts
const ROLE_IDS = new Set<string>(ROSTER.map((r) => r.id));
const OPEN_STATUSES = new Set(["todo", "ready", "scheduled"]);
```

Add immediately after it:

```ts
// Single toggle point for going live with more profiles later: "{env}-{roleId}".
const LIVE_PROFILES = new Set<string>(["dev-coordinator"]);
```

Then find the `agents` construction's return object:

```ts
    return {
      id: member.id,
      name: member.name,
      emoji: member.emoji,
      role: member.role,
      status,
      currentTask,
      lastActive,
      tasksCompleted: doneCount,
      totalCost: 0,
      recentActivity,
    };
```

Replace with:

```ts
    return {
      id: member.id,
      name: member.name,
      emoji: member.emoji,
      role: member.role,
      status,
      currentTask,
      lastActive,
      tasksCompleted: doneCount,
      totalCost: 0,
      recentActivity,
      live: LIVE_PROFILES.has(`${env}-${member.id}`),
    };
```

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/agent-card.tsx src/app/api/support-team/\[env\]/route.ts
git commit -m "$(cat <<'EOF'
feat: mark the dev coordinator as a live profile in the roster

Agent.live is true only for {env: "dev", id: "coordinator"} this
increment; extending to more profiles later is adding entries to
LIVE_PROFILES, not new plumbing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 6: Frontend — live chat in the `AgentChat` modal

**Files:**
- Modify: `src/components/agent-chat.tsx`
- Modify: `src/components/support-team-page.tsx`

**Interfaces:**
- Consumes: `POST /api/support-team/:env/chat` and `GET /api/hermes/requests/:id` (Tasks 3, 4); `Agent.live` (Task 5).

- [ ] **Step 1: Add a `sendLive()` helper above the `AgentChat` component**

Current top of `src/components/agent-chat.tsx`:

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import type { Agent } from "@/components/agent-card";

const roleColors: Record<string, string> = {
  max: "from-amber-500/20 to-amber-600/5 border-amber-500/20",
  sage: "from-sky-500/20 to-sky-600/5 border-sky-500/20",
  knox: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/20",
  nova: "from-purple-500/20 to-purple-600/5 border-purple-500/20",
  pixel: "from-blue-500/20 to-blue-600/5 border-blue-500/20",
};

export function AgentChat({ agent, onClose }: { agent: Agent; onClose: () => void }) {
```

Replace with:

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import type { Agent } from "@/components/agent-card";

const roleColors: Record<string, string> = {
  max: "from-amber-500/20 to-amber-600/5 border-amber-500/20",
  sage: "from-sky-500/20 to-sky-600/5 border-sky-500/20",
  knox: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/20",
  nova: "from-purple-500/20 to-purple-600/5 border-purple-500/20",
  pixel: "from-blue-500/20 to-blue-600/5 border-blue-500/20",
};

async function sendLive(env: "dev" | "pro", role: string, message: string): Promise<string> {
  const createRes = await fetch(`/api/support-team/${env}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, message }),
  });
  if (!createRes.ok) throw new Error("dispatch failed");
  const { requestId } = (await createRes.json()) as { requestId: string };

  // Poll up to ~5 minutes (bridge run timeout is 240s) at 2s intervals.
  for (let i = 0; i < 150; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const pollRes = await fetch(`/api/hermes/requests/${requestId}`);
    if (!pollRes.ok) continue;
    const { request } = (await pollRes.json()) as {
      request: { status: string; result: string | null; error: string | null };
    };
    if (request.status === "done") return request.result || "(no response)";
    if (request.status === "failed" || request.status === "rejected") {
      throw new Error(request.error || "request failed");
    }
  }
  throw new Error("timed out waiting for a reply");
}

export function AgentChat({ agent, env, onClose }: { agent: Agent; env: "dev" | "pro"; onClose: () => void }) {
```

- [ ] **Step 2: Branch `send()` on `agent.live`**

Current:

```tsx
  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const newMsgs = [...msgs, { role: "user" as const, content: text }];
    setMsgs(newMsgs);
    setLoading(true);
    try {
      const r = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, message: text, history: msgs }),
      });
      const d = await r.json() as { reply: string };
      setMsgs([...newMsgs, { role: "assistant", content: d.reply }]);
    } catch {
      setMsgs([...newMsgs, { role: "assistant", content: "Sorry, something went wrong. Try again." }]);
    }
    setLoading(false);
  }
```

Replace with:

```tsx
  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const newMsgs = [...msgs, { role: "user" as const, content: text }];
    setMsgs(newMsgs);
    setLoading(true);
    try {
      if (agent.live) {
        const reply = await sendLive(env, agent.id, text);
        setMsgs([...newMsgs, { role: "assistant", content: reply }]);
      } else {
        const r = await fetch("/api/agent-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: agent.id, message: text, history: msgs }),
        });
        const d = await r.json() as { reply: string };
        setMsgs([...newMsgs, { role: "assistant", content: d.reply }]);
      }
    } catch {
      setMsgs([...newMsgs, { role: "assistant", content: "Sorry, something went wrong. Try again." }]);
    }
    setLoading(false);
  }
```

- [ ] **Step 3: Swap the "Simulated" banner for a live one when `agent.live`**

Current:

```tsx
        {/* Simulated notice */}
        <div className="px-4 py-1.5 text-center text-[10px] font-medium tracking-wide uppercase"
          style={{ background: "color-mix(in srgb, var(--warn) 10%, transparent)", color: "var(--warn)", borderBottom: "1px solid var(--line)" }}>
          Simulated — not the live agent
        </div>
```

Replace with:

```tsx
        {/* Simulated / live notice */}
        {agent.live ? (
          <div className="px-4 py-1.5 text-center text-[10px] font-medium tracking-wide uppercase"
            style={{ background: "color-mix(in srgb, var(--up) 10%, transparent)", color: "var(--up)", borderBottom: "1px solid var(--line)" }}>
            Live — connected to hermes-{env}-{agent.id}
          </div>
        ) : (
          <div className="px-4 py-1.5 text-center text-[10px] font-medium tracking-wide uppercase"
            style={{ background: "color-mix(in srgb, var(--warn) 10%, transparent)", color: "var(--warn)", borderBottom: "1px solid var(--line)" }}>
            Simulated — not the live agent
          </div>
        )}
```

- [ ] **Step 4: Set wait-time expectations in the "thinking" bubble**

Current:

```tsx
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-[var(--r-md)] px-3.5 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                <span className="text-[var(--text-3)] text-[13px]">{agent.emoji} thinking…</span>
              </div>
            </div>
          )}
```

Replace with:

```tsx
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-[var(--r-md)] px-3.5 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                <span className="text-[var(--text-3)] text-[13px]">
                  {agent.emoji} {agent.live ? "working — can take a couple of minutes on real diagnostic work…" : "thinking…"}
                </span>
              </div>
            </div>
          )}
```

- [ ] **Step 5: Pass `env` down from `support-team-page.tsx`**

Current (`src/components/support-team-page.tsx`):

```tsx
      {/* Live Agent Chat Modal */}
      {chatAgent && <AgentChat agent={chatAgent} onClose={() => setChatAgent(null)} />}
```

Replace with:

```tsx
      {/* Live Agent Chat Modal */}
      {chatAgent && <AgentChat agent={chatAgent} env={env} onClose={() => setChatAgent(null)} />}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/agent-chat.tsx src/components/support-team-page.tsx
git commit -m "$(cat <<'EOF'
feat: wire the AgentChat modal to the live coordinator (dev)

When Agent.live is true, the chat modal dispatches through the new
support-team chat route and polls for a reply from the real Hermes
profile instead of the simulated OpenRouter call. Every other role
still uses the unchanged simulated path.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 7: Deploy and verify live

**Files:** none (Coolify deployment + live verification only).

**Interfaces:**
- Consumes: all prior tasks' committed code, pushed to `main`.
- Produces: a live, verified live-chat path to `hermes-dev-coordinator`.

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Trigger a deploy and wait for it to finish**

```bash
source ~/.bashrc
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

Poll `GET https://coolify.v-decent.org/api/v1/deployments/{deployment_uuid}` until `status` is `finished`. On success, `prisma db push --accept-data-loss` runs automatically on boot, adding `AgentRequest.profile`.

- [ ] **Step 3: Confirm the schema change landed and `hermes-bridge` is up**

```bash
ssh -o ConnectTimeout=10 vdecentserver0 "docker exec \$(docker ps --filter name=hermy-hq-postgres -q) psql -U hermy -d hermy_hq -c \"\\d \\\"AgentRequest\\\"\"" | grep -i profile
ssh -o ConnectTimeout=10 vdecentserver0 "docker ps --filter name=hermes-bridge --format '{{.Names}}\t{{.Status}}\t{{.Networks}}'"
```

Expected: the first command shows a `profile` column; the second shows one `hermes-bridge-*` container, `Up`, network `host`.

- [ ] **Step 4: Regression-check the default profile's oneshot dispatch still works**

```bash
source ~/.bashrc
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "import json,sys; d=json.load(sys.stdin); print([e['value'] for e in d if not e.get('is_preview') and e['key']=='INTERNAL_API_SECRET'][0])")
curl -sS -X POST "https://dashboard.v-decent.org/api/hermes/dispatch" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"title":"Reply with exactly the word PONG and nothing else."}' | python3 -m json.tool
```

Note the returned request `id`, then poll it:

```bash
REQ_ID=<id from above>
for i in $(seq 1 30); do
  R=$(curl -sS "https://dashboard.v-decent.org/api/hermes/requests/$REQ_ID" -H "x-internal-secret: $SECRET")
  echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin)['request']; print(d['status'], d.get('result') or d.get('error'))"
  echo "$R" | grep -q '"status":"done"' && break
  sleep 5
done
```

Expected: eventually `done`, result containing `PONG` — confirms the bridge's shared `hermes()`/`runRequest()` changes didn't break the default (no-`profile`) path.

- [ ] **Step 5: Functional smoke test — live coordinator chat with session continuity**

```bash
curl -sS -X POST "https://dashboard.v-decent.org/api/support-team/dev/chat" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"role":"coordinator","message":"My name for this test is Kazu. Please confirm you are the V-Decent dev Coordinator and briefly describe your role, then remember my name."}' | python3 -m json.tool
```

Note the returned `requestId`, then poll (same pattern as Step 4, up to ~5 minutes):

```bash
REQ_ID=<requestId from above>
for i in $(seq 1 60); do
  R=$(curl -sS "https://dashboard.v-decent.org/api/hermes/requests/$REQ_ID" -H "x-internal-secret: $SECRET")
  echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin)['request']; print(d['status'])"
  echo "$R" | grep -q '"status":"done"' && { echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['request']['result'])"; break; }
  echo "$R" | grep -q '"status":"failed"' && { echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['request']['error'])"; break; }
  sleep 5
done
```

Expected: `done`, with a result that identifies itself as the V-Decent dev Coordinator (not a generic/default-profile reply).

Now send a second message to the same profile to confirm session continuity works (`--continue` actually resumed the session):

```bash
curl -sS -X POST "https://dashboard.v-decent.org/api/support-team/dev/chat" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"role":"coordinator","message":"What name did I just tell you?"}' | python3 -m json.tool
```

Poll the same way. Expected: the reply correctly recalls "Kazu" — proving the second oneshot resumed the first one's session rather than starting fresh.

Finally, confirm the `profile` column was actually populated on these two rows:

```bash
ssh -o ConnectTimeout=10 vdecentserver0 "docker exec \$(docker ps --filter name=hermy-hq-postgres -q) psql -U hermy -d hermy_hq -c \"SELECT id, profile, status FROM \\\"AgentRequest\\\" WHERE profile IS NOT NULL ORDER BY \\\"createdAt\\\" DESC LIMIT 2;\""
```

Expected: two rows, both `profile = vdecent-dev-coordinator`, `status = done`.

- [ ] **Step 6: Ask the user to visually confirm in the browser**

Report to the user: deployed and live. Ask them to open `/support-dev`, chat with the Coordinator, confirm the modal shows the green "Live — connected to hermes-dev-coordinator" banner (not the amber "Simulated" one), that a real reply arrives (with the "can take a couple of minutes" expectation set), and that a follow-up message in the same chat window shows the coordinator remembers earlier context. Also ask them to chat with any other role (e.g. Apps) and confirm it still shows the amber "Simulated" banner, unaffected.

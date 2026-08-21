# V-Decent Support Team Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's fictional "AI Team" pages with two real pages showing the actual V-Decent Support Team (Coordinator/Apps/Edge/Infra/Verifier), one for Development and one for Production, sourced live from the two Hermes kanban boards the team already uses.

**Architecture:** `hermes-bridge` gains multi-board kanban mirroring (it already mirrors one board into `HermesTask`; extended to mirror three). A new API route reads `HermesTask` filtered by board, derives each team member's status from their task set, and returns the same `Agent` shape the existing (fictional) Agents page already used — so most of that page's UI is reused via extraction, not rewritten. The fictional roster, its API, and its office-view visuals are deleted once the real pages exist.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Prisma, existing `hermes-bridge/bridge.mjs` (plain Node, no build step), existing design system (`@/components/ui/kit` is not used by this feature — it reuses `agents/page.tsx`'s own patterns instead, which predate that kit).

## Global Constraints

- No test framework exists in this repo — verification is TypeScript type-checking (`npx tsc`) for TS/TSX files, `node --check` for the plain-JS bridge script, and `npx prisma validate` for schema changes, plus a final live check against the deployed app. Do not add a test framework.
- This repo uses `prisma db push --accept-data-loss` on every container boot (`docker-entrypoint.sh`), not migration files (`prisma/migrations/` does not exist). Schema changes are plain edits to `prisma/schema.prisma` — no migration file to write.
- Dynamic API route params use the Next 16 async signature: `{ params }: { params: Promise<{ env: string }> }`, then `const { env } = await params;` (established in the earlier V-Decent ops feature).
- All new routes/pages are automatically covered by the existing global auth gate in `src/middleware.ts` (blanket matcher) — no special-casing needed.
- The chat feature (`/api/agent-chat`) is simulated, not a live connection to the real agents — every prompt must say so explicitly and decline to fabricate diagnostic findings. **Deviation from the spec's literal wording:** the spec described 10 new prompt entries (one per role × environment); this plan uses 5 (one per role, environment-agnostic in wording), since a simulated "explain this role" response doesn't need separate Dev/Prod copies — the role's function doesn't change, only its scope, which the single prompt already covers ("whichever environment the operator asks about"). This achieves the identical approved UX (simulated, clearly labeled, no live diagnosis) with less duplication. Flagged here so a reviewer doesn't read this as a missing requirement.
- `Agent.id` for the 5 roster members is role-only (`"coordinator"`, `"apps"`, `"edge"`, `"infra"`, `"verifier"`) — not environment-prefixed. This is what `SupportOfficeView`'s desk layout and the chat prompt lookup key on. The environment is carried by which page/API route is active, not by the id itself.

---

### Task 1: Backend — multi-board kanban mirroring with real timestamps

**Files:**
- Modify: `prisma/schema.prisma:217-229` (the `HermesTask` model)
- Modify: `hermes-bridge/bridge.mjs`

**Interfaces:**
- Produces (used by Task 3): `HermesTask` rows for `board IN ('vdecent-support-dev', 'vdecent-support-prod')`, each with populated `kanbanCreatedAt`/`kanbanStartedAt`/`kanbanCompletedAt` (nullable `DateTime`, converted from the kanban JSON's Unix-seconds fields).

- [ ] **Step 1: Update the `HermesTask` model in `prisma/schema.prisma`**

Current (lines 485-498, per the earlier V-Decent ops plan's line numbers — re-locate by searching for `model HermesTask` if line numbers have drifted):

```prisma
model HermesTask {
  id        String   @id                   // Hermes task id
  board     String   @default("default")
  title     String
  assignee  String?
  status    String   @default("todo")
  priority  Int?
  result    String?
  updatedAt DateTime @default(now())
  syncedAt  DateTime @updatedAt

  @@index([board])
  @@index([status])
}
```

Replace with:

```prisma
model HermesTask {
  id                String    @id                   // Hermes task id
  board             String    @default("default")
  title             String
  assignee          String?
  status            String    @default("todo")
  priority          Int?
  result            String?
  kanbanCreatedAt   DateTime?
  kanbanStartedAt   DateTime?
  kanbanCompletedAt DateTime?
  updatedAt         DateTime  @default(now())
  syncedAt          DateTime  @updatedAt

  @@index([board])
  @@index([status])
}
```

- [ ] **Step 2: Validate the schema and regenerate the Prisma client**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: completes without error; the generated client now has `kanbanCreatedAt`/`kanbanStartedAt`/`kanbanCompletedAt` on `HermesTask` (needed for Task 3's `npx tsc` to pass).

- [ ] **Step 3: Update `hermes-bridge/bridge.mjs` — add the board list and a timestamp helper**

Find this line near the top of the file:

```js
const BOARD = process.env.HERMES_BOARD || "default";
```

Add immediately after it:

```js
const KANBAN_BOARDS = [BOARD, "vdecent-support-dev", "vdecent-support-prod"];
```

Find the `hermes()` helper function and add a new helper right after it:

```js
async function hermes(args, { timeout = 30000 } = {}) {
  const { stdout } = await execFileP(HERMES, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

function toDate(unixSeconds) {
  return unixSeconds != null ? new Date(unixSeconds * 1000) : null;
}
```

- [ ] **Step 4: Parameterize `mirrorKanban()` by board and capture the three timestamps**

Find:

```js
/* ─────────────── PULL: mirror Hermes → Postgres ─────────────── */
async function mirrorKanban() {
  let tasks = [];
  try {
    // NB: this Hermes CLI wants --board BEFORE the subcommand.
    const out = await hermes(["kanban", "--board", BOARD, "list", "--json"], { timeout: 15000 });
    const parsed = JSON.parse(out || "[]");
    tasks = Array.isArray(parsed) ? parsed : parsed.tasks || [];
  } catch (e) { log("kanban list failed:", e.message.split("\n")[0]); return; }

  const seen = new Set();
  for (const t of tasks) {
    const id = String(t.id ?? t.task_id ?? "");
    if (!id) continue;
    seen.add(id);
    await q(
      `INSERT INTO "HermesTask" (id, board, title, assignee, status, priority, result, "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, assignee=EXCLUDED.assignee, status=EXCLUDED.status,
         priority=EXCLUDED.priority, result=EXCLUDED.result, "syncedAt"=now()`,
      [id, BOARD, String(t.title ?? "untitled").slice(0, 300), t.assignee ?? null,
       String(t.status ?? "todo"), t.priority != null ? Number(t.priority) : null,
       t.result ? String(t.result).slice(0, 2000) : null]
    );
  }
  // prune tasks that vanished from the board
  if (seen.size) {
    await q(`DELETE FROM "HermesTask" WHERE board=$1 AND id <> ALL($2::text[])`, [BOARD, [...seen]]);
  } else {
    await q(`DELETE FROM "HermesTask" WHERE board=$1`, [BOARD]);
  }
}
```

Replace with:

```js
/* ─────────────── PULL: mirror Hermes → Postgres ─────────────── */
async function mirrorKanban(board) {
  let tasks = [];
  try {
    // NB: this Hermes CLI wants --board BEFORE the subcommand.
    const out = await hermes(["kanban", "--board", board, "list", "--json"], { timeout: 15000 });
    const parsed = JSON.parse(out || "[]");
    tasks = Array.isArray(parsed) ? parsed : parsed.tasks || [];
  } catch (e) { log(`kanban list failed (${board}):`, e.message.split("\n")[0]); return; }

  const seen = new Set();
  for (const t of tasks) {
    const id = String(t.id ?? t.task_id ?? "");
    if (!id) continue;
    seen.add(id);
    await q(
      `INSERT INTO "HermesTask" (id, board, title, assignee, status, priority, result, "kanbanCreatedAt", "kanbanStartedAt", "kanbanCompletedAt", "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, assignee=EXCLUDED.assignee, status=EXCLUDED.status,
         priority=EXCLUDED.priority, result=EXCLUDED.result,
         "kanbanCreatedAt"=EXCLUDED."kanbanCreatedAt", "kanbanStartedAt"=EXCLUDED."kanbanStartedAt",
         "kanbanCompletedAt"=EXCLUDED."kanbanCompletedAt", "syncedAt"=now()`,
      [id, board, String(t.title ?? "untitled").slice(0, 300), t.assignee ?? null,
       String(t.status ?? "todo"), t.priority != null ? Number(t.priority) : null,
       t.result ? String(t.result).slice(0, 2000) : null,
       toDate(t.created_at), toDate(t.started_at), toDate(t.completed_at)]
    );
  }
  // prune tasks that vanished from the board
  if (seen.size) {
    await q(`DELETE FROM "HermesTask" WHERE board=$1 AND id <> ALL($2::text[])`, [board, [...seen]]);
  } else {
    await q(`DELETE FROM "HermesTask" WHERE board=$1`, [board]);
  }
}
```

- [ ] **Step 5: Loop over all boards in `mirrorTick()`**

Find:

```js
async function mirrorTick() {
  try { await mirrorKanban(); } catch (e) { log("mirrorKanban err", e.message); }
```

Replace with:

```js
async function mirrorTick() {
  try { for (const b of KANBAN_BOARDS) await mirrorKanban(b); } catch (e) { log("mirrorKanban err", e.message); }
```

(Everything else in `mirrorTick()` — `mirrorCrons`, `mirrorHealth`, `mirrorWiki`, `mirrorCost`, `maybeDailyBrief` — is unchanged.)

Leave the `runRequest()` function's kanban-create dispatch (`r.kind === "kanban"`, uses `["kanban", "--board", BOARD, "create", ...]`) exactly as-is — it still targets the single personal `BOARD` for user-dispatched tasks from the command palette, which is unrelated to this feature's read-only mirroring.

- [ ] **Step 6: Syntax-check the script**

Run: `node --check hermes-bridge/bridge.mjs`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma hermes-bridge/bridge.mjs
git commit -m "$(cat <<'EOF'
mirror the two V-Decent support kanban boards into HermesTask

hermes-bridge already mirrors one kanban board (HERMES_BOARD) into
HermesTask, which already has a board column designed for exactly
this. Extends the poll to also mirror vdecent-support-dev and
vdecent-support-prod, and adds three nullable timestamp columns
(kanbanCreatedAt/kanbanStartedAt/kanbanCompletedAt) sourced from the
kanban JSON's real timestamps — HermesTask.updatedAt is never touched
on status transitions, so it can't drive recent-activity ordering.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 2: Extract `AgentCard` and `AgentChat` into shared components

**Files:**
- Create: `src/components/agent-card.tsx`
- Create: `src/components/agent-chat.tsx`
- Modify: `src/app/agents/page.tsx` (imports only — the `AgentsPage` function itself is untouched)

**Interfaces:**
- Produces (used by Tasks 3, 4, 5, 7):
  - `src/components/agent-card.tsx` exports `interface AgentActivity`, `interface Agent`, `const statusConfig`, `function AgentCard({ agent, isExpanded, onToggle })`.
  - `src/components/agent-chat.tsx` exports `function AgentChat({ agent, onClose })`.

- [ ] **Step 1: Create `src/components/agent-card.tsx`**

```tsx
"use client";

export interface AgentActivity {
  timestamp: string;
  action: string;
  result?: string;
}

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

export const statusConfig: Record<string, { color: string; dot: string; label: string; pulse?: boolean }> = {
  idle: { color: "var(--warn)", dot: "var(--warn)", label: "Idle" },
  working: { color: "var(--accent)", dot: "var(--accent)", label: "Working", pulse: true },
  error: { color: "var(--down)", dot: "var(--down)", label: "Error" },
  offline: { color: "var(--text-3)", dot: "var(--text-4)", label: "Offline" },
  online: { color: "var(--up)", dot: "var(--up)", label: "Online", pulse: true },
  active: { color: "var(--up)", dot: "var(--up)", label: "Active", pulse: true },
  mixed: { color: "var(--warn)", dot: "var(--warn)", label: "Partial" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AgentCard({ agent, isExpanded, onToggle }: { agent: Agent; isExpanded: boolean; onToggle: () => void }) {
  const status = statusConfig[agent.status] || statusConfig.offline;

  return (
    <div className="panel panel-interactive overflow-hidden">
      {/* Main card */}
      <div className="p-5 cursor-pointer" onClick={onToggle}>
        <div className="flex items-start gap-3.5">
          {/* Avatar */}
          <div className="w-12 h-12 rounded-[var(--r-md)] flex items-center justify-center text-2xl shrink-0"
            style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
            {agent.emoji}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="relative flex w-2 h-2 shrink-0">
                {status.pulse && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: status.dot }} />}
                <span className="relative inline-flex w-2 h-2 rounded-full" style={{ background: status.dot }} />
              </span>
              <h3 className="text-[14px] font-semibold text-[var(--text)]">{agent.name}</h3>
              <span className="text-[10px] font-medium" style={{ color: status.color }}>{status.label}</span>
            </div>
            <p className="text-[12px] text-[var(--text-3)] mt-1">{agent.role}</p>

            {/* Current task */}
            {agent.currentTask && agent.status === "working" && (
              <p className="text-[12px] mt-2 truncate" style={{ color: "var(--accent)" }}>{agent.currentTask}</p>
            )}
          </div>

          {/* Stats */}
          <div className="text-right shrink-0">
            <div className="num text-[22px] font-semibold text-[var(--text)] leading-none">{agent.tasksCompleted}</div>
            <div className="eyebrow mt-1.5">tasks</div>
            {agent.lastActive && (
              <div className="num text-[10px] text-[var(--text-4)] mt-1">{timeAgo(agent.lastActive)}</div>
            )}
          </div>
        </div>
      </div>

      {/* Expanded activity feed */}
      {isExpanded && (
        <div className="px-5 py-4 space-y-2.5" style={{ borderTop: "1px solid var(--line)" }}>
          <h4 className="eyebrow">Recent Activity</h4>
          {agent.recentActivity.length === 0 ? (
            <p className="text-[12px] text-[var(--text-3)] py-2">No activity yet</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {agent.recentActivity.slice(0, 10).map((activity, i) => (
                <div key={i} className="flex items-start gap-2.5 text-[12px]">
                  <span className="num text-[var(--text-4)] shrink-0 w-14">{timeAgo(activity.timestamp)}</span>
                  <span className="text-[var(--text-2)]">{activity.action}</span>
                  {activity.result && (
                    <span className="text-[var(--text-3)] ml-auto truncate max-w-[200px]">{activity.result}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/agent-chat.tsx`**

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
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<{ role: "user"|"assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

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

  const agentColor = roleColors[agent.id]?.split(" ")[0]?.replace("from-","text-")?.replace("/20","") || "text-[var(--text-3)]";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="elevated w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="text-2xl">{agent.emoji}</div>
          <div>
            <div className="text-[14px] font-semibold text-[var(--text)]">{agent.name}</div>
            <div className="text-[12px] text-[var(--text-3)]">{agent.role}</div>
          </div>
          <button onClick={onClose} className="ml-auto text-[var(--text-3)] hover:text-[var(--text)] transition-colors text-xl leading-none">×</button>
        </div>
        {/* Simulated notice */}
        <div className="px-4 py-1.5 text-center text-[10px] font-medium tracking-wide uppercase"
          style={{ background: "color-mix(in srgb, var(--warn) 10%, transparent)", color: "var(--warn)", borderBottom: "1px solid var(--line)" }}>
          Simulated — not the live agent
        </div>
        {/* Messages */}
        <div className="h-80 overflow-y-auto p-4 space-y-3 flex flex-col" style={{ background: "var(--surface-1)" }}>
          {msgs.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[var(--text-3)] text-[13px] text-center">Ask {agent.name} anything.<br/>They&apos;re ready.</p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[80%] rounded-[var(--r-md)] px-3.5 py-2 text-[13px] leading-relaxed"
                style={m.role === "user"
                  ? { background: "var(--surface-3)", color: "var(--text)" }
                  : { background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
                {m.role === "assistant" && <span className="text-xs mr-1">{agent.emoji}</span>}
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-[var(--r-md)] px-3.5 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                <span className="text-[var(--text-3)] text-[13px]">{agent.emoji} thinking…</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        {/* Input */}
        <div className="flex gap-2 p-3" style={{ borderTop: "1px solid var(--line)" }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
            placeholder={`Message ${agent.name}…`}
            className="flex-1 rounded-full px-4 py-2 text-[13px] text-[var(--text)] focus:outline-none transition-colors"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="btn-primary px-4 py-2 text-[13px]"
          >Send</button>
        </div>
      </div>
    </div>
  );
}
```

(`agentColor` is computed but not referenced in the render — this is a pre-existing unused local from the original `agents/page.tsx`, carried over verbatim. `roleColors` still names the fictional ids; it's harmless dead weight for the new roster's ids (the fallback color applies) and is deleted along with this file's only other caller in Task 7 — not worth touching here.)

- [ ] **Step 3: Update `src/app/agents/page.tsx` to import from the new files**

Replace the file's content from the top through the blank line just before `export default function AgentsPage() {` (i.e. everything up to and not including that line) with:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import OfficeView from "@/components/OfficeView";
import { AgentCard, type Agent } from "@/components/agent-card";
import { AgentChat } from "@/components/agent-chat";

```

Do not change anything from `export default function AgentsPage() {` onward — the page's behavior is identical, just sourcing `AgentCard`/`AgentChat` from their new files instead of defining them inline. (`useRef` is dropped from the React import — it was only used inside the now-extracted `AgentChat`.)

- [ ] **Step 4: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/agent-card.tsx src/components/agent-chat.tsx src/app/agents/page.tsx
git commit -m "$(cat <<'EOF'
extract AgentCard and AgentChat into shared components

Pulls the two fully generic, data-driven pieces of the Agents page
out into their own files so the upcoming real support-team pages can
reuse them instead of duplicating ~250 lines. Also adds a persistent
"Simulated — not the live agent" notice to the chat modal, ahead of
that chat being repurposed for the real team's roles.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 3: `/api/support-team/[env]` route

**Files:**
- Create: `src/app/api/support-team/[env]/route.ts`

**Interfaces:**
- Consumes: `prisma.hermesTask` (Task 1's new columns); `type Agent` from `@/components/agent-card` (Task 2).
- Produces (used by Task 5): `GET /api/support-team/dev` and `GET /api/support-team/pro` return `Agent[]` (5 entries, ids `"coordinator"|"apps"|"edge"|"infra"|"verifier"`). Any other `env` value returns `{ error: "invalid environment" }` with HTTP 400.

- [ ] **Step 1: Write `src/app/api/support-team/[env]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Agent } from "@/components/agent-card";

export const dynamic = "force-dynamic";

type RoleId = "coordinator" | "apps" | "edge" | "infra" | "verifier";

interface RosterEntry {
  id: RoleId;
  name: string;
  emoji: string;
  role: string;
}

const ROSTER: RosterEntry[] = [
  { id: "coordinator", name: "Coordinator", emoji: "🧭", role: "Coordinates incidents, delegates diagnosis, and owns traceable reports." },
  { id: "apps", name: "Apps", emoji: "📦", role: "Diagnoses applications, APIs, deployments, and databases." },
  { id: "edge", name: "Edge", emoji: "🌐", role: "Diagnoses Coolify, Cloudflare, DNS, tunnels, and reverse-proxy routing." },
  { id: "infra", name: "Infra", emoji: "🖥️", role: "Diagnoses nodes, Docker, Sentinel, and runtime health." },
  { id: "verifier", name: "Verifier", emoji: "🔍", role: "Independently verifies evidence, mitigations, and report completeness." },
];
const ROLE_IDS = new Set<string>(ROSTER.map((r) => r.id));
const OPEN_STATUSES = new Set(["todo", "ready", "scheduled"]);

function isVDecentEnv(value: string): value is "dev" | "pro" {
  return value === "dev" || value === "pro";
}

interface TaskLike {
  title: string;
  status: string;
  kanbanCreatedAt: Date | null;
  kanbanStartedAt: Date | null;
  kanbanCompletedAt: Date | null;
}

function taskTimestamp(t: TaskLike): number {
  const d = t.kanbanCompletedAt ?? t.kanbanStartedAt ?? t.kanbanCreatedAt;
  return d ? d.getTime() : 0;
}

export async function GET(_req: Request, { params }: { params: Promise<{ env: string }> }) {
  const { env } = await params;
  if (!isVDecentEnv(env)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

  const board = env === "dev" ? "vdecent-support-dev" : "vdecent-support-prod";
  const assigneePrefix = env === "dev" ? "vdecent-dev-" : "vdecent-prod-";

  const tasks = await prisma.hermesTask.findMany({ where: { board } });

  const byRole = new Map<RoleId, typeof tasks>();
  for (const t of tasks) {
    if (!t.assignee || !t.assignee.startsWith(assigneePrefix)) continue;
    const roleId = t.assignee.slice(assigneePrefix.length);
    if (!ROLE_IDS.has(roleId)) continue;
    const list = byRole.get(roleId as RoleId) ?? [];
    list.push(t);
    byRole.set(roleId as RoleId, list);
  }

  const agents: Agent[] = ROSTER.map((member) => {
    const memberTasks = byRole.get(member.id) ?? [];
    const byRecency = [...memberTasks].sort((a, b) => taskTimestamp(b) - taskTimestamp(a));

    const running = memberTasks.find((t) => t.status === "running");
    const openSorted = memberTasks
      .filter((t) => OPEN_STATUSES.has(t.status))
      .sort((a, b) => taskTimestamp(a) - taskTimestamp(b));
    const oldestOpen = openSorted[0];
    const blocked = memberTasks.find((t) => t.status === "blocked");
    const doneCount = memberTasks.filter((t) => t.status === "done").length;

    const status: Agent["status"] = running ? "working" : oldestOpen ? "idle" : blocked ? "error" : "idle";
    const currentTask = running?.title ?? oldestOpen?.title ?? undefined;

    const recentActivity = byRecency.slice(0, 10).map((t) => ({
      timestamp: new Date(taskTimestamp(t)).toISOString(),
      action: t.title,
      result: t.status,
    }));

    const lastActive = byRecency.length && taskTimestamp(byRecency[0])
      ? new Date(taskTimestamp(byRecency[0])).toISOString()
      : undefined;

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
  });

  return NextResponse.json(agents);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/support-team/[env]/route.ts"
git commit -m "$(cat <<'EOF'
add /api/support-team/[env] route

Derives each of the 5 real support-team members' status from their
HermesTask rows on the matching kanban board (running task = working,
queued task = idle, only-blocked = error), returning the same Agent
shape the Agents page's UI already expects.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 4: `SupportOfficeView` component

**Files:**
- Create: `src/components/SupportOfficeView.tsx`

**Interfaces:**
- Consumes: `type Agent`, `type AgentActivity` from `@/components/agent-card` (Task 2).
- Produces (used by Task 5): `export default function SupportOfficeView({ agents, teamLabel }: { agents: Agent[]; teamLabel: string })`.

- [ ] **Step 1: Write `src/components/SupportOfficeView.tsx`**

```tsx
"use client";

import { useState, useEffect } from "react";
import type { Agent } from "@/components/agent-card";

// ── Desk layout ───────────────────────────────────────────
const DESK_LAYOUT = [
  { agentId: "coordinator", label: "Incident Command", zone: "lead" },
  { agentId: "apps",        label: "Apps Desk",         zone: "team" },
  { agentId: "edge",        label: "Edge Desk",         zone: "team" },
  { agentId: "infra",       label: "Infra Desk",        zone: "team" },
  { agentId: "verifier",    label: "Verification Desk", zone: "team" },
];

// ── Status → visual config ────────────────────────────────
const STATUS: Record<string, { glow: string; dot: string; bg: string; ring?: string }> = {
  working:   { glow: "shadow-[0_0_24px_6px_rgba(56,189,248,0.45)]",  dot: "bg-sky-400",     bg: "bg-sky-900/30 border-sky-500/40",     ring: "rgba(56,189,248,0.5)" },
  idle:      { glow: "shadow-[0_0_12px_2px_rgba(251,191,36,0.2)]",   dot: "bg-yellow-400",  bg: "bg-yellow-900/20 border-yellow-500/30" },
  error:     { glow: "shadow-[0_0_12px_2px_rgba(248,113,113,0.3)]",  dot: "bg-red-400",     bg: "bg-red-900/20 border-red-500/30" },
  offline:   { glow: "",                                               dot: "bg-neutral-600", bg: "bg-neutral-800/20 border-neutral-700/20" },
  online:    { glow: "shadow-[0_0_16px_3px_rgba(52,211,153,0.3)]",   dot: "bg-emerald-400", bg: "bg-emerald-900/20 border-emerald-500/30" },
  active:    { glow: "shadow-[0_0_16px_3px_rgba(52,211,153,0.3)]",   dot: "bg-emerald-400", bg: "bg-emerald-900/20 border-emerald-500/30" },
  completed: { glow: "shadow-[0_0_12px_2px_rgba(251,191,36,0.2)]",   dot: "bg-yellow-400",  bg: "bg-yellow-900/20 border-yellow-500/30" },
};

// ── Per-agent walk timing (keeps them out of sync) ────────
const WALK = {
  coordinator: { wanderDur: "14s", bobDur: "0.35s", bobDelay: "0s",    wanderDelay: "0s" },
  apps:        { wanderDur: "8s",  bobDur: "0.40s", bobDelay: "0.1s",  wanderDelay: "1.2s" },
  edge:        { wanderDur: "11s", bobDur: "0.45s", bobDelay: "0.2s",  wanderDelay: "2.5s" },
  infra:       { wanderDur: "9s",  bobDur: "0.38s", bobDelay: "0.05s", wanderDelay: "0.7s" },
  verifier:    { wanderDur: "12s", bobDur: "0.42s", bobDelay: "0.15s", wanderDelay: "3.1s" },
};

// ── Pixel art sprites ─────────────────────────────────────
// No custom sprites yet for the real roster — PixelSprite falls back to a
// generic 🤖 for any id with no entry here. Add an entry the same shape as
// this record to give a role custom pixel art later.
const SPRITE_DATA: Record<string, { palette: Record<string, string>; rows: string[] }> = {};

function PixelSprite({ agentId, size }: { agentId: string; size: number }) {
  const data = SPRITE_DATA[agentId];
  if (!data) return <span style={{ fontSize: size * 0.6 }}>🤖</span>;
  const { palette, rows } = data;
  const gw = rows[0]?.length ?? 16;
  const gh = rows.length;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${gw} ${gh}`} style={{ imageRendering: "pixelated" }}>
      {rows.map((row, y) =>
        row.split("").map((char, x) => {
          const color = char === "." ? null : palette[char];
          return color ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} /> : null;
        })
      )}
    </svg>
  );
}

// ── Activity bubble ───────────────────────────────────────
function ActivityBubble({ text, delay }: { text: string; delay: string }) {
  const short = text.length > 52 ? text.slice(0, 52) + "…" : text;
  return (
    <div
      className="absolute -top-12 left-1/2 z-20 pointer-events-none"
      style={{
        transform: "translateX(-50%)",
        animation: `bubble-cycle 8s ${delay} infinite`,
        opacity: 0,
        minWidth: 100,
        maxWidth: 160,
      }}
    >
      <div className="bg-neutral-800/90 border border-neutral-600/60 rounded-xl px-2.5 py-1.5 text-[9px] text-neutral-200 leading-snug shadow-lg">
        {short}
      </div>
      {/* Tail */}
      <div className="mx-auto w-2 h-2 overflow-hidden" style={{ marginTop: -1 }}>
        <div className="w-2 h-2 bg-neutral-700/80 rotate-45 origin-top-left scale-75 ml-[3px]" />
      </div>
    </div>
  );
}

// ── Animated monitor screen ───────────────────────────────
function MonitorScreen({ isWorking }: { isWorking: boolean }) {
  return (
    <div
      className={`w-10 h-7 rounded border flex flex-col gap-0.5 p-1 overflow-hidden
        ${isWorking ? "border-sky-500/60 bg-sky-950/60" : "border-neutral-600/40 bg-neutral-800/60"}`}
      style={isWorking ? { animation: "screen-flicker 1.2s infinite" } : undefined}
    >
      {isWorking ? (
        <>
          <div className="h-px bg-sky-400/80 rounded" style={{ width: "90%" }} />
          <div className="h-px bg-sky-300/50 rounded" style={{ width: "60%" }} />
          <div className="h-px bg-emerald-400/60 rounded" style={{ width: "75%" }} />
          <div className="h-px bg-sky-400/70 rounded" style={{ width: "40%" }} />
          <div className="h-px bg-sky-300/50 rounded" style={{ width: "85%" }} />
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-1 h-1 rounded-full bg-neutral-600/60" />
        </div>
      )}
    </div>
  );
}

// ── Agent desk tile ───────────────────────────────────────
function AgentDesk({ agent, label, isLead }: { agent: Agent | undefined; label: string; isLead: boolean }) {
  const rawStatus = agent?.status ?? "offline";
  const statusKey = STATUS[rawStatus] ? rawStatus : "idle";
  const colors = STATUS[statusKey];
  const isWorking = rawStatus === "working";
  const isOffline = rawStatus === "offline" || !agent;
  const spriteSize = isLead ? 56 : 44;
  const walk = WALK[agent?.id as keyof typeof WALK] ?? WALK.apps;

  // Pick bubble text: currentTask > last activity > null
  const bubbleText = agent?.currentTask
    || agent?.recentActivity?.[0]?.action
    || null;

  // Bubble cycle delay — stagger so not all pop at once
  const bubbleDelay = isLead ? "0.5s" : walk.wanderDelay;

  return (
    <div className="relative flex flex-col items-center gap-2">
      {/* Desk tile */}
      <div
        className={`relative rounded-2xl border overflow-visible transition-all duration-500
          ${isLead ? "w-44 h-44" : "w-36 h-36"}
          ${colors.bg} ${colors.glow}
          ${isOffline ? "opacity-40" : ""}
          hover:scale-105 hover:z-10`}
        style={isWorking ? { animation: "status-ring 1.5s infinite" } : undefined}
      >
        {/* Desk surface */}
        <div className={`absolute bottom-3 left-3 right-3 h-1/3 rounded-lg
          ${isOffline ? "bg-neutral-700/30" : "bg-neutral-800/50"} border-t border-neutral-700/40`}>
          {/* Monitor */}
          {!isOffline && (
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0">
              <MonitorScreen isWorking={isWorking} />
              <div className="w-3 h-1 bg-neutral-600/50" />
              <div className="w-5 h-0.5 bg-neutral-600/50 rounded" />
            </div>
          )}
        </div>

        {/* Avatar + walking animation */}
        <div className="absolute top-2 left-0 right-0 flex flex-col items-center">
          {/* Activity bubble lives OUTSIDE the flip wrapper so it never mirrors */}
          <div className="relative w-full flex justify-center">
            {bubbleText && !isOffline && (
              <ActivityBubble text={bubbleText} delay={bubbleDelay} />
            )}
          </div>

          {/* Horizontal wander wrapper */}
          <div
            style={
              isWorking
                ? { animation: `agent-type 0.55s ease-in-out infinite` }
                : isOffline
                ? undefined
                : { animation: `agent-wander ${walk.wanderDur} ${walk.wanderDelay} infinite ease-in-out` }
            }
          >
            {/* Vertical bob wrapper */}
            <div
              style={
                !isOffline && !isWorking
                  ? { animation: `agent-bob ${walk.bobDur} ${walk.bobDelay} infinite ease-in-out` }
                  : undefined
              }
            >
              <PixelSprite agentId={agent?.id ?? ""} size={spriteSize} />
            </div>
          </div>

          {/* Name + status dot */}
          <div className="flex items-center gap-1 mt-1">
            <div className={`w-1.5 h-1.5 rounded-full ${colors.dot} ${isWorking ? "animate-pulse" : ""}`} />
            <span className={`text-[10px] font-bold tracking-wider uppercase ${isOffline ? "text-neutral-600" : "text-white/80"}`}>
              {agent?.name ?? "Empty"}
            </span>
          </div>
        </div>

        {/* Tasks badge */}
        {agent && agent.tasksCompleted > 0 && (
          <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-neutral-700 border border-neutral-600 flex items-center justify-center z-10">
            <span className="text-[9px] font-bold text-white">{agent.tasksCompleted > 99 ? "99+" : agent.tasksCompleted}</span>
          </div>
        )}
      </div>

      {/* Label */}
      <div className="text-center">
        <div className={`text-[10px] uppercase tracking-wider ${isOffline ? "text-neutral-700" : "text-neutral-500"}`}>{label}</div>
        {agent?.role && <div className="text-[10px] text-neutral-600 truncate max-w-[140px]">{agent.role}</div>}
      </div>
    </div>
  );
}

// ── Scrolling activity ticker ─────────────────────────────
function ActivityTicker({ agents }: { agents: Agent[] }) {
  const events = agents
    .flatMap(a => (a.recentActivity ?? []).slice(0, 2).map(ev => ({ name: a.name, emoji: a.emoji, action: ev.action })))
    .slice(0, 8);

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (events.length === 0) return;
    const t = setInterval(() => setIdx(i => (i + 1) % events.length), 4000);
    return () => clearInterval(t);
  }, [events.length]);

  if (events.length === 0) return null;
  const ev = events[idx];

  return (
    <div className="flex items-center gap-2 bg-neutral-900/60 border border-neutral-800/40 rounded-xl px-4 py-2 max-w-xl mx-auto">
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
      <span className="text-[10px] text-neutral-500 font-mono shrink-0">{ev.name}</span>
      <span className="text-[10px] text-neutral-400 truncate">{ev.action.slice(0, 80)}</span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────
export default function SupportOfficeView({ agents, teamLabel }: { agents: Agent[]; teamLabel: string }) {
  const getAgent = (id: string) => agents.find(a => a.id === id);
  const leadAgent = getAgent("coordinator");
  const teamDesks = DESK_LAYOUT.filter(d => d.agentId !== "coordinator");

  return (
    <div className="relative rounded-3xl overflow-hidden border border-neutral-800/60 bg-neutral-950/80">
      {/* Floor */}
      <div
        className="relative p-8"
        style={{
          background:
            "repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,0.02) 39px,rgba(255,255,255,0.02) 40px)," +
            "repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,0.02) 39px,rgba(255,255,255,0.02) 40px)",
        }}
      >
        {/* Office sign */}
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center gap-3 bg-neutral-900/80 border border-neutral-700/40 rounded-2xl px-5 py-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono font-bold tracking-[0.2em] text-neutral-400 uppercase">
              {teamLabel}
            </span>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
        </div>

        {/* Desks */}
        <div className="flex flex-col items-center gap-8">
          {/* Row 1 — lead */}
          <AgentDesk agent={leadAgent} label="Incident Command" isLead={true} />
          <div className="w-px h-4 bg-neutral-700/60" />
          {/* Row 2 — Team */}
          <div className="flex flex-wrap justify-center gap-6 md:gap-8">
            {teamDesks.map(desk => (
              <AgentDesk key={desk.agentId} agent={getAgent(desk.agentId)} label={desk.label} isLead={false} />
            ))}
          </div>
        </div>

        {/* Activity ticker */}
        <div className="mt-8">
          <ActivityTicker agents={agents} />
        </div>

        {/* Floor props */}
        <div className="mt-4 flex items-center justify-center gap-6 opacity-20">
          <span className="text-2xl select-none">🌿</span>
          <div className="flex items-center gap-1">
            <span className="text-xl">☕</span>
            <span className="text-[10px] text-neutral-500 font-mono">FUEL STATION</span>
          </div>
          <span className="text-2xl select-none">🌿</span>
        </div>
      </div>

      {/* Legend */}
      <div className="border-t border-neutral-800/60 px-6 py-3 flex items-center gap-6 flex-wrap">
        {[
          { status: "working", label: "Working" },
          { status: "idle",    label: "Idle" },
          { status: "offline", label: "Offline" },
          { status: "error",   label: "Error" },
        ].map(({ status, label }) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${STATUS[status]?.dot ?? "bg-neutral-600"}`} />
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/SupportOfficeView.tsx
git commit -m "$(cat <<'EOF'
add SupportOfficeView for the real support-team roster

Same visual engine as the fictional team's OfficeView (pixel sprites,
desk tiles, activity bubbles, ticker), retargeted at the 5 real
roles with Coordinator in the lead position. No custom pixel art yet
for the new ids — falls back to a generic robot emoji, same fallback
the original component already had.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 5: `SupportTeamPage` shared component

**Files:**
- Create: `src/components/support-team-page.tsx`

**Interfaces:**
- Consumes: `AgentCard`, `type Agent` from `@/components/agent-card` (Task 2); `AgentChat` from `@/components/agent-chat` (Task 2); `SupportOfficeView` from `@/components/SupportOfficeView` (Task 4); fetches `GET /api/support-team/${env}` (Task 3).
- Produces (used by Task 6): `export function SupportTeamPage({ env, title }: { env: "dev" | "pro"; title: string })`.

- [ ] **Step 1: Write `src/components/support-team-page.tsx`**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import SupportOfficeView from "@/components/SupportOfficeView";
import { AgentCard, type Agent } from "@/components/agent-card";
import { AgentChat } from "@/components/agent-chat";

export function SupportTeamPage({ env, title }: { env: "dev" | "pro"; title: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "office">("office");
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch(`/api/support-team/${env}`);
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : []);
    } catch {}
    setLoading(false);
  }, [env]);

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 10000); // poll every 10s
    return () => clearInterval(interval);
  }, [loadAgents]);

  if (loading) {
    return (
      <div className="relative min-h-screen p-8">
        <div className="relative z-10 w-full mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="sk h-32 rounded-[var(--r-lg)]" />)}
        </div>
      </div>
    );
  }

  const leadAgent = agents.find(a => a.id === "coordinator");
  const teamAgents = agents.filter(a => a.id !== "coordinator");
  const online = agents.filter(a => a.status !== "offline").length;
  const working = agents.filter(a => a.status === "working").length;
  const totalTasks = agents.reduce((sum, a) => sum + a.tasksCompleted, 0);

  return (
    <>
      <div className="relative z-10 w-full mx-auto text-[var(--text)] p-8 pb-16 space-y-8">
      {/* Header */}
      <div className="hq-rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2.5">V-Decent Support</div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">{title}</h1>
          <p className="text-[13px] text-[var(--text-3)] mt-3">Live from the vdecent-support-{env === "dev" ? "dev" : "prod"} kanban board</p>
        </div>
        <div className="flex items-center gap-6">
          {/* Stats */}
          <div className="flex gap-7 text-center">
            <div>
              <div className="num text-[22px] font-semibold leading-none" style={{ color: "var(--up)" }}>{online}<span className="text-[var(--text-4)]">/{agents.length}</span></div>
              <div className="eyebrow mt-1.5">Online</div>
            </div>
            <div>
              <div className="num text-[22px] font-semibold leading-none" style={{ color: "var(--accent)" }}>{working}</div>
              <div className="eyebrow mt-1.5">Working</div>
            </div>
            <div>
              <div className="num text-[22px] font-semibold leading-none text-[var(--text)]">{totalTasks}</div>
              <div className="eyebrow mt-1.5">Total Tasks</div>
            </div>
          </div>
          {/* View toggle */}
          <div className="flex rounded-full p-1 gap-1" style={{ border: "1px solid var(--line)" }}>
            <button
              onClick={() => setView("office")}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                view === "office"
                  ? "bg-white/[0.08] text-[var(--text)]"
                  : "text-[var(--text-3)] hover:text-[var(--text-2)]"
              }`}
            >
              Office
            </button>
            <button
              onClick={() => setView("cards")}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                view === "cards"
                  ? "bg-white/[0.08] text-[var(--text)]"
                  : "text-[var(--text-3)] hover:text-[var(--text-2)]"
              }`}
            >
              Cards
            </button>
          </div>
        </div>
      </div>

      {/* Live Agent Chat Modal */}
      {chatAgent && <AgentChat agent={chatAgent} onClose={() => setChatAgent(null)} />}

      {/* Office View */}
      {view === "office" && (
        <>
          <SupportOfficeView agents={agents} teamLabel={`${title} · Support Floor`} />
          {/* Chat quick-launch strip */}
          <div className="flex flex-wrap gap-2 pt-2">
            {teamAgents.map(a => (
              <button key={a.id} onClick={() => setChatAgent(a)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] text-[var(--text-2)] transition-colors panel-interactive"
                style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
                <span>{a.emoji}</span> Chat with {a.name}
              </button>
            ))}
            {leadAgent && (
              <button onClick={() => setChatAgent(leadAgent)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] transition-colors"
                style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 28%, transparent)" }}>
                🧭 Chat with {leadAgent.name}
              </button>
            )}
          </div>
        </>
      )}

      {/* Cards View */}
      {view === "cards" && (
        <>
          {/* Coordinator — full width */}
          {leadAgent && (
            <AgentCard
              agent={leadAgent}
              isExpanded={expandedAgent === leadAgent.id}
              onToggle={() => setExpandedAgent(expandedAgent === leadAgent.id ? null : leadAgent.id)}
            />
          )}

          {/* Team grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teamAgents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isExpanded={expandedAgent === agent.id}
                onToggle={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
              />
            ))}
          </div>

          {/* Org chart visual */}
          <div className="pt-6" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="eyebrow mb-5">Team Structure</div>
            <div className="flex flex-col items-center gap-2">
              {leadAgent && (
                <div className="flex items-center gap-2.5 rounded-[var(--r-md)] px-4 py-2.5"
                  style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 24%, transparent)" }}>
                  <span className="text-xl">{leadAgent.emoji}</span>
                  <div>
                    <div className="text-[13px] font-semibold text-[var(--text)]">{leadAgent.name}</div>
                    <div className="text-[10px] text-[var(--text-3)]">{leadAgent.role}</div>
                  </div>
                </div>
              )}
              <div className="w-px h-6" style={{ background: "var(--line-strong)" }} />
              <div className="flex items-center gap-0">
                <div className="w-32 h-px" style={{ background: "var(--line-strong)" }} />
                <div className="w-px h-4" style={{ background: "var(--line-strong)" }} />
                <div className="w-32 h-px" style={{ background: "var(--line-strong)" }} />
                <div className="w-px h-4" style={{ background: "var(--line-strong)" }} />
                <div className="w-32 h-px" style={{ background: "var(--line-strong)" }} />
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                {teamAgents.map(agent => (
                  <div key={agent.id} className="flex items-center gap-2.5 rounded-[var(--r-md)] px-3.5 py-2.5"
                    style={{ background: "var(--surface-1)", border: "1px solid var(--line)", opacity: agent.status === "offline" ? 0.5 : 1 }}>
                    <span className="text-lg">{agent.emoji}</span>
                    <div>
                      <div className="text-[12px] font-semibold text-[var(--text)]">{agent.name}</div>
                      <div className="text-[10px] text-[var(--text-3)]">{agent.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/support-team-page.tsx
git commit -m "$(cat <<'EOF'
add shared SupportTeamPage component

Same structure as the fictional Agents page (Office/Cards toggle,
org chart, chat), parameterized by environment and fetching real
data from /api/support-team/[env] instead of the fictional roster.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 6: `/support-dev` and `/support-pro` pages

**Files:**
- Create: `src/app/support-dev/page.tsx`
- Create: `src/app/support-pro/page.tsx`

**Interfaces:**
- Consumes: `SupportTeamPage` from `@/components/support-team-page` (Task 5).
- Produces: routes `/support-dev` and `/support-pro`, referenced by Task 8 (nav).

- [ ] **Step 1: Write `src/app/support-dev/page.tsx`**

```tsx
import { SupportTeamPage } from "@/components/support-team-page";

export default function SupportDevPage() {
  return <SupportTeamPage env="dev" title="Development" />;
}
```

- [ ] **Step 2: Write `src/app/support-pro/page.tsx`**

```tsx
import { SupportTeamPage } from "@/components/support-team-page";

export default function SupportProPage() {
  return <SupportTeamPage env="pro" title="Production" />;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/support-dev/page.tsx src/app/support-pro/page.tsx
git commit -m "$(cat <<'EOF'
add /support-dev and /support-pro pages

Thin page files delegating to the shared SupportTeamPage component.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 7: Delete the fictional agents feature; repurpose the chat prompts

**Files:**
- Delete: `src/app/agents/page.tsx` (and the now-empty `src/app/agents/` directory)
- Delete: `src/app/api/agents/route.ts` (and the now-empty `src/app/api/agents/` directory)
- Delete: `src/components/OfficeView.tsx`
- Modify: `prisma/schema.prisma` (remove the `AgentState` model)
- Modify: `prisma/seed.ts` (remove `seedAgentState()` and its call)
- Modify: `src/app/api/agent-chat/route.ts` (replace `AGENT_PROMPTS`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks — the only remaining code task after this is nav (Task 8).

Verified during design: nothing outside `src/app/agents/` and `src/app/api/agents/` references `AgentState`, `/api/agents`, or `/api/agent-chat` (`grep -rln '"/api/agents"' src` and equivalents for `AgentState`/`/api/agent-chat` outside those two directories both returned empty).

- [ ] **Step 1: Delete the fictional page, its API, and OfficeView**

```bash
git rm -r src/app/agents src/app/api/agents src/components/OfficeView.tsx
```

- [ ] **Step 2: Remove the `AgentState` model from `prisma/schema.prisma`**

Find and delete this block entirely (including the blank line that follows it):

```prisma
model AgentState {
  id             String    @id
  name           String
  emoji          String?
  role           String?
  status         String    @default("offline")
  lastActive     DateTime?
  tasksCompleted Int       @default(0)
  totalCost      Float     @default(0)
  currentTask    String?
  recentActivity Json?     @default("[]")
  updatedAt      DateTime  @updatedAt
}

```

- [ ] **Step 3: Remove `seedAgentState()` from `prisma/seed.ts`**

Delete this entire function (currently right before `seedContentCalendar`):

```ts
async function seedAgentState() {
  const raw = readJson('agent-state.json') as any[]
  if (!raw) return
  console.log(`🤖 Seeding ${raw.length} agent states...`)

  for (const d of raw) {
    await prisma.agentState.upsert({
      where: { id: d.id },
      update: {
        name: d.name,
        emoji: d.emoji ?? null,
        role: d.role ?? null,
        status: d.status ?? 'offline',
        lastActive: d.lastActive ? safeDate(d.lastActive) : null,
        tasksCompleted: d.tasksCompleted ?? 0,
        totalCost: d.totalCost ?? 0,
        currentTask: d.currentTask ?? null,
        recentActivity: d.recentActivity ?? [],
        updatedAt: new Date(),
      },
      create: {
        id: d.id,
        name: d.name,
        emoji: d.emoji ?? null,
        role: d.role ?? null,
        status: d.status ?? 'offline',
        lastActive: d.lastActive ? safeDate(d.lastActive) : null,
        tasksCompleted: d.tasksCompleted ?? 0,
        totalCost: d.totalCost ?? 0,
        currentTask: d.currentTask ?? null,
        recentActivity: d.recentActivity ?? [],
        updatedAt: new Date(),
      },
    })
  }
  console.log(`  ✅ ${raw.length} agent states done`)
}

```

Then, in `async function main()`, delete the line that calls it:

```ts
  await seedAgentState()
```

- [ ] **Step 4: Replace `AGENT_PROMPTS` in `src/app/api/agent-chat/route.ts`**

Find:

```ts
const AGENT_PROMPTS: Record<string, string> = {
  max: "You are Max 🐺, an AI executive assistant and COO-level strategist helping the user run their business. The user is a founder and content creator who runs AI trading bots. Be sharp, concise, strategic. Give real actionable advice.",
  sage: "You are Sage 🌿, X/Twitter content specialist for the user. You write viral tweets in their voice — conversational, sharp, specific. Focus on hooks that make people stop scrolling. No fluff.",
  knox: "You are Knox 🔐, operations and trading analyst for the user. You analyze Polymarket and Hyperliquid trading performance, spot patterns, suggest strategy improvements. Be data-driven and direct.",
  nova: "You are Nova ⭐, YouTube strategy specialist for the user. You write scripts, hooks, thumbnails, titles. Think Mr Beast structure applied to the user's niche.",
  pixel: "You are Pixel 🎨, web app product specialist for the user's products. You find UX improvements, feature ideas, competitor gaps. Think product manager + growth hacker.",
};
```

Replace with:

```ts
const AGENT_PROMPTS: Record<string, string> = {
  coordinator: "You are describing the Coordinator role on the V-Decent Support team, to the operator. You are not the real agent and have no access to real incident data or system state. In your own words, explain that this role coordinates incidents (Development/PoC or Production, whichever the operator asks about), assigns incident IDs, delegates diagnosis to the Apps/Edge/Infra specialists, and requires independent verification before closing an incident. If asked to diagnose, check status, or take any action, decline and point at the kanban board on this page for real status instead of guessing.",
  apps: "You are describing the Apps role on the V-Decent Support team, to the operator. You are not the real agent and have no access to real incident data or system state. In your own words, explain that this role diagnoses applications, APIs, deployments, and databases — establishing the deployed commit/image/config before treating source code as evidence, and recommending the smallest reversible fix. If asked to diagnose, check status, or take any action, decline and point at the kanban board on this page for real status instead of guessing.",
  edge: "You are describing the Edge role on the V-Decent Support team, to the operator. You are not the real agent and have no access to real incident data or system state. In your own words, explain that this role diagnoses Coolify, Cloudflare, DNS, tunnels, and reverse-proxy routing issues. If asked to diagnose, check status, or take any action, decline and point at the kanban board on this page for real status instead of guessing.",
  infra: "You are describing the Infra role on the V-Decent Support team, to the operator. You are not the real agent and have no access to real incident data or system state. In your own words, explain that this role diagnoses nodes, Docker, Sentinel, resources, networking, and runtime health. If asked to diagnose, check status, or take any action, decline and point at the kanban board on this page for real status instead of guessing.",
  verifier: "You are describing the Verifier role on the V-Decent Support team, to the operator. You are not the real agent and have no access to real incident data or system state. In your own words, explain that this role independently verifies evidence, mitigations, recovery, and report completeness before an incident closes — never taking the coordinator's or a specialist's word for it. If asked to diagnose, check status, or take any action, decline and point at the kanban board on this page for real status instead of guessing.",
};
```

(Leave the rest of `route.ts` — the OpenRouter call, validation, error handling — completely untouched. See this plan's Global Constraints for why this is 5 entries, not 10.)

- [ ] **Step 5: Validate the schema, regenerate the client, and type-check**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: completes without error.

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 6: Verify no leftover references**

Run: `grep -rn "AgentState\|agentState\|/api/agents\b" src prisma/seed.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
remove the fictional agent roster, replaced by the real support team

Deletes /agents, /api/agents, OfficeView.tsx, the AgentState model,
and its seed function — fully superseded by /support-dev and
/support-pro now that they exist. Repurposes /api/agent-chat's
prompts for the 5 real roles instead of the 5 fictional ones.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 8: Navigation

**Files:**
- Modify: `src/components/sidebar.tsx`
- Modify: `src/components/command-palette.tsx`

**Interfaces:**
- Consumes: routes `/support-dev`, `/support-pro` (Task 6).
- Produces: nothing consumed by later tasks — this is the last code task.

- [ ] **Step 1: Update `src/components/sidebar.tsx`**

Replace the import block and `navGroups`/`mobileTabsRaw` (currently lines 6-50) with:

```tsx
import {
  Home,
  Radio,
  ShieldAlert,
  Lightbulb,
  ClipboardList,
  Cpu,
  BookOpen,
  GitBranch,
  Server,
  Menu,
  X,
} from "lucide-react";

const navGroups = [
  {
    name: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: Home },
      { href: "/hermes", label: "Hermes", icon: Cpu },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
    ],
  },
  {
    name: "Data",
    items: [
      { href: "/vdecent-dev", label: "V-Decent Dev", icon: GitBranch },
      { href: "/vdecent-pro", label: "V-Decent Pro", icon: Server },
    ],
  },
  {
    name: "System",
    items: [
      { href: "/support-dev", label: "Support · Dev", icon: Radio },
      { href: "/support-pro", label: "Support · Pro", icon: ShieldAlert },
      { href: "/memory-wiki", label: "Memory Wiki", icon: BookOpen },
      { href: "/ideas", label: "Ideas", icon: Lightbulb },
    ],
  },
];

// Mobile tab bar - only show the most important
const mobileTabsRaw = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/support-dev", label: "Support", icon: Radio },
];
```

(`Bot` is dropped from the import list — it was only used for the removed "Agents" entry and is not used anywhere else in this file.)

- [ ] **Step 2: Update `src/components/command-palette.tsx`**

Replace the import block and `NAV` array (currently lines 11-39) with:

```tsx
import {
  LayoutDashboard,
  GitBranch,
  Server,
  Radio,
  ShieldAlert,
  Lightbulb,
  ListChecks,
  Sparkles,
  CornerDownLeft,
  Search,
  Check,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "V-Decent Dev", href: "/vdecent-dev", icon: GitBranch },
  { label: "V-Decent Pro", href: "/vdecent-pro", icon: Server },
  { label: "Support · Dev", href: "/support-dev", icon: Radio },
  { label: "Support · Pro", href: "/support-pro", icon: ShieldAlert },
  { label: "Ideas", href: "/ideas", icon: Lightbulb },
  { label: "Tasks", href: "/tasks", icon: ListChecks },
  { label: "Hermes", href: "/hermes", icon: Sparkles },
];
```

(`Bot` is dropped here too — same reason.)

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify no leftover references**

Run: `grep -n "/agents\"\|Agents\"\|icon: Bot" src/components/sidebar.tsx src/components/command-palette.tsx`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar.tsx src/components/command-palette.tsx
git commit -m "$(cat <<'EOF'
add Support Dev/Pro to nav, remove Agents

Sidebar's System group and the command palette both swap the
fictional Agents entry for the two real support-team pages.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 9: Deploy and verify live

**Files:** none (Coolify deployment + live verification only).

**Interfaces:**
- Consumes: all prior tasks' committed code, pushed to `main`.
- Produces: a live, verified deployment.

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Trigger a deploy and wait for it to finish**

```bash
source ~/.bashrc
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

Poll `GET https://coolify.v-decent.org/api/v1/deployments/{deployment_uuid}` until `status` is `finished`. Retry once if it fails on a transient DNS blip during the git clone or base-image pull — this has happened before with this app and is unrelated to the code. On success, `prisma db push --accept-data-loss` runs automatically on boot (`docker-entrypoint.sh`), applying the `HermesTask` column additions and dropping `AgentState`.

- [ ] **Step 3: Confirm `hermes-bridge` picked up the new boards**

```bash
ssh -o ConnectTimeout=10 vdecentserver0 "docker ps --filter name=hermes-bridge --format '{{.Names}}\t{{.Status}}\t{{.Networks}}'"
```

Expected: one `hermes-bridge-*` container, `Up`, network `host` (matches the earlier fix from the previous feature — this deploy should not have disturbed it, but confirm before trusting the data below).

Wait up to ~35s (one `BRIDGE_MIRROR_MS` cycle) after the container is confirmed up, then check the mirrored data directly:

```bash
ssh -o ConnectTimeout=10 vdecentserver0 "docker exec \$(docker ps --filter name=hermy-hq-postgres -q) psql -U hermy -d hermy_hq -c \"SELECT board, count(*), count(*) FILTER (WHERE \\\"kanbanCreatedAt\\\" IS NOT NULL) AS with_ts FROM \\\"HermesTask\\\" WHERE board LIKE 'vdecent-support-%' GROUP BY board;\""
```

Expected: two rows, `vdecent-support-dev` with count > 0 and `with_ts` equal to `count` (every mirrored task has a real timestamp), `vdecent-support-prod` with count 0 (board is empty at the time of writing — that's correct, not a failure).

- [ ] **Step 4: Verify the API routes live**

Using the same `x-internal-secret` bypass pattern established for the V-Decent ops routes (`src/middleware.ts` accepts it for any `/api/*` route):

```bash
source ~/.bashrc
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "import json,sys; d=json.load(sys.stdin); print([e['value'] for e in d if not e.get('is_preview') and e['key']=='INTERNAL_API_SECRET'][0])")
curl -sS "https://dashboard.v-decent.org/api/support-team/dev" -H "x-internal-secret: $SECRET" | python3 -m json.tool
curl -sS "https://dashboard.v-decent.org/api/support-team/pro" -H "x-internal-secret: $SECRET" | python3 -m json.tool
```

Expected: both return a JSON array of exactly 5 objects with ids `coordinator`/`apps`/`edge`/`infra`/`verifier`. The `dev` response should show non-zero `tasksCompleted` for several members and populated `recentActivity` (real historical data); the `pro` response should show all-zero/empty (board is currently empty) without erroring.

- [ ] **Step 5: Ask the user to visually confirm in the browser**

Report to the user: deployed and live. Ask them to check `/support-dev`, `/support-pro` (both Office and Cards views), the org chart, the chat modal's "Simulated" label, and the sidebar/command-palette nav in their own logged-in session, since this environment has no browser to verify the rendered UI directly.

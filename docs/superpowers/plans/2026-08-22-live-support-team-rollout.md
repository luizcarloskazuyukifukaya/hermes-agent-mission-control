# Live Chat Rollout to All Support Team Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live chat work for all 10 V-Decent Support Team profiles (5 roles × dev/prod), not just the dev coordinator, and fix the banner's dev/prod profile-name mismatch that becomes load-bearing once any prod role goes live.

**Architecture:** No new plumbing. `LIVE_PROFILES` (`src/lib/live-profiles.ts`) is the single toggle point the first increment built for exactly this — widening it from one entry to all 10 makes every profile live through the already-generic chat route, roster route, and bridge. A shared `profileId()` helper is added alongside it so the chat route and the chat modal's banner derive the same Hermes profile string instead of duplicating the `"pro"` → `"prod"` remap in two places (only one of which had it).

**Tech Stack:** Next.js 16 (App Router, TypeScript), the existing `hermes-bridge`/`AgentRequest` pipeline (unchanged by this plan).

## Global Constraints

- No test framework exists in this repo — verification is `npx tsc` for TS/TSX files, plus a final live check against the deployed app. Do not add a test framework.
- This increment makes all 10 role×env combinations live at once (operator decision — no staged dev-then-prod rollout).
- No additional confirmation step, rate limit, or extra approval gate is added for prod roles beyond what already exists — the safety posture accepted for the dev coordinator in the first increment applies identically here.
- Design spec: `docs/superpowers/specs/2026-08-22-live-support-team-rollout-design.md`.

---

### Task 1: Widen `LIVE_PROFILES` and fix the profile-name mismatch

**Files:**
- Modify: `src/lib/live-profiles.ts` (full current content shown below)
- Modify: `src/app/api/support-team/[env]/chat/route.ts:30`
- Modify: `src/components/agent-chat.tsx:105`

**Interfaces:**
- Produces (used by Task 2's live verification): `LIVE_PROFILES` containing all 10 `"{dev|pro}-{role}"` keys; a new exported `profileId(env: "dev" | "pro", role: string): string` returning the real Hermes profile string (e.g. `"vdecent-prod-coordinator"` for `env="pro"`), used identically by both the chat route and the chat modal's banner.

- [ ] **Step 1: Widen `LIVE_PROFILES` and add the shared `profileId()` helper**

Current full content of `src/lib/live-profiles.ts`:

```ts
// Single toggle point for going live with more Hermes profiles later:
// "{env}-{roleId}" — consulted by both the roster route (sets Agent.live
// for the UI) and the chat route (enforces it server-side).
export const LIVE_PROFILES = new Set<string>(["dev-coordinator"]);
```

Replace with:

```ts
// Single toggle point for going live with more Hermes profiles later:
// "{env}-{roleId}" — consulted by both the roster route (sets Agent.live
// for the UI) and the chat route (enforces it server-side).
export const LIVE_PROFILES = new Set<string>([
  "dev-coordinator", "dev-apps", "dev-edge", "dev-infra", "dev-verifier",
  "pro-coordinator", "pro-apps", "pro-edge", "pro-infra", "pro-verifier",
]);

// The real Hermes profile directory name for a given role/env pair. `env`
// here is the route param's "dev"|"pro"; the actual profile on disk uses
// "prod", not "pro", for the production environment — this is the one
// place that remap happens, so callers (the chat route, the chat modal's
// banner) never have to duplicate it.
export function profileId(env: "dev" | "pro", role: string): string {
  return `vdecent-${env === "dev" ? "dev" : "prod"}-${role}`;
}
```

- [ ] **Step 2: Use `profileId()` in the chat route instead of its own inline template literal**

Current (`src/app/api/support-team/[env]/chat/route.ts`):

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LIVE_PROFILES } from "@/lib/live-profiles";
```

Replace with:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LIVE_PROFILES, profileId } from "@/lib/live-profiles";
```

Then find (same file):

```ts
  const profile = `vdecent-${env === "dev" ? "dev" : "prod"}-${role}`;
```

Replace with:

```ts
  const profile = profileId(env, role);
```

- [ ] **Step 3: Fix the chat modal's banner to derive the profile name from the same helper**

Current top of `src/components/agent-chat.tsx` (the imports):

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import type { Agent } from "@/components/agent-card";
```

Replace with:

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import type { Agent } from "@/components/agent-card";
import { profileId } from "@/lib/live-profiles";
```

Then find the banner (`src/components/agent-chat.tsx:105` in the current file — search for this exact text since line numbers may have shifted):

```tsx
            Live — connected to hermes-{env}-{agent.id}
```

Replace with:

```tsx
            Live — connected to hermes-{profileId(env, agent.id).replace(/^vdecent-/, "")}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/live-profiles.ts src/app/api/support-team/\[env\]/chat/route.ts src/components/agent-chat.tsx
git commit -m "$(cat <<'EOF'
feat: go live for all 10 V-Decent Support Team profiles

Widens LIVE_PROFILES from dev-coordinator only to all 5 roles across
both dev and prod, per operator decision to roll out all at once
rather than staging dev-then-prod. Also fixes a deferred Minor
finding from the first increment's review: the chat modal's banner
built its own "hermes-{env}-{role}" string using the raw dev/pro
route param, which doesn't match the real profile name once a prod
role is live (the actual profile uses "prod", not "pro"). Both the
chat route and the banner now derive the profile string from one
shared profileId() helper.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 2: Deploy and verify live

**Files:** none (Coolify deployment + live verification only).

**Interfaces:**
- Consumes: Task 1's committed code, pushed to `main`.
- Produces: all 10 profiles confirmed live-dispatchable in production.

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Trigger a deploy and wait for it to finish**

```bash
source ~/.bashrc
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

Poll `GET https://coolify.v-decent.org/api/v1/deployments/{deployment_uuid}` until `status` is `finished`. Retry once if it fails on the known transient DNS blip during git clone/base-image pull; escalate if it fails twice or for any other reason.

- [ ] **Step 3: Regression check — dev coordinator still works**

```bash
source ~/.bashrc
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "import json,sys; d=json.load(sys.stdin); print([e['value'] for e in d if not e.get('is_preview') and e['key']=='INTERNAL_API_SECRET'][0])")
curl -sS -X POST "https://dashboard.v-decent.org/api/support-team/dev/chat" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"role":"coordinator","message":"Quick check: reply with exactly CONFIRMED."}' | python3 -m json.tool
```

Poll the returned `requestId` via `GET /api/hermes/requests/{id}` (same pattern as the first increment's verification — 5s interval, up to ~5 minutes) until `status` is `done`. Expected: a real, on-topic reply (doesn't need to be the literal word).

- [ ] **Step 4: Spot check — a new dev role**

```bash
curl -sS -X POST "https://dashboard.v-decent.org/api/support-team/dev/chat" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"role":"apps","message":"Please briefly confirm you are the V-Decent dev Apps agent and describe your role in one sentence."}' | python3 -m json.tool
```

Poll the same way. Expected: `done`, with a reply identifying itself as the Apps role (application/API/deployment diagnosis) — confirms a non-coordinator role works, not just the one profile already proven.

- [ ] **Step 5: Spot check — the prod coordinator (highest-stakes profile)**

```bash
curl -sS -X POST "https://dashboard.v-decent.org/api/support-team/pro/chat" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"role":"coordinator","message":"Please briefly confirm you are the V-Decent production Coordinator and describe your role in one sentence."}' | python3 -m json.tool
```

Poll the same way. Expected: `done`, with a reply identifying itself as the production Coordinator — confirms `pro` env roles are actually live and correctly reach the `vdecent-prod-coordinator` profile (not a nonexistent `vdecent-pro-coordinator`), which is exactly what Task 1's `profileId()` fix guarantees. Then confirm the DB row used the right profile string:

```bash
ssh -o ConnectTimeout=10 vdecentserver0 "docker exec \$(docker ps --filter name=hermy-hq-postgres -q) psql -U hermy -d hermy_hq -c \"SELECT id, profile, status FROM \\\"AgentRequest\\\" WHERE profile = 'vdecent-prod-coordinator' ORDER BY \\\"createdAt\\\" DESC LIMIT 1;\""
```

Expected: one row, `profile = vdecent-prod-coordinator`, `status = done`.

- [ ] **Step 6: Ask the user to visually confirm in the browser**

Report to the user: deployed and live for all 10 profiles. Ask them to open `/support-dev` and `/support-pro`, chat with a couple of different roles in each (not just the coordinator), and confirm every chat modal now shows the green "Live — connected to hermes-{env}-{role}" banner with the correct profile name (e.g. "hermes-prod-apps" on `/support-pro`, not "hermes-pro-apps") — no role should show the amber "Simulated" banner anymore.

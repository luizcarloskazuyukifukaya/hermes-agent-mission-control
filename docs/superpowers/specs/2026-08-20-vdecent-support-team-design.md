# V-Decent Support Team Dashboard — Design

Date: 2026-08-20

**Amendment (2026-08-21, during implementation planning):** the "Backend" section below
now includes a small additive schema change discovered while detailing the status API —
`HermesTask.updatedAt` is not actually maintained on status transitions (only set once on
first insert; `ON CONFLICT` never touches it), so it can't drive "recent activity"
ordering. Three new nullable columns (`kanbanCreatedAt`/`kanbanStartedAt`/
`kanbanCompletedAt`, sourced from the kanban JSON's real timestamps) fix this. See the
"Data layer: status derivation" section for the corrected column list.

## Purpose

Replace the dashboard's fictional "AI Team" (Max/Sage/Knox/Nova/Pixel, a content-business
template roster) with the real V-Decent Support Team: two five-member incident-response
teams — one for Development/PoC, one for Production — that already exist and are already
running on `vdecentserver0`, coordinating through two Hermes kanban boards
(`vdecent-support-dev`, `vdecent-support-prod`).

## Background: the real team (verified live during design)

Discovered under `~/hermes-agent/data/profiles/` on `vdecentserver0` — 10 Hermes profiles,
5 roles × 2 environments:

| role id | name | emoji | responsibility (from each profile's `SOUL.md`/`profile.yaml`) |
|---|---|---|---|
| `coordinator` | Coordinator | 🧭 | Coordinates incidents, delegates diagnosis, owns traceable reports |
| `apps` | Apps | 📦 | Diagnoses applications, APIs, deployments, databases |
| `edge` | Edge | 🌐 | Diagnoses Coolify, Cloudflare, DNS, tunnels, reverse-proxy routing |
| `infra` | Infra | 🖥️ | Diagnoses nodes, Docker, Sentinel, resources, runtime health |
| `verifier` | Verifier | 🔍 | Independently verifies evidence, mitigations, and report completeness |

Only the two Coordinators are persistent daemons (Docker containers
`hermes-dev-coordinator`, `hermes-prod-coordinator`, each running a Hermes gateway). The
other 8 are personas the coordinator dispatches to on demand — they have no standing
"online" state of their own.

Coordination already happens through `hermes kanban`, a durable SQLite-backed task board
built into the Hermes CLI, with atomic per-profile task claiming. Two boards already exist
and are already in use:

```
SLUG                  NAME                                COUNTS
vdecent-support-dev   V-Decent Support — Development/PoC   blocked=11, done=21, todo=6
vdecent-support-prod  V-Decent Support — Production P0     (empty)
```

`hermes kanban --board <slug> list --json` returns each task's `id`, `title`, `assignee`
(e.g. `vdecent-dev-apps`), `status` (`todo`/`ready`/`running`/`blocked`/`done`/…),
`created_at`/`started_at`/`completed_at`. This dashboard's own `hermes-bridge` container
already mounts the same shared host directory the coordinators use, and was confirmed
(during design) to already have visibility into both boards — no new infrastructure is
needed on the host side.

## Backend: mirroring the two boards

`hermes-bridge/bridge.mjs`'s existing `mirrorKanban()` polls one board (`HERMES_BOARD`,
default `"default"`) every `BRIDGE_MIRROR_MS` (30s) and upserts into the `HermesTask`
Postgres table, deleting rows that vanished from the board. `HermesTask` already has a
`board` column (indexed) — it was designed to support more than one board, just never used
that way until now.

**Change:** parameterize `mirrorKanban()` by board slug and call it for each of
`["default", "vdecent-support-dev", "vdecent-support-prod"]` on each mirror cycle, instead
of just the single configured `BOARD`. The `board` and `status` columns/indexes already
exist and need no change.

**Schema addition (see amendment above):** `HermesTask` gains three nullable columns —
`kanbanCreatedAt`, `kanbanStartedAt`, `kanbanCompletedAt` — populated from the kanban
JSON's own `created_at`/`started_at`/`completed_at` (Unix seconds → `DateTime`).
`mirrorKanban()`'s upsert sets all three on both insert and `ON CONFLICT` update, since
`started_at`/`completed_at` change as a task progresses. This repo has no migration
files (`prisma db push` on every boot, per `docker-entrypoint.sh`), so the change ships
as a normal schema edit with no separate migration step.

## Data layer: status derivation

New route `src/app/api/support-team/[env]/route.ts` (`env` = `dev` | `pro`, mapping to
board `vdecent-support-{dev,prod}` and assignee prefix `vdecent-{dev,prod}-`). Queries
`HermesTask WHERE board = $1`, groups rows by assignee into the 5 known role ids, and
derives each member's status from their current task set:

- has a `running` task → **working**
- else has a `todo`/`ready`/`scheduled` task → **idle** (queued, not yet picked up)
- else has a `blocked` task → **error** (needs attention — reuses the existing red "Error"
  status styling already defined in the Agents UI)
- else (only `done` tasks, or none at all) → **idle**

Per member: `currentTask` = title of the running task, else the oldest queued task's
title (by `kanbanCreatedAt`), else `undefined`. `tasksCompleted` = count of `done` tasks.
Each task's own "most recent" timestamp is `kanbanCompletedAt ?? kanbanStartedAt ??
kanbanCreatedAt`; `lastActive` = the max of that across a member's tasks, and
`recentActivity` = tasks sorted by that same value descending, mapped to `{ timestamp,
action: title, result: status }`. `totalCost` = 0 (no cost data in kanban; the field
exists in the `Agent` shape
but was never rendered in the UI either, real or fictional).

Role names/emoji/descriptions are a small static roster in the route (they come from
`SOUL.md`/`profile.yaml`, which change rarely — not from kanban), analogous to today's
`DEFAULT_AGENTS` constant.

The `vdecent-support-prod` board is currently empty — the Production page will correctly
show all 5 roles idle with zero tasks. This is real state, not an error, and needs no
special-cased handling (same pattern as V-Decent Pro's App Manager page showing only 1
app earlier).

## Frontend structure

`src/app/agents/page.tsx` currently has two genuinely reusable, fully data-driven pieces —
`AgentCard` and `AgentChat` — plus one page-specific piece, `OfficeView`
(`src/components/OfficeView.tsx`), which is *not* generic: it hardcodes desk labels, walk
timing, and pixel-art sprites keyed to the five fictional agent ids (`max`, `sage`, `knox`,
`nova`, `pixel`).

- Extract `AgentCard` and `AgentChat` out of `agents/page.tsx` into their own files —
  `src/components/agent-card.tsx`, `src/components/agent-chat.tsx` — so the new pages
  import them instead of duplicating ~250 lines.
- New `src/components/support-team-page.tsx` — shared client component
  `SupportTeamPage({ env, title }: { env: "dev" | "pro"; title: string })`, structured like
  today's `AgentsPage` (Office/Cards toggle, org chart, chat), fetching
  `/api/support-team/${env}` and rendering `AgentCard`/`AgentChat`.
- `src/components/OfficeView.tsx` is deleted along with `agents/page.tsx` (it's not
  reused as-is — `DESK_LAYOUT`, `WALK`, and `SPRITE_DATA` are hardcoded to the five
  fictional agent ids, not a generic prop-driven component). A new
  `src/components/SupportOfficeView.tsx` reuses the same visual engine (pixel sprites,
  desk tiles, activity bubbles, ticker) with a desk layout for the real roster instead:
  Coordinator in the lead position (mirroring where Max sits today), Apps/Edge/Infra/
  Verifier below. The new role ids have no custom pixel-art sprite, so they render
  through the engine's existing generic fallback (falls back to a 🤖 emoji for any
  unknown agent id) — custom art is an easy later polish, not required to ship this.
- Two thin page files: `src/app/support-dev/page.tsx`, `src/app/support-pro/page.tsx`,
  each rendering `<SupportTeamPage env="…" title="V-Decent Support · …" />`.

## Chat feature

Per the "keep chat, clearly labeled as simulated" decision: `/api/agent-chat` is kept and
repurposed — its `AGENT_PROMPTS` map gets 10 new entries (one per role × environment),
replacing the 5 fictional ones. Each new prompt explicitly frames the response as a
description of the role, not a live connection to the real agent, and declines to
fabricate diagnostic findings if asked — e.g.:

> "You are describing the role of the V-Decent {Environment} Support {Role} to the
> operator. You are not the real agent and have no access to real incident data or system
> state — speak about what this role does and how it fits the team. If asked to diagnose,
> check status, or take action, say so plainly and point at the kanban board on this page
> for real status instead of guessing."

The chat modal UI (in the extracted `AgentChat` component) gains a small persistent label
— e.g. "Simulated — not the live agent" — visible whenever a chat is open, satisfying the
same requirement visually, not just in the prompt text.

## Deletion of the fictional team

Verified during design: nothing outside `src/app/agents/` and `src/app/api/agents/`
references `AgentState`, `/api/agents`, or `/api/agent-chat`. Delete:

- `src/app/agents/` (the page itself, after extracting `AgentCard`/`AgentChat`)
- `src/components/OfficeView.tsx` (superseded by `SupportOfficeView.tsx`, see above)
- `src/app/api/agents/route.ts` (the fictional roster + `AgentState`-backed status API)
- The `AgentState` Prisma model and its migration
- The 5 fictional entries in `/api/agent-chat`'s `AGENT_PROMPTS` (replaced by the 10 real
  ones, not merely appended to)

`/api/agent-chat/route.ts` itself is kept (repurposed, not deleted) per the above.

## Navigation

`src/components/sidebar.tsx`'s `System` group:

```
System
  Support · Dev    /support-dev
  Support · Pro    /support-pro
  Memory Wiki      /memory-wiki
  Ideas            /ideas
```

("Agents" is removed outright, not unlinked — the page itself no longer exists, unlike
the earlier Pipeline/Client Pulse removals where the underlying feature stayed intact.)
`src/components/command-palette.tsx`'s `NAV` gets the same swap (remove `Agents`, add
`Support · Dev` / `Support · Pro`).

## Out of scope (for this spec)

- Custom pixel-art sprites for the 5 real roles (generic 🤖 fallback ships instead).
- Wiring chat to anything real (e.g. dispatching an actual kanban task from the dashboard)
  — noted as a possible follow-up, not part of this feature.
- Blending the Coordinators' real gateway online/offline signal (`gateway_state.json`) into
  status — status is kanban-only for all 5 roles, for consistency across the team; the two
  coordinators' extra live signal is available for a future enhancement but not used here.
- Any mutating action against the kanban board from the dashboard (creating, assigning, or
  completing tasks) — this is a read-only status view, matching the V-Decent Dev/Pro ops
  pages' precedent.
- Historical trends of team activity over time — only current board state is mirrored.

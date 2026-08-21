# Support Team Issue Board — Design

Date: 2026-08-21

## Purpose

Give the operator visibility into the actual issues/incidents the V-Decent Support Team is
tracking — not just the per-role status summary the existing `/support-dev`/`/support-pro`
pages show, but the real kanban queue itself: every mirrored task, grouped by status, on
each environment's board.

## Background: what already exists

Discovered while designing this: the codebase already has **three separate, near-identical
kanban-column implementations**, none extracted into a shared component:

1. `src/app/hermes/page.tsx:421-509` — `TaskBoard`, rendering the operator's personal
   Hermes kanban (`HermesTask` rows for `board="default"`). Seven status columns
   (Triage/To do/Ready/Running/Review/Blocked/Done), color-toned left border per card,
   read-only.
2. `src/app/tasks/page.tsx` — a 4-column interactive board backed by a Notion proxy,
   unrelated data source.
3. `src/app/content-os/page.tsx:226-260` — a content-pipeline column view, unrelated data
   source.

`TaskBoard` (item 1) is the right one to reuse here: it already renders exactly the
`HermesTask` shape the V-Decent support boards are mirrored into (same table, same
columns, just a different `board` value), via the same status-bucketing rules already
proven on `/hermes`.

## Placement

A third toggle option, **"Board"**, added next to the existing "Office"/"Cards" toggle on
both `/support-dev` and `/support-pro` (`src/components/support-team-page.tsx`). No new
route, no new nav entry — it's another view of the page the operator already has open.

```
Support · Development                    [Office] [Cards] [Board]

Triage(0)  To do(2)  Ready(0)  Running(1)  Blocked(3)  Done(21)
─────────  ───────   ───────   ────────    ───────     ───────
[card]     [card]                [card]     [card]      [card]
           [card]                           [card]      [card]
```

## Granularity

Flat kanban — one card per mirrored task, exactly like `/hermes`'s existing board. No
incident-level grouping (parsing the `VDS-DEV-YYYYMMDD-NNNN` id out of titles and nesting
specialist sub-tasks under it) in this pass — that's a real, separate design problem
(parent/child linkage isn't even mirrored into `HermesTask` today) and is noted below as a
possible follow-up, not part of this feature.

## Data layer

New route: `src/app/api/support-team/[env]/tasks/route.ts` (`env` = `dev` | `pro`).
Same response shape as the existing `/api/hermes/tasks` (`{ tasks, counts, total,
lastSync }`), filtered to `board = vdecent-support-{dev,prod}` instead of the personal
board. No Prisma schema changes — `HermesTask` already has everything needed.

The one behavioral difference from a plain reuse of `/api/hermes/tasks`: raw `assignee`
values on this board are role ids like `vdecent-dev-apps`, `vdecent-dev-coordinator`
(not human-friendly). This route reformats each task's `assignee` field to a friendly
label — `Apps`, `Coordinator`, etc. — using the same 5-role roster
`src/app/api/support-team/[env]/route.ts` already defines, before returning the task list.
Anything outside the 5 known roles (e.g. `codex`, seen as the assignee on some
swarm-root/blackboard cards) falls back to its raw string unchanged — never dropped, just
not relabeled.

## Component reuse

`TaskBoard` — along with its supporting `Task` interface, `COLUMN_ORDER`/`columnFor`/
`columnTone`/`COLUMN_LABEL`, and `timeAgo` helper — is extracted **unchanged** from
`src/app/hermes/page.tsx` into a new shared file, `src/components/task-board.tsx`. This is
a pure, behavior-preserving refactor for `/hermes`: it starts importing `TaskBoard` from
the new shared location instead of defining it locally, and renders identically to before.

`src/components/support-team-page.tsx` imports the same `TaskBoard` from the new shared
location, fetches from the new `/api/support-team/{env}/tasks` route (on the same 10s
poll cadence the page already uses for the agent roster), and renders it when the "Board"
toggle is active.

## Out of scope (for this feature)

- Incident-level grouping (parsing `VDS-{ENV}-...` ids, nesting sub-tasks under a parent)
  — noted above as a real follow-up, needs its own design (would also require mirroring
  parent/child link data that `HermesTask` doesn't capture today).
- Any mutating action from this board (assigning, completing, reassigning a task) — this
  is a read-only view, matching every other V-Decent status page built this session.
- Task detail (comments, full body, attachments) — the kanban CLI's `show`/`context`
  commands expose this, but `HermesTask` only mirrors title/status/assignee/timestamps
  today; a detail view would need a new mirroring path, not part of this feature.
- Filtering/search on the board — the existing `/hermes` `TaskBoard` doesn't have this
  either; adding it here would be scope creep beyond "make the existing board reusable."

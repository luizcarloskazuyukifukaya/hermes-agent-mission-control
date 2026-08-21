# Personal Task Board — Design

Date: 2026-08-21

## Purpose

Replace the currently non-functional `/tasks` page with a real, working personal to-do board.
Today's page proxies a Notion database (`"Max's Tasks DB"` — a leftover from the fictional
"Max" agent already replaced this session) but `NOTION_API_KEY` was never configured in this
app's environment, so `GET /api/tasks` always returns a hardcoded 3-item mock array and
`POST`/`PATCH` silently no-op. The user can click "Add Task" or change a card's status, but
the next fetch discards it — nothing persists.

## Scope

Purely personal — a private to-do list for the user, not connected to the Hermes kanban
system the Support Team agents use. No agent reads, claims, or acts on these tasks; this is
isolated infrastructure from `HermesTask`/`hermes-bridge`.

## Background: what already exists

- `src/app/api/tasks/route.ts` — `GET`/`POST`/`PATCH` handlers, all branching on whether
  `NOTION_API_KEY` is set; falls back to a hardcoded mock array when it isn't (which is
  always, in production).
- `src/app/tasks/page.tsx` — a 4-column kanban UI (`Not started` / `Approved` / `In progress`
  / `Done`), with an "Add Task" form and a per-card status `<select>`, already fully wired to
  call the API above. The UI code is not the problem — the backing store is.

## Data layer

New Prisma model, `PersonalTask`, following this codebase's existing conventions (see
`Idea`, `HermesTask` for style precedent — `cuid()` ids, plain `String` status rather than an
enum, since every other status-bearing model in this schema uses free-form strings):

```prisma
model PersonalTask {
  id        String    @id @default(cuid())
  name      String
  status    String    @default("Not started")
  priority  String?
  category  String?
  dueDate   DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([status])
}
```

Status values stay exactly the same 4 strings the UI already uses as column ids
(`"Not started"`, `"Approved"`, `"In progress"`, `"Done"`) — no UI column changes needed.

No migration files exist in this repo (`prisma db push --accept-data-loss` runs on every
container boot); the new table appears automatically on next deploy. No seed data — the
board starts empty in production (the 3 mock tasks were never real data, just a fallback
placeholder).

## API

`src/app/api/tasks/route.ts` is rewritten to talk directly to Postgres via Prisma — the
Notion branching and mock-data fallback are removed entirely, not kept as a dead code path.

- **`GET`** → all `PersonalTask` rows, ordered by `createdAt` ascending. Response shape
  unchanged from today: `{ tasks: [...] }`, each task including `id`, `name`, `status`,
  `priority`, `category`, `dueDate` (ISO string or `null`).
- **`POST`** → body `{ name: string, priority?: string, category?: string, dueDate?: string }`.
  Creates a row with `status: "Not started"`. Returns the created task.
- **`PATCH`** → body `{ id: string, status?: string, name?: string, priority?: string,
  category?: string, dueDate?: string | null }`. Updates only the fields present in the body
  (partial update) — this single endpoint covers both "move to another column" (today's only
  use) and the new inline-edit feature (name/priority/category/dueDate changes).
- **`DELETE`** → body `{ id: string }`. Removes the row. Returns `{ success: true }`.

All four handlers return standard error responses (`{ error: string }`, appropriate status
code) on failure, matching the pattern already used by every other API route in this app —
no special-casing beyond that.

## UI changes

`src/app/tasks/page.tsx`:

- Eyebrow label "Synced with Notion" → "Your personal board" (no longer Notion-backed).
- **Add Task form** gains two new optional inputs alongside the existing name field: a
  priority `<select>` (`High` / `Medium` / `Low` / none — matching the existing `Pill` tones
  already defined for priority) and a category free-text input (matching today's existing
  category concept), plus a new optional due-date `<input type="date">`.
- **`TaskCard`** hover-actions row (the area that currently only shows the status `<select>`)
  gains two more affordances:
  - A pencil/edit icon that swaps the card into an inline edit form (name, priority, category,
    due date — the same fields as creation), with Save/Cancel buttons. Editing calls `PATCH`
    with only the changed fields.
  - A trash/delete icon that calls `DELETE` immediately (no confirmation dialog — this is a
    low-stakes personal to-do, consistent with how casually items get added/removed on any
    to-do list; matches this app's general preference for lightweight interactions over modal
    confirmations elsewhere).
- Cards show a `Due <date>` line under the title when `dueDate` is set (e.g. "Due Aug 25"),
  using the existing `text-[var(--text-3)]` muted-text style. When a task is overdue (its
  `dueDate` is in the past AND `status !== "Done"`), the due-date text switches to the `warn`
  tone already used for High-priority pills (`Pill tone="warn"` styling, or the equivalent
  `--warn` CSS variable applied directly to the text) — a purely visual flag, no separate
  "overdue" status value.

## Out of scope

- No connection to the Hermes kanban system / `HermesTask` table — this stays fully isolated
  personal infrastructure, per explicit decision during design.
- No delete confirmation modal — deletion is immediate, matching the low-stakes nature of a
  personal to-do list.
- No recurring tasks, subtasks, reminders/notifications, or drag-and-drop reordering within a
  column — the existing dropdown-based "move to column" interaction is kept as-is, just
  pointed at real persistence.
- No historical/audit trail of status changes — only current state is stored (`updatedAt`
  reflects the last change, but no change-log table).

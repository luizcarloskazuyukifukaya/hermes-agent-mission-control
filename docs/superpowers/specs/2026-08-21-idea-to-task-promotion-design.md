# Idea-to-Task Promotion — Design

Date: 2026-08-21

## Purpose

Close the loop between the Idea Board and the Tasks board. Today, an approved idea is a
dead end — the card just shows a static "✓ Approved" label with no further action. Add two
explicit outcomes for an approved idea: promote it to a real, tracked task, or mark it done
without further action. Also bring the Idea Board's editing affordances up to parity with
the Tasks board (edit/delete on any card), which it currently lacks entirely.

## Tasks board: add a `description` field

The Tasks board (`PersonalTask`, from the prior "Personal Task Board" plan) gains an
optional `description` field — a free-text field for task detail, shown on the card body,
editable in the create form and the inline edit form. This is **not** import-only: it's a
first-class field available whenever a task is created or edited, whether by hand or via the
idea-promotion flow below.

Data layer: `PersonalTask.description String?` (nullable, matching `priority`/`category`).
API: `GET`/`POST`/`PATCH` on `/api/tasks` all pass `description` through exactly like
`category` does today (optional on create, nullable on partial update). UI: the "Add Task"
form gets a `<textarea>` under the name input (matching the Idea Board's existing description
textarea styling); the inline edit form gets the same; the card displays it under the title,
above the priority/category/due-date row, in the muted `text-[var(--text-2)]` style already
used for description-like text elsewhere in this app.

## Idea → Task promotion

No new API endpoints — both `/api/tasks` and `/api/ideas` already expose everything needed
(`POST /api/tasks`, `DELETE /api/ideas`, `PUT /api/ideas`). This is purely a new client-side
action sequence on the Idea Board.

**"Move to Tasks"** (shown only on `approved`-status idea cards):
1. `POST /api/tasks` with `{ name: idea.title, description: idea.description, category:
   idea.category, priority: null, dueDate: null }` (dueDate omitted — ideas have no due
   date concept, matching your explicit confirmation this is fine).
2. On success, `DELETE /api/ideas` for that idea's id.
3. Refetch the Idea Board list — the card is gone (idea deleted entirely, not just
   hidden/re-statused, per your earlier decision).
4. If step 1 fails, do not attempt step 2 — the idea stays exactly as it was, so nothing is
   silently lost. If step 1 succeeds but step 2 fails, the idea temporarily also exists as a
   task; the next successful "Move to Tasks" click (idempotent from the idea's perspective;
   the idea is still `approved`) or a manual delete on the Idea Board cleans it up. This is
   the same best-effort posture the rest of this app takes toward multi-step client actions
   (no distributed-transaction machinery) — acceptable given this is a low-stakes personal
   tool.

**"Move to Done"** (shown only on `approved`-status idea cards): `PUT /api/ideas { id,
status: "done" }` — the exact same status transition the API already supports; the idea now
appears under the existing "Done" filter tab, unchanged otherwise.

Neither action shows a confirmation dialog, matching the Tasks board's existing
no-confirmation-on-delete precedent.

**Approved-card UI change**: the current plain "✓ Approved" indicator text is replaced by two
pill buttons — "Move to Tasks" and "Move to Done" — styled like the existing Approve/Reject
button pair (icon + label, colored border, no fill).

## Idea Board: edit and delete on every card

Every idea card (any status — `new`, `considering`, `approved`, `in-progress`, `done`,
`rejected`) gains hover-revealed pencil and trash icons, in the same position/pattern as the
Tasks board's cards (top-right of the card, `opacity-0 group-hover:opacity-100`).

- **Edit** opens an inline form with the same fields as the "Add Idea" form: title,
  description, category, estimated time. Saves via the existing `PUT /api/ideas`. Status is
  not editable from this form (status changes stay on the existing Approve/Reject/Move
  buttons, to avoid two different UIs both being able to change status inconsistently).
- **Delete** calls the existing `DELETE /api/ideas` immediately, no confirmation — same
  precedent as the Tasks board.

## Out of scope

- No change to the Idea Board's existing Approve/Reject flow for non-approved ideas.
- No mapping table for idea category → task category — `PersonalTask.category` is already a
  free-text string, so the idea's category value passes through unchanged.
- No "undo" for a promotion or a delete on either board — matches the existing no-undo
  posture of both boards.
- The `in-progress` status defined in the Idea Board's `STATUS_CONFIG` has no reachable UI
  path today (a pre-existing gap, not introduced or fixed by this plan) and stays that way.

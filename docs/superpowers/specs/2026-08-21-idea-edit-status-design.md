# Idea Board Edit — Free Status Change — Design

Date: 2026-08-21

## Purpose

The Idea Board's inline edit form (added in the prior "Idea-to-Task Promotion" plan)
deliberately excluded status, so status transitions stayed on the dedicated
Approve/Reject/Move-to-Tasks/Move-to-Done buttons. The user now wants the edit form itself
to be able to set an idea's status to any value directly, as an additional path alongside
those buttons (not a replacement for them).

## Scope

Idea Board only (`src/app/ideas/page.tsx`). The Tasks board's edit form is unaffected and
keeps its existing status-excluded design — this request is specific to ideas.

## Edit form changes

`IdeaEditFields` gains two fields:

```ts
interface IdeaEditFields {
  title: string;
  description: string;
  category: string;
  estimatedTime: string;
  status: string;
  rejectionReason: string;
}
```

The edit form (`IdeaCard`'s `isEditing` branch) gains a status `<select>`, placed below the
existing category/estimated-time row, offering all six values already defined in
`STATUS_CONFIG`: New, Considering, Approved, In Progress, Done, Rejected.

**Rejection reason handling**: when the selected status is `"rejected"`, a reason text input
appears beneath the status select (same placeholder/style as the existing dedicated Reject
flow's input: `"Why reject? (helps Sage learn)"`), and the **Save** button is disabled until
that reason is non-empty — mirroring the existing Reject button's
`disabled={!rejectReason.trim()}` pattern, so a rejection can never be saved without a reason
via this path either.

`saveEditIdea` sends `status` unconditionally, and sends `rejectionReason` only when the
selected status is `"rejected"`. When status is anything else, `rejectionReason` is omitted
from the request body entirely — `PUT /api/ideas` only updates fields present in the request,
so this means editing a previously-rejected idea back to some other status (and later editing
it again) does not silently wipe its stored rejection reason; the field is simply left alone
unless the edit is actively setting status to `"rejected"`.

`startEditIdea` populates the two new fields from the idea being edited: `status: idea.status
|| "new"`, `rejectionReason: idea.rejectionReason || ""`.

## What does NOT change

- The non-editing card view's dedicated Approve/Reject/Move-to-Tasks/Move-to-Done buttons are
  untouched — they remain the one-click path for the transitions they already handle. The
  edit form is an additional, more general path, not a replacement.
- No change to `/api/ideas` — `PUT` already accepts and forwards both `status` and
  `rejectionReason` (the latter only since the prior plan's schema fix), so no API changes
  are needed.
- No change to the Tasks board.

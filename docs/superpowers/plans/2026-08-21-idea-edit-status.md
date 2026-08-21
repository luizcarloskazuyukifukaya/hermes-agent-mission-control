# Idea Board Edit — Free Status Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Idea Board's inline edit form set an idea's status to any value, with a
required rejection reason when the chosen status is "Rejected" — as an additional path
alongside (not a replacement for) the existing Approve/Reject/Move-to-Tasks/Move-to-Done
buttons.

**Architecture:** Targeted edits to `src/app/ideas/page.tsx` only — `IdeaEditFields` gains
`status`/`rejectionReason`; the edit form gains a status `<select>` and a conditional
rejection-reason input; `startEditIdea`/`saveEditIdea` are updated to populate/send them.

**Tech Stack:** Next.js 16 App Router, TypeScript, `@/components/ui/kit` (`Panel`, `Button`).
No API changes — `PUT /api/ideas` already accepts and forwards both `status` and
`rejectionReason`.

## Global Constraints

- The non-editing card view's dedicated Approve/Reject/Move-to-Tasks/Move-to-Done buttons are
  unchanged — the edit form is an additional path, not a replacement.
- Selecting "Rejected" in the edit form requires a non-empty reason before Save is enabled
  (mirroring the existing dedicated Reject flow's `disabled={!rejectReason.trim()}` pattern).
- When the edit form's status is anything other than "Rejected", `rejectionReason` is omitted
  from the `PUT` request body entirely (not sent as empty/null) — `PUT /api/ideas` only
  updates fields present in the request body, so this leaves any existing stored rejection
  reason untouched rather than wiping it when editing a previously-rejected idea back to a
  different status.
- No test suite exists in this repo. Verification is `npx tsc --noEmit` and manual/live checks.
- Commit convention: clear subject + body, trailers `Co-Authored-By: Claude Sonnet 5
  <noreply@anthropic.com>` and `Claude-Session:
  https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW`.

---

### Task 1: Add status + rejection reason to the Idea edit form

**Files:**
- Modify: `src/app/ideas/page.tsx` (5 targeted edits, not a full-file replacement — exact
  before/after blocks given below)

**Interfaces:**
- Consumes: `PUT /api/ideas` (already accepts `status`/`rejectionReason` in its request body —
  confirmed in the prior "Idea-to-Task Promotion" plan, no API changes needed here).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add `status`/`rejectionReason` to `IdeaEditFields`**

Current (lines 19-24):

```ts
interface IdeaEditFields {
  title: string;
  description: string;
  category: string;
  estimatedTime: string;
}
```

Replace with:

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

- [ ] **Step 2: Update `EMPTY_IDEA_EDIT`**

Current (line 48):

```ts
const EMPTY_IDEA_EDIT: IdeaEditFields = { title: "", description: "", category: "", estimatedTime: "" };
```

Replace with:

```ts
const EMPTY_IDEA_EDIT: IdeaEditFields = { title: "", description: "", category: "", estimatedTime: "", status: "new", rejectionReason: "" };
```

(This value is only ever used as the reset target on cancel, alongside `editingId` being set
to `null` — it is never rendered, so `status: "new"` here is just a harmless placeholder, not
a user-visible default.)

- [ ] **Step 3: Add the status select + conditional reason input to the edit form**

Current, inside `IdeaCard`'s `isEditing` branch (the category/estimatedTime `<select>` row
through the closing `Save`/`Cancel` buttons):

```tsx
        <div className="flex gap-3">
          <select
            value={editFields.category}
            onChange={(e) => onEditFieldsChange({ ...editFields, category: e.target.value })}
            className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
          >
            <option value="">No category</option>
            <option value="build">Build</option>
            <option value="content">Content</option>
            <option value="feature">Feature</option>
            <option value="thread">Thread</option>
            <option value="experiment">Experiment</option>
          </select>
          <select
            value={editFields.estimatedTime}
            onChange={(e) => onEditFieldsChange({ ...editFields, estimatedTime: e.target.value })}
            className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
          >
            <option value="">No estimate</option>
            <option value="30 minutes">30 min</option>
            <option value="1 hour">1 hour</option>
            <option value="2 hours">2 hours</option>
            <option value="3 hours">3 hours</option>
            <option value="Half day">Half day</option>
            <option value="Full day">Full day</option>
          </select>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="primary" size="sm" onClick={onSaveEdit}>Save</Button>
          <Button variant="ghost" size="sm" onClick={onCancelEdit}>Cancel</Button>
        </div>
      </Panel>
    );
  }
```

Replace with:

```tsx
        <div className="flex gap-3">
          <select
            value={editFields.category}
            onChange={(e) => onEditFieldsChange({ ...editFields, category: e.target.value })}
            className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
          >
            <option value="">No category</option>
            <option value="build">Build</option>
            <option value="content">Content</option>
            <option value="feature">Feature</option>
            <option value="thread">Thread</option>
            <option value="experiment">Experiment</option>
          </select>
          <select
            value={editFields.estimatedTime}
            onChange={(e) => onEditFieldsChange({ ...editFields, estimatedTime: e.target.value })}
            className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
          >
            <option value="">No estimate</option>
            <option value="30 minutes">30 min</option>
            <option value="1 hour">1 hour</option>
            <option value="2 hours">2 hours</option>
            <option value="3 hours">3 hours</option>
            <option value="Half day">Half day</option>
            <option value="Full day">Full day</option>
          </select>
        </div>
        <select
          value={editFields.status}
          onChange={(e) => onEditFieldsChange({ ...editFields, status: e.target.value })}
          className="w-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
        >
          <option value="new">New</option>
          <option value="considering">Considering</option>
          <option value="approved">Approved</option>
          <option value="in-progress">In Progress</option>
          <option value="done">Done</option>
          <option value="rejected">Rejected</option>
        </select>
        {editFields.status === "rejected" && (
          <input
            type="text"
            value={editFields.rejectionReason}
            onChange={(e) => onEditFieldsChange({ ...editFields, rejectionReason: e.target.value })}
            placeholder="Why reject? (helps Sage learn)"
            className={inputCls}
          />
        )}
        <div className="flex gap-2 pt-1">
          <Button
            variant="primary"
            size="sm"
            onClick={onSaveEdit}
            disabled={editFields.status === "rejected" && !editFields.rejectionReason.trim()}
          >
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancelEdit}>Cancel</Button>
        </div>
      </Panel>
    );
  }
```

- [ ] **Step 4: Populate the new fields in `startEditIdea`**

Current:

```ts
  function startEditIdea(idea: Idea) {
    setEditingId(idea.id);
    setEditFields({
      title: idea.title,
      description: idea.description || "",
      category: idea.category || "",
      estimatedTime: idea.estimatedTime || "",
    });
  }
```

Replace with:

```ts
  function startEditIdea(idea: Idea) {
    setEditingId(idea.id);
    setEditFields({
      title: idea.title,
      description: idea.description || "",
      category: idea.category || "",
      estimatedTime: idea.estimatedTime || "",
      status: idea.status || "new",
      rejectionReason: idea.rejectionReason || "",
    });
  }
```

- [ ] **Step 5: Send the new fields in `saveEditIdea`**

Current:

```ts
  async function saveEditIdea(id: string) {
    if (!editFields.title.trim()) return;
    try {
      await fetch("/api/ideas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          title: editFields.title.trim(),
          description: editFields.description || null,
          category: editFields.category || null,
          estimatedTime: editFields.estimatedTime || null,
        }),
      });
      cancelEditIdea();
      fetchIdeas();
    } catch (e) {
      console.error("Failed to save idea edit", e);
    }
  }
```

Replace with:

```ts
  async function saveEditIdea(id: string) {
    if (!editFields.title.trim()) return;
    if (editFields.status === "rejected" && !editFields.rejectionReason.trim()) return;
    try {
      await fetch("/api/ideas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          title: editFields.title.trim(),
          description: editFields.description || null,
          category: editFields.category || null,
          estimatedTime: editFields.estimatedTime || null,
          status: editFields.status,
          ...(editFields.status === "rejected" ? { rejectionReason: editFields.rejectionReason.trim() } : {}),
        }),
      });
      cancelEditIdea();
      fetchIdeas();
    } catch (e) {
      console.error("Failed to save idea edit", e);
    }
  }
```

The `if (editFields.status === "rejected" && !editFields.rejectionReason.trim()) return;`
guard mirrors the Save button's `disabled` condition — belt-and-suspenders, matching this
function's existing style of guarding before the fetch (see the `title` check on the line
above it).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual visual check with the dev server**

Run: `npm run dev` (or confirm it's already running), then in a browser at `/ideas`:
1. Edit any idea (any status). Confirm the new status dropdown shows the idea's current
   status, and all 6 options are selectable.
2. Change the dropdown to "Rejected" — confirm a reason input appears and Save is disabled
   until you type something in it.
3. Enter a reason and Save — confirm the card now shows "Rejected" with that reason under
   "Rejected:", matching the dedicated Reject flow's existing display.
4. Edit that same (now-rejected) idea again, change status to something else (e.g. "New"),
   leave everything else alone, and Save — confirm the card moves back to that status and
   its stored rejection reason is preserved (not wiped) even though the reason field wasn't
   shown/touched during this edit (reload the page, then re-open edit and switch back to
   "Rejected" temporarily to confirm the original reason text is still there — or check via
   the live-verification curl call in Task 2).
5. Edit a normal (non-rejected) idea and change its status directly to "Done" or
   "In Progress" via the dropdown — confirm it moves to the correct filter tab after saving,
   exactly as if the dedicated buttons had been used.
6. Confirm the existing Approve/Reject/Move-to-Tasks/Move-to-Done buttons on the
   non-editing card view still work exactly as before (unaffected by this change).

Stop and fix before proceeding if any of these deviate.

- [ ] **Step 8: Commit**

```bash
git add src/app/ideas/page.tsx
git commit -m "$(cat <<'EOF'
feat: let the Idea Board edit form set any status directly

Adds a status dropdown to the inline edit form, with a required reason
field when the chosen status is Rejected. The existing dedicated
Approve/Reject/Move-to-Tasks/Move-to-Done buttons are unchanged - this
is an additional path, not a replacement.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 2: Deploy and verify live

**Files:** none (deployment/verification only).

- [ ] **Step 1: Push to origin/main**

```bash
git push origin main
```

- [ ] **Step 2: Trigger Coolify redeploy**

```bash
source ~/.bashrc
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" \
  "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

Note the returned `deployment_uuid`.

- [ ] **Step 3: Poll until finished**

```bash
source ~/.bashrc
curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" \
  "https://coolify.v-decent.org/api/v1/deployments/<deployment_uuid>"
```

Expected: `status` eventually becomes `"finished"`. If the build fails with a transient DNS
resolution error (git clone or Docker base-image pull — both classes have occurred this
session), retry the deploy trigger; more than one retry has been needed before.

- [ ] **Step 4: Verify live**

```bash
source ~/.bashrc
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" \
  "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "
import sys,json
envs = json.load(sys.stdin)
for e in envs:
    if e.get('key') == 'INTERNAL_API_SECRET' and not e.get('is_preview'):
        print(e.get('value'))
        break
")

# Create a throwaway idea, PUT it straight to "rejected" with a reason (simulating what the
# edit form's new status select + reason input will send), confirm it persisted, clean up.
CREATED=$(curl -sS -X POST "https://dashboard.v-decent.org/api/ideas" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"title":"edit-status verification idea","description":"x","category":"build","status":"new"}')
echo "$CREATED"
IDEA_ID=$(echo "$CREATED" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -sS -X PUT "https://dashboard.v-decent.org/api/ideas" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d "{\"id\":\"$IDEA_ID\",\"status\":\"rejected\",\"rejectionReason\":\"verification only\"}"
echo

curl -sS "https://dashboard.v-decent.org/api/ideas" -H "x-internal-secret: $SECRET" | python3 -c "
import sys, json
ideas = json.load(sys.stdin)
idea = next(i for i in ideas if i['id'] == '$IDEA_ID')
print('status:', idea['status'], '| rejectionReason:', idea['rejectionReason'])
"

curl -sS -X DELETE "https://dashboard.v-decent.org/api/ideas" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d "{\"id\":\"$IDEA_ID\"}"
echo
```

Expected: `status: rejected | rejectionReason: verification only`. This confirms the API side
of the new edit-form flow works correctly; report to the user that the deploy is live and ask
them to confirm the new status dropdown in the browser, since the dropdown/conditional-input
UI itself is client-rendered only.

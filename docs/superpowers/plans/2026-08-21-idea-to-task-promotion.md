# Idea-to-Task Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give approved ideas two explicit outcomes ("Move to Tasks" / "Move to Done"), add
a `description` field to the Tasks board (usable for any task, not just imported ones), and
bring the Idea Board's cards up to edit/delete parity with the Tasks board.

**Architecture:** Two independent Prisma model changes (`PersonalTask.description`,
`Idea.estimatedTime` + `Idea.rejectionReason` — the latter two fix a pre-existing bug where
these UI-collected fields were never persisted, confirmed against live production data,
which is also why editing an idea's estimated time needs them to exist as real columns).
Both API routes get small, additive changes. Both page components get edit/delete UI added
following the exact "lift edit state to the parent" pattern already proven on the Tasks page.
"Move to Tasks" is a pure client-side two-call sequence (`POST /api/tasks` then
`DELETE /api/ideas`) — no new endpoints.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma ORM, Postgres (`prisma db push
--accept-data-loss` on every container boot, no migration files), Tailwind, `@/components/ui/kit`
(`Panel`, `Button`, `Pill`, `Skeleton`, `EmptyState`, `rise`), `lucide-react` icons.

## Global Constraints

- No confirmation dialogs for delete or for "Move to Tasks"/"Move to Done" — matches the
  existing no-confirmation precedent on both boards.
- "Move to Tasks" only proceeds to delete the idea if the task creation (`POST /api/tasks`)
  succeeds. If task creation fails, the idea is left untouched.
- The created task gets `dueDate: null` (ideas have no due-date concept) and `priority: null`
  (ideas have no priority concept); `category` carries straight through as a free-text string
  (no mapping table — `PersonalTask.category` is already just a string).
- Idea category stays the existing fixed set (`build`/`content`/`feature`/`thread`/`experiment`)
  — no changes to that set.
- Edit forms on both boards do not allow changing status from the edit form — status changes
  stay on their existing dedicated controls (the Tasks board's per-card status `<select>`;
  the Idea Board's Approve/Reject/Move-to-Tasks/Move-to-Done buttons).
- Edit state (`editingId`/`editFields`) must live in the parent page component, not inside
  the card component — a `useState` initializer inside the card would only run once per
  mount and could show stale data on a second edit (the exact defect the Tasks board's own
  final review caught and required a fix for).
- No test suite exists in this repo. Verification is `npx tsc --noEmit`, `npx prisma
  validate`, and manual/live checks (curl for APIs, dev-server + visual reasoning for UI).
- Commit convention: clear subject + body, trailers `Co-Authored-By: Claude Sonnet 5
  <noreply@anthropic.com>` and `Claude-Session:
  https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW`.

---

### Task 1: Schema changes — `PersonalTask.description`, `Idea.estimatedTime`, `Idea.rejectionReason`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma.personalTask` gains a `description: string | null` field (consumed by
  Task 2, Task 4). `prisma.idea` gains `estimatedTime: string | null` and
  `rejectionReason: string | null` (consumed by Task 3, Task 5 — `rejectionReason` was
  already being sent by the existing Reject feature in `page.tsx`'s `handleReject`, it just
  had nowhere to land until now).

**Current `PersonalTask` model (lines 510-521):**

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

**Current `Idea` model:**

```prisma
model Idea {
  id          String   @id @default(uuid())
  title       String
  description String?
  category    String?
  type        String?
  model       String?
  status      String?
  timestamp   DateTime @default(now())

  @@index([category])
  @@index([type])
}
```

- [ ] **Step 1: Add `description` to `PersonalTask`**

Change the `PersonalTask` model to:

```prisma
model PersonalTask {
  id          String    @id @default(cuid())
  name        String
  description String?
  status      String    @default("Not started")
  priority    String?
  category    String?
  dueDate     DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([status])
}
```

- [ ] **Step 2: Add `estimatedTime` and `rejectionReason` to `Idea`**

Change the `Idea` model to:

```prisma
model Idea {
  id              String   @id @default(uuid())
  title           String
  description     String?
  category        String?
  type            String?
  model           String?
  status          String?
  estimatedTime   String?
  rejectionReason String?
  timestamp       DateTime @default(now())

  @@index([category])
  @@index([type])
}
```

- [ ] **Step 3: Validate**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: completes without error.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat: add description to PersonalTask, estimatedTime/rejectionReason to Idea

The latter two were already being sent by the existing UI (the "Add Idea"
form's estimated-time field, and the Reject flow's rejection reason) but
had no column to land in - PUT /api/ideas would throw on either field and
the error was silently swallowed into a generic 404, so estimated time
was never actually saved and Reject was silently failing to persist.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 2: Add `description` to `/api/tasks`

**Files:**
- Modify: `src/app/api/tasks/route.ts` (full-file replacement)

**Interfaces:**
- Consumes: `prisma.personalTask.description` from Task 1.
- Produces: `GET`/`POST`/`PATCH` responses now include `description: string | null` in each
  task object, consumed by Task 4's UI and by Task 5's "Move to Tasks" `POST` call.

**Current file content (154 lines total — shown in full since every function changes):**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function serialize(task: {
  id: string;
  name: string;
  status: string;
  priority: string | null;
  category: string | null;
  dueDate: Date | null;
}) {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    priority: task.priority,
    category: task.category,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  };
}

export async function GET() {
  try {
    const tasks = await prisma.personalTask.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ tasks: tasks.map(serialize) });
  } catch (error) {
    console.error("Tasks API error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, priority, category, dueDate } = await req.json();

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const task = await prisma.personalTask.create({
      data: {
        name: name.trim(),
        priority: priority || null,
        category: category || null,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });

    return NextResponse.json({ task: serialize(task) });
  } catch (error) {
    console.error("Create task error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, status, name, priority, category, dueDate } = await req.json();

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      data.name = name.trim();
    }
    if (priority !== undefined) data.priority = priority || null;
    if (category !== undefined) data.category = category || null;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;

    const task = await prisma.personalTask.update({ where: { id }, data });
    return NextResponse.json({ task: serialize(task) });
  } catch (error) {
    console.error("Update task error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await prisma.personalTask.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete task error:", error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
```

- [ ] **Step 1: Replace the full file**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function serialize(task: {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string | null;
  category: string | null;
  dueDate: Date | null;
}) {
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    status: task.status,
    priority: task.priority,
    category: task.category,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  };
}

export async function GET() {
  try {
    const tasks = await prisma.personalTask.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ tasks: tasks.map(serialize) });
  } catch (error) {
    console.error("Tasks API error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, description, priority, category, dueDate } = await req.json();

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const task = await prisma.personalTask.create({
      data: {
        name: name.trim(),
        description: description || null,
        priority: priority || null,
        category: category || null,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });

    return NextResponse.json({ task: serialize(task) });
  } catch (error) {
    console.error("Create task error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, status, name, description, priority, category, dueDate } = await req.json();

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      data.name = name.trim();
    }
    if (description !== undefined) data.description = description || null;
    if (priority !== undefined) data.priority = priority || null;
    if (category !== undefined) data.category = category || null;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;

    const task = await prisma.personalTask.update({ where: { id }, data });
    return NextResponse.json({ task: serialize(task) });
  } catch (error) {
    console.error("Update task error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await prisma.personalTask.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete task error:", error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tasks/route.ts
git commit -m "$(cat <<'EOF'
feat: pass description through /api/tasks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 3: Persist `estimatedTime` on idea creation

**Files:**
- Modify: `src/app/api/ideas/route.ts:16-31` (the `POST` handler only)

**Interfaces:**
- Consumes: `prisma.idea.estimatedTime` from Task 1.
- Produces: newly-created ideas now retain the estimated time chosen on the "Add Idea" form
  (previously silently dropped). No response-shape change (Prisma returns the full row,
  already including the new column automatically).

**Current `POST` handler:**

```ts
export async function POST(req: NextRequest) {
  const body = await req.json();

  const idea = await prisma.idea.create({
    data: {
      title: body.title,
      description: body.description || null,
      category: body.category || null,
      type: body.type || null,
      model: body.model || null,
      status: body.status || null,
    },
  });

  return NextResponse.json(idea);
}
```

- [ ] **Step 1: Add `estimatedTime` to the create call**

```ts
export async function POST(req: NextRequest) {
  const body = await req.json();

  const idea = await prisma.idea.create({
    data: {
      title: body.title,
      description: body.description || null,
      category: body.category || null,
      type: body.type || null,
      model: body.model || null,
      status: body.status || null,
      estimatedTime: body.estimatedTime || null,
    },
  });

  return NextResponse.json(idea);
}
```

Nothing else in this file changes — `GET`, `PUT`, and `DELETE` need no edits (`PUT` already
forwards every field in the request body directly to `prisma.idea.update`, so
`estimatedTime`/`rejectionReason` already flow through correctly for updates once Task 1's
schema change is live; only creation was explicitly whitelisting fields and dropping these
two).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ideas/route.ts
git commit -m "$(cat <<'EOF'
fix: persist estimatedTime when creating an idea

POST was silently dropping it even though the Add Idea form collects it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 4: Add `description` to the Tasks board UI

**Files:**
- Modify: `src/app/tasks/page.tsx` (full-file replacement)

**Interfaces:**
- Consumes: the `/api/tasks` contract from Task 2 (`description: string | null` on every
  task; accepted on `POST`/`PATCH`).
- Produces: nothing consumed elsewhere.

**Current file content (408 lines — reproduced in full since `Task`, `EditFields`, the
create form, the edit form, and the card display all change):**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button, Pill, rise } from "@/components/ui/kit";

interface Task {
  id: string;
  name: string;
  status: string;
  priority: string | null;
  category: string | null;
  dueDate: string | null;
}

interface EditFields {
  name: string;
  priority: string;
  category: string;
  dueDate: string;
}

const columns = [
  { id: "Not started", label: "To Do" },
  { id: "Approved", label: "Approved" },
  { id: "In progress", label: "In Progress" },
  { id: "Done", label: "Done" },
];

const EMPTY_EDIT: EditFields = { name: "", priority: "", category: "", dueDate: "" };

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "Done") return false;
  const dueDay = task.dueDate.slice(0, 10);
  const today = new Date().toLocaleDateString("en-CA");
  return dueDay < today;
}

function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState("");
  const [newPriority, setNewPriority] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>(EMPTY_EDIT);

  useEffect(() => {
    fetchTasks();
  }, []);

  async function fetchTasks() {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (e) {
      console.error("Failed to fetch tasks", e);
    } finally {
      setLoading(false);
    }
  }

  async function addTask() {
    if (!newTask.trim()) return;
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTask,
          priority: newPriority || undefined,
          category: newCategory || undefined,
          dueDate: newDueDate || undefined,
        }),
      });
      setNewTask("");
      setNewPriority("");
      setNewCategory("");
      setNewDueDate("");
      setShowAddTask(false);
      fetchTasks();
    } catch (e) {
      console.error("Failed to add task", e);
    }
  }

  async function updateTaskStatus(taskId: string, newStatus: string) {
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: newStatus }),
      });
      fetchTasks();
    } catch (e) {
      console.error("Failed to update task", e);
    }
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditFields({
      name: task.name,
      priority: task.priority || "",
      category: task.category || "",
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditFields(EMPTY_EDIT);
  }

  async function saveEdit(taskId: string) {
    if (!editFields.name.trim()) return;
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskId,
          name: editFields.name.trim(),
          priority: editFields.priority || null,
          category: editFields.category || null,
          dueDate: editFields.dueDate || null,
        }),
      });
      cancelEdit();
      fetchTasks();
    } catch (e) {
      console.error("Failed to save task edit", e);
    }
  }

  async function deleteTask(taskId: string) {
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId }),
      });
      fetchTasks();
    } catch (e) {
      console.error("Failed to delete task", e);
    }
  }

  if (loading) {
    return (
      <>
        <div className="relative z-10 w-full mx-auto pt-4">
          <div className="flex justify-between items-center mb-10">
            <div>
              <div className="sk h-3 w-20 mb-3" />
              <div className="sk h-7 w-28" />
            </div>
            <div className="sk h-9 w-28 rounded-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="panel p-4">
                <div className="sk h-4 w-16 mb-4" />
                <div className="space-y-2">
                  {[...Array(i + 1)].map((_, j) => <div key={j} className="sk h-16 rounded-[var(--r-md)]" />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="relative z-10 h-full flex flex-col w-full mx-auto pt-4 pb-16">
        <div className="hq-rise flex justify-between items-end gap-4 mb-10" style={rise(0)}>
          <div>
            <div className="eyebrow mb-2">Your personal board</div>
            <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Tasks</h1>
          </div>
          <Button variant="primary" onClick={() => setShowAddTask(true)}>+ Add Task</Button>
        </div>

        {showAddTask && (
          <div className="hq-rise elevated mb-8 p-5">
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text)] placeholder-[var(--text-3)] rounded-[var(--r-md)] px-4 py-3 mb-3 text-[14px] focus:outline-none focus:border-[var(--line-strong)]"
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              autoFocus
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
                className="bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text-2)] rounded-[var(--r-md)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              >
                <option value="">No priority</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Category (optional)"
                className="bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text)] placeholder-[var(--text-3)] rounded-[var(--r-md)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              />
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text-2)] rounded-[var(--r-md)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={addTask}>Add Task</Button>
              <Button variant="ghost" onClick={() => setShowAddTask(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 overflow-hidden">
          {columns.map((column, idx) => {
            const count = tasks.filter((t) => t.status === column.id).length;
            return (
              <div key={column.id} className="hq-rise panel flex flex-col overflow-hidden" style={rise(idx + 1)}>
                <div className="px-4 py-3.5 flex items-center justify-between">
                  <span className="eyebrow">{column.label}</span>
                  <span className="num text-[11px] text-[var(--text-3)]">{count}</span>
                </div>
                <div className="rule" />
                <div className="flex-1 p-2.5 space-y-2 overflow-y-auto">
                  {tasks
                    .filter((t) => t.status === column.id)
                    .map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        done={column.id === "Done"}
                        isEditing={editingId === task.id}
                        editFields={editFields}
                        onEditFieldsChange={setEditFields}
                        onStatusChange={(status) => updateTaskStatus(task.id, status)}
                        onStartEdit={() => startEdit(task)}
                        onCancelEdit={cancelEdit}
                        onSaveEdit={() => saveEdit(task.id)}
                        onDelete={() => deleteTask(task.id)}
                      />
                    ))}
                  {count === 0 && (
                    <p className="text-[var(--text-4)] text-[12.5px] text-center py-8">No tasks</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function TaskCard({
  task,
  done,
  isEditing,
  editFields,
  onEditFieldsChange,
  onStatusChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  task: Task;
  done?: boolean;
  isEditing: boolean;
  editFields: EditFields;
  onEditFieldsChange: (fields: EditFields) => void;
  onStatusChange: (status: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}) {
  const priorityTone: Record<string, "warn" | "neutral"> = {
    High: "warn",
    Medium: "neutral",
    Low: "neutral",
  };

  if (isEditing) {
    return (
      <div className="rounded-[var(--r-md)] border border-[var(--line-strong)] bg-[var(--surface-1)] p-3.5 space-y-2">
        <input
          type="text"
          value={editFields.name}
          onChange={(e) => onEditFieldsChange({ ...editFields, name: e.target.value })}
          className="w-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={editFields.priority}
            onChange={(e) => onEditFieldsChange({ ...editFields, priority: e.target.value })}
            className="bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] rounded-[var(--r-sm)] px-2 py-1.5 text-[12px] focus:outline-none focus:border-[var(--line-strong)]"
          >
            <option value="">No priority</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          <input
            type="text"
            value={editFields.category}
            onChange={(e) => onEditFieldsChange({ ...editFields, category: e.target.value })}
            placeholder="Category"
            className="bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)] placeholder-[var(--text-3)] rounded-[var(--r-sm)] px-2 py-1.5 text-[12px] focus:outline-none focus:border-[var(--line-strong)]"
          />
        </div>
        <input
          type="date"
          value={editFields.dueDate}
          onChange={(e) => onEditFieldsChange({ ...editFields, dueDate: e.target.value })}
          className="w-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-[var(--line-strong)]"
        />
        <div className="flex gap-2 pt-1">
          <Button variant="primary" size="sm" onClick={onSaveEdit}>Save</Button>
          <Button variant="ghost" size="sm" onClick={onCancelEdit}>Cancel</Button>
        </div>
      </div>
    );
  }

  const overdue = isOverdue(task);

  return (
    <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-1)] p-3.5 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] cursor-pointer group">
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className={`font-medium text-[13px] leading-relaxed ${done ? "text-[var(--text-3)] line-through" : "text-[var(--text)]"}`}>
          {task.name}
        </p>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={onStartEdit}
            className="text-[var(--text-3)] hover:text-[var(--text)] transition-colors p-1"
            aria-label="Edit task"
            title="Edit task"
          >
            ✏️
          </button>
          <button
            onClick={onDelete}
            className="text-[var(--text-3)] hover:text-[var(--down)] transition-colors p-1"
            aria-label="Delete task"
            title="Delete task"
          >
            🗑️
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {task.priority && (
          <Pill tone={priorityTone[task.priority] || "neutral"}>{task.priority}</Pill>
        )}
        {task.category && (
          <span className="text-[11px] text-[var(--text-3)]">{task.category}</span>
        )}
        {task.dueDate && (
          <span
            className="text-[11px]"
            style={{ color: overdue ? "var(--warn)" : "var(--text-3)" }}
          >
            Due {formatDueDate(task.dueDate)}
          </span>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--line)] opacity-0 group-hover:opacity-100 transition-opacity">
        <select
          className="text-[12px] bg-[var(--surface-1)] text-[var(--text-2)] rounded-[var(--r-sm)] px-3 py-2 w-full border border-[var(--line)] focus:outline-none focus:border-[var(--line-strong)]"
          value={task.status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          {columns.map((col) => (
            <option key={col.id} value={col.id}>
              Move to {col.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 1: Replace the full file with the target end-state below**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button, Pill, rise } from "@/components/ui/kit";

interface Task {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string | null;
  category: string | null;
  dueDate: string | null;
}

interface EditFields {
  name: string;
  description: string;
  priority: string;
  category: string;
  dueDate: string;
}

const columns = [
  { id: "Not started", label: "To Do" },
  { id: "Approved", label: "Approved" },
  { id: "In progress", label: "In Progress" },
  { id: "Done", label: "Done" },
];

const EMPTY_EDIT: EditFields = { name: "", description: "", priority: "", category: "", dueDate: "" };

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "Done") return false;
  const dueDay = task.dueDate.slice(0, 10);
  const today = new Date().toLocaleDateString("en-CA");
  return dueDay < today;
}

function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFields>(EMPTY_EDIT);

  useEffect(() => {
    fetchTasks();
  }, []);

  async function fetchTasks() {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (e) {
      console.error("Failed to fetch tasks", e);
    } finally {
      setLoading(false);
    }
  }

  async function addTask() {
    if (!newTask.trim()) return;
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTask,
          description: newDescription || undefined,
          priority: newPriority || undefined,
          category: newCategory || undefined,
          dueDate: newDueDate || undefined,
        }),
      });
      setNewTask("");
      setNewDescription("");
      setNewPriority("");
      setNewCategory("");
      setNewDueDate("");
      setShowAddTask(false);
      fetchTasks();
    } catch (e) {
      console.error("Failed to add task", e);
    }
  }

  async function updateTaskStatus(taskId: string, newStatus: string) {
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: newStatus }),
      });
      fetchTasks();
    } catch (e) {
      console.error("Failed to update task", e);
    }
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditFields({
      name: task.name,
      description: task.description || "",
      priority: task.priority || "",
      category: task.category || "",
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditFields(EMPTY_EDIT);
  }

  async function saveEdit(taskId: string) {
    if (!editFields.name.trim()) return;
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskId,
          name: editFields.name.trim(),
          description: editFields.description || null,
          priority: editFields.priority || null,
          category: editFields.category || null,
          dueDate: editFields.dueDate || null,
        }),
      });
      cancelEdit();
      fetchTasks();
    } catch (e) {
      console.error("Failed to save task edit", e);
    }
  }

  async function deleteTask(taskId: string) {
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId }),
      });
      fetchTasks();
    } catch (e) {
      console.error("Failed to delete task", e);
    }
  }

  if (loading) {
    return (
      <>
        <div className="relative z-10 w-full mx-auto pt-4">
          <div className="flex justify-between items-center mb-10">
            <div>
              <div className="sk h-3 w-20 mb-3" />
              <div className="sk h-7 w-28" />
            </div>
            <div className="sk h-9 w-28 rounded-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="panel p-4">
                <div className="sk h-4 w-16 mb-4" />
                <div className="space-y-2">
                  {[...Array(i + 1)].map((_, j) => <div key={j} className="sk h-16 rounded-[var(--r-md)]" />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="relative z-10 h-full flex flex-col w-full mx-auto pt-4 pb-16">
        <div className="hq-rise flex justify-between items-end gap-4 mb-10" style={rise(0)}>
          <div>
            <div className="eyebrow mb-2">Your personal board</div>
            <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Tasks</h1>
          </div>
          <Button variant="primary" onClick={() => setShowAddTask(true)}>+ Add Task</Button>
        </div>

        {showAddTask && (
          <div className="hq-rise elevated mb-8 p-5">
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text)] placeholder-[var(--text-3)] rounded-[var(--r-md)] px-4 py-3 mb-3 text-[14px] focus:outline-none focus:border-[var(--line-strong)]"
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              autoFocus
            />
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text)] placeholder-[var(--text-3)] rounded-[var(--r-md)] px-4 py-3 mb-3 text-[14px] resize-none focus:outline-none focus:border-[var(--line-strong)]"
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
                className="bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text-2)] rounded-[var(--r-md)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              >
                <option value="">No priority</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Category (optional)"
                className="bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text)] placeholder-[var(--text-3)] rounded-[var(--r-md)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              />
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text-2)] rounded-[var(--r-md)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={addTask}>Add Task</Button>
              <Button variant="ghost" onClick={() => setShowAddTask(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 overflow-hidden">
          {columns.map((column, idx) => {
            const count = tasks.filter((t) => t.status === column.id).length;
            return (
              <div key={column.id} className="hq-rise panel flex flex-col overflow-hidden" style={rise(idx + 1)}>
                <div className="px-4 py-3.5 flex items-center justify-between">
                  <span className="eyebrow">{column.label}</span>
                  <span className="num text-[11px] text-[var(--text-3)]">{count}</span>
                </div>
                <div className="rule" />
                <div className="flex-1 p-2.5 space-y-2 overflow-y-auto">
                  {tasks
                    .filter((t) => t.status === column.id)
                    .map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        done={column.id === "Done"}
                        isEditing={editingId === task.id}
                        editFields={editFields}
                        onEditFieldsChange={setEditFields}
                        onStatusChange={(status) => updateTaskStatus(task.id, status)}
                        onStartEdit={() => startEdit(task)}
                        onCancelEdit={cancelEdit}
                        onSaveEdit={() => saveEdit(task.id)}
                        onDelete={() => deleteTask(task.id)}
                      />
                    ))}
                  {count === 0 && (
                    <p className="text-[var(--text-4)] text-[12.5px] text-center py-8">No tasks</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function TaskCard({
  task,
  done,
  isEditing,
  editFields,
  onEditFieldsChange,
  onStatusChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  task: Task;
  done?: boolean;
  isEditing: boolean;
  editFields: EditFields;
  onEditFieldsChange: (fields: EditFields) => void;
  onStatusChange: (status: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}) {
  const priorityTone: Record<string, "warn" | "neutral"> = {
    High: "warn",
    Medium: "neutral",
    Low: "neutral",
  };

  if (isEditing) {
    return (
      <div className="rounded-[var(--r-md)] border border-[var(--line-strong)] bg-[var(--surface-1)] p-3.5 space-y-2">
        <input
          type="text"
          value={editFields.name}
          onChange={(e) => onEditFieldsChange({ ...editFields, name: e.target.value })}
          className="w-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
          autoFocus
        />
        <textarea
          value={editFields.description}
          onChange={(e) => onEditFieldsChange({ ...editFields, description: e.target.value })}
          placeholder="Description (optional)"
          rows={2}
          className="w-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)] placeholder-[var(--text-3)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-[12px] resize-none focus:outline-none focus:border-[var(--line-strong)]"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={editFields.priority}
            onChange={(e) => onEditFieldsChange({ ...editFields, priority: e.target.value })}
            className="bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] rounded-[var(--r-sm)] px-2 py-1.5 text-[12px] focus:outline-none focus:border-[var(--line-strong)]"
          >
            <option value="">No priority</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          <input
            type="text"
            value={editFields.category}
            onChange={(e) => onEditFieldsChange({ ...editFields, category: e.target.value })}
            placeholder="Category"
            className="bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)] placeholder-[var(--text-3)] rounded-[var(--r-sm)] px-2 py-1.5 text-[12px] focus:outline-none focus:border-[var(--line-strong)]"
          />
        </div>
        <input
          type="date"
          value={editFields.dueDate}
          onChange={(e) => onEditFieldsChange({ ...editFields, dueDate: e.target.value })}
          className="w-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-[var(--line-strong)]"
        />
        <div className="flex gap-2 pt-1">
          <Button variant="primary" size="sm" onClick={onSaveEdit}>Save</Button>
          <Button variant="ghost" size="sm" onClick={onCancelEdit}>Cancel</Button>
        </div>
      </div>
    );
  }

  const overdue = isOverdue(task);

  return (
    <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-1)] p-3.5 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] cursor-pointer group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className={`font-medium text-[13px] leading-relaxed ${done ? "text-[var(--text-3)] line-through" : "text-[var(--text)]"}`}>
          {task.name}
        </p>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={onStartEdit}
            className="text-[var(--text-3)] hover:text-[var(--text)] transition-colors p-1"
            aria-label="Edit task"
            title="Edit task"
          >
            ✏️
          </button>
          <button
            onClick={onDelete}
            className="text-[var(--text-3)] hover:text-[var(--down)] transition-colors p-1"
            aria-label="Delete task"
            title="Delete task"
          >
            🗑️
          </button>
        </div>
      </div>
      {task.description && (
        <p className="text-[var(--text-2)] text-[12px] leading-relaxed mb-3">{task.description}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {task.priority && (
          <Pill tone={priorityTone[task.priority] || "neutral"}>{task.priority}</Pill>
        )}
        {task.category && (
          <span className="text-[11px] text-[var(--text-3)]">{task.category}</span>
        )}
        {task.dueDate && (
          <span
            className="text-[11px]"
            style={{ color: overdue ? "var(--warn)" : "var(--text-3)" }}
          >
            Due {formatDueDate(task.dueDate)}
          </span>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--line)] opacity-0 group-hover:opacity-100 transition-opacity">
        <select
          className="text-[12px] bg-[var(--surface-1)] text-[var(--text-2)] rounded-[var(--r-sm)] px-3 py-2 w-full border border-[var(--line)] focus:outline-none focus:border-[var(--line-strong)]"
          value={task.status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          {columns.map((col) => (
            <option key={col.id} value={col.id}>
              Move to {col.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

Notes: `description` is treated exactly like `category` throughout (optional on create,
nullable on partial update, `|| null` on save, `|| undefined` on create so a blank field is
simply omitted from the request body). The card only renders the description paragraph when
present (`{task.description && (...)}`), so tasks without one look exactly as they did before
this task.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/tasks/page.tsx
git commit -m "$(cat <<'EOF'
feat: add description field to the Tasks board

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 5: Idea Board — edit/delete on every card, Move to Tasks / Move to Done on approved cards

**Files:**
- Modify: `src/app/ideas/page.tsx` (full-file replacement)

**Interfaces:**
- Consumes: `/api/tasks` `POST` (Task 2's contract, now including `description`) and
  `/api/ideas` `PUT`/`DELETE` (already existing, now with working `estimatedTime`/
  `rejectionReason` persistence per Task 1).
- Produces: nothing consumed elsewhere.

**Current file content (412 lines — reproduced in full since `IdeaCard`'s props and body
change substantially, and `IdeasPage` gains new state and handlers):**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Clock, Lightbulb, Check, X } from "lucide-react";
import { Panel, Pill, Button, Skeleton, EmptyState, rise } from "@/components/ui/kit";

interface Idea {
  id: string;
  title: string;
  description: string;
  source: string;
  category: string;
  estimatedTime: string;
  status: string;
  createdAt?: string;
  timestamp?: string;
  rejectionReason?: string;
}

type Tone = "neutral" | "up" | "down" | "warn" | "accent";

const STATUS_CONFIG: Record<string, { label: string; tone: Tone }> = {
  new:           { label: "New",         tone: "accent" },
  considering:   { label: "Considering", tone: "warn" },
  approved:      { label: "Approved",    tone: "up" },
  "in-progress": { label: "In Progress", tone: "accent" },
  done:          { label: "Done",        tone: "up" },
  rejected:      { label: "Rejected",    tone: "down" },
};

const CATEGORY_CONFIG: Record<string, { label: string }> = {
  build:      { label: "Build" },
  content:    { label: "Content" },
  feature:    { label: "Feature" },
  thread:     { label: "Thread" },
  experiment: { label: "Experiment" },
};

const inputCls =
  "w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-[var(--r-sm)] px-4 py-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--line-strong)] transition-colors";

function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return ""; }
}

function IdeaCard({ idea, onUpdate }: { idea: Idea; onUpdate: () => void }) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const status = idea.status || "new";
  const statusConf = STATUS_CONFIG[status] || STATUS_CONFIG.new;
  const catConf = CATEGORY_CONFIG[idea.category] || { label: idea.category || "other" };
  const date = idea.createdAt || idea.timestamp || "";
  const isDead = status === "rejected" || status === "done";
  const isApproved = status === "approved";

  const updateIdea = async (updates: Partial<Idea>) => {
    await fetch("/api/ideas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: idea.id, ...updates }),
    });
    onUpdate();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    await updateIdea({ status: "rejected", rejectionReason: rejectReason.trim() });
    setIsRejecting(false);
    setRejectReason("");
  };

  return (
    <Panel
      className={`p-5 ${isDead ? "opacity-55 hover:opacity-80 transition-opacity" : ""}`}
      style={isApproved ? { borderColor: "color-mix(in srgb, var(--up) 28%, transparent)" } : undefined}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={statusConf.tone}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
            {statusConf.label}
          </Pill>
          <Pill tone="neutral">{catConf.label}</Pill>
        </div>
        <div className="flex items-center gap-3 text-[11px] num text-[var(--text-4)] shrink-0">
          {date && <span>{formatDate(date)}</span>}
          {idea.estimatedTime && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {idea.estimatedTime}
            </span>
          )}
        </div>
      </div>

      {/* Title + description */}
      <h3 className="text-[14px] font-semibold text-[var(--text)] mb-1.5 leading-snug">{idea.title}</h3>
      <p className="text-[var(--text-2)] text-[13px] leading-relaxed mb-4">{idea.description}</p>

      {/* Rejection reason */}
      {status === "rejected" && idea.rejectionReason && (
        <div
          className="rounded-[var(--r-sm)] px-3 py-2 mb-4"
          style={{
            background: "color-mix(in srgb, var(--down) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--down) 22%, transparent)",
          }}
        >
          <p className="text-[12px]" style={{ color: "var(--down)" }}>
            <span className="font-medium">Rejected:</span> {idea.rejectionReason}
          </p>
        </div>
      )}

      {/* Source */}
      {idea.source && idea.source !== "manual" && (
        <p className="text-[var(--text-4)] text-[11px] num mb-3">via {idea.source}</p>
      )}

      {/* Actions */}
      {!isDead && !isApproved && !isRejecting && (
        <div className="flex gap-2">
          <button
            onClick={() => updateIdea({ status: "approved" })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors"
            style={{ color: "var(--up)", borderColor: "color-mix(in srgb, var(--up) 24%, transparent)" }}
          >
            <Check className="w-3 h-3" />
            Approve
          </button>
          <button
            onClick={() => setIsRejecting(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors"
            style={{ color: "var(--down)", borderColor: "color-mix(in srgb, var(--down) 24%, transparent)" }}
          >
            <X className="w-3 h-3" />
            Reject
          </button>
        </div>
      )}

      {isApproved && (
        <div className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--up)" }}>
          <Check className="w-3 h-3" />
          <span>Approved</span>
        </div>
      )}

      {/* Reject input */}
      {isRejecting && (
        <div className="flex gap-2">
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleReject()}
            placeholder="Why reject? (helps Sage learn)"
            className="flex-1 bg-[var(--surface-2)] border rounded-full px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none transition-colors"
            style={{ borderColor: "color-mix(in srgb, var(--down) 28%, transparent)" }}
            autoFocus
          />
          <button
            onClick={handleReject}
            disabled={!rejectReason.trim()}
            className="px-3 py-2 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--down)", borderColor: "color-mix(in srgb, var(--down) 28%, transparent)" }}
          >
            Reject
          </button>
          <button
            onClick={() => { setIsRejecting(false); setRejectReason(""); }}
            className="px-3 py-2 rounded-full text-[12px] text-[var(--text-3)] hover:text-[var(--text)] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </Panel>
  );
}

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [newIdea, setNewIdea] = useState({ title: "", description: "", source: "manual", category: "build", estimatedTime: "1 hour", status: "new" });
  const [submitting, setSubmitting] = useState(false);

  const fetchIdeas = useCallback(async () => {
    try {
      const res = await fetch("/api/ideas");
      const data = await res.json();
      setIdeas(data);
    } catch { /* noop */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIdeas(); }, [fetchIdeas]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdea.title.trim() || !newIdea.description.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newIdea, createdAt: new Date().toISOString() }),
      });
      await fetchIdeas();
      setNewIdea({ title: "", description: "", source: "manual", category: "build", estimatedTime: "1 hour", status: "new" });
      setShowForm(false);
    } catch { /* noop */ } finally { setSubmitting(false); }
  };

  const sorted = [...ideas].sort((a, b) => {
    const da = a.createdAt || a.timestamp || "";
    const db = b.createdAt || b.timestamp || "";
    return db.localeCompare(da);
  });

  const filtered = sorted.filter((idea) => {
    const s = idea.status || "new";
    if (statusFilter === "active" && (s === "rejected" || s === "done")) return false;
    if (statusFilter !== "active" && statusFilter !== "all" && s !== statusFilter) return false;
    if (categoryFilter !== "all" && (idea.category || "") !== categoryFilter) return false;
    return true;
  });

  const uniqueCategories = [...new Set(ideas.map(i => i.category).filter(Boolean))];

  const statusTabs = [
    { key: "active", label: "Active", count: ideas.filter(i => !["rejected","done"].includes(i.status)).length },
    { key: "all", label: "All", count: ideas.length },
    { key: "approved", label: "Approved", count: ideas.filter(i => i.status === "approved").length },
    { key: "done", label: "Done", count: ideas.filter(i => i.status === "done").length },
    { key: "rejected", label: "Rejected", count: ideas.filter(i => i.status === "rejected").length },
  ];

  if (loading) {
    return (
      <div className="w-full mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-32" />
          </div>
          <Skeleton className="h-9 w-28 !rounded-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="panel p-5 space-y-3">
              <div className="flex gap-2"><Skeleton className="h-5 w-16 !rounded-full" /><Skeleton className="h-5 w-14 !rounded-full" /></div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto p-6 pb-16">
      {/* Header */}
      <div className="hq-rise flex items-end justify-between gap-4 pt-2 pb-8" style={rise(0)}>
        <div>
          <div className="eyebrow mb-2.5 flex items-center gap-1.5">
            <Lightbulb className="w-3.5 h-3.5" />
            Ideas
          </div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Idea Board</h1>
          <p className="num text-[var(--text-4)] text-[12px] mt-3">{filtered.length} showing · {ideas.length} total</p>
        </div>
        <Button
          variant={showForm ? "ghost" : "primary"}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "Cancel" : "Add Idea"}
        </Button>
      </div>

      {/* Add Idea Form */}
      {showForm && (
        <div className="hq-rise panel p-6 mb-8" style={rise(1)}>
          <span className="eyebrow">New Idea</span>
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <input
              type="text"
              value={newIdea.title}
              onChange={(e) => setNewIdea({ ...newIdea, title: e.target.value })}
              className={inputCls}
              placeholder="Idea title *"
              required
            />
            <textarea
              value={newIdea.description}
              onChange={(e) => setNewIdea({ ...newIdea, description: e.target.value })}
              className={`${inputCls} resize-none`}
              placeholder="Describe the idea *"
              rows={3}
              required
            />
            <div className="flex gap-3">
              <select
                value={newIdea.category}
                onChange={(e) => setNewIdea({ ...newIdea, category: e.target.value })}
                className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              >
                <option value="build">Build</option>
                <option value="content">Content</option>
                <option value="feature">Feature</option>
                <option value="thread">Thread</option>
                <option value="experiment">Experiment</option>
              </select>
              <select
                value={newIdea.estimatedTime}
                onChange={(e) => setNewIdea({ ...newIdea, estimatedTime: e.target.value })}
                className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              >
                <option value="30 minutes">30 min</option>
                <option value="1 hour">1 hour</option>
                <option value="2 hours">2 hours</option>
                <option value="3 hours">3 hours</option>
                <option value="Half day">Half day</option>
                <option value="Full day">Full day</option>
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || !newIdea.title.trim() || !newIdea.description.trim()}
              >
                {submitting ? "Adding..." : "Add Idea"}
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors flex items-center gap-1.5 border ${
              statusFilter === tab.key
                ? "bg-[var(--surface-2)] text-[var(--text)] border-[var(--line-strong)]"
                : "text-[var(--text-3)] hover:text-[var(--text)] border-[var(--line)] hover:border-[var(--line-strong)]"
            }`}
          >
            {tab.label}
            <span className="num text-[10px] text-[var(--text-4)]">{tab.count}</span>
          </button>
        ))}
        {uniqueCategories.length > 0 && (
          <>
            <div className="w-px h-4 bg-[var(--line)] mx-1" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent border border-[var(--line)] text-[var(--text-2)] px-3 py-1.5 rounded-full text-[12px] focus:outline-none focus:border-[var(--line-strong)]"
            >
              <option value="all">All Categories</option>
              {uniqueCategories.map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Ideas grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} onUpdate={fetchIdeas} />
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={<Lightbulb className="w-8 h-8" />}
            title="No ideas found"
            hint={statusFilter !== "all" ? "Try adjusting your filters" : "Add your first idea to get started"}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 1: Replace the full file with the target end-state below**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Clock, Lightbulb, Check, X, Pencil, Trash2, ArrowRight, CheckCircle2 } from "lucide-react";
import { Panel, Pill, Button, Skeleton, EmptyState, rise } from "@/components/ui/kit";

interface Idea {
  id: string;
  title: string;
  description: string;
  source: string;
  category: string;
  estimatedTime: string;
  status: string;
  createdAt?: string;
  timestamp?: string;
  rejectionReason?: string;
}

interface IdeaEditFields {
  title: string;
  description: string;
  category: string;
  estimatedTime: string;
}

type Tone = "neutral" | "up" | "down" | "warn" | "accent";

const STATUS_CONFIG: Record<string, { label: string; tone: Tone }> = {
  new:           { label: "New",         tone: "accent" },
  considering:   { label: "Considering", tone: "warn" },
  approved:      { label: "Approved",    tone: "up" },
  "in-progress": { label: "In Progress", tone: "accent" },
  done:          { label: "Done",        tone: "up" },
  rejected:      { label: "Rejected",    tone: "down" },
};

const CATEGORY_CONFIG: Record<string, { label: string }> = {
  build:      { label: "Build" },
  content:    { label: "Content" },
  feature:    { label: "Feature" },
  thread:     { label: "Thread" },
  experiment: { label: "Experiment" },
};

const inputCls =
  "w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-[var(--r-sm)] px-4 py-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--line-strong)] transition-colors";

const EMPTY_IDEA_EDIT: IdeaEditFields = { title: "", description: "", category: "build", estimatedTime: "1 hour" };

function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return ""; }
}

function IdeaCard({
  idea,
  isEditing,
  editFields,
  onEditFieldsChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onUpdate,
}: {
  idea: Idea;
  isEditing: boolean;
  editFields: IdeaEditFields;
  onEditFieldsChange: (fields: IdeaEditFields) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onUpdate: () => void;
}) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const status = idea.status || "new";
  const statusConf = STATUS_CONFIG[status] || STATUS_CONFIG.new;
  const catConf = CATEGORY_CONFIG[idea.category] || { label: idea.category || "other" };
  const date = idea.createdAt || idea.timestamp || "";
  const isDead = status === "rejected" || status === "done";
  const isApproved = status === "approved";

  const updateIdea = async (updates: Partial<Idea>) => {
    await fetch("/api/ideas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: idea.id, ...updates }),
    });
    onUpdate();
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    await updateIdea({ status: "rejected", rejectionReason: rejectReason.trim() });
    setIsRejecting(false);
    setRejectReason("");
  };

  const handleMoveToDone = () => updateIdea({ status: "done" });

  const handleMoveToTasks = async () => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: idea.title,
          description: idea.description || undefined,
          category: idea.category || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Failed to create task: ${res.status}`);
      await fetch("/api/ideas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: idea.id }),
      });
      onUpdate();
    } catch (e) {
      console.error("Failed to move idea to tasks", e);
    }
  };

  if (isEditing) {
    return (
      <Panel className="p-5 space-y-3">
        <input
          type="text"
          value={editFields.title}
          onChange={(e) => onEditFieldsChange({ ...editFields, title: e.target.value })}
          className={inputCls}
          placeholder="Idea title"
          autoFocus
        />
        <textarea
          value={editFields.description}
          onChange={(e) => onEditFieldsChange({ ...editFields, description: e.target.value })}
          className={`${inputCls} resize-none`}
          placeholder="Describe the idea"
          rows={3}
        />
        <div className="flex gap-3">
          <select
            value={editFields.category}
            onChange={(e) => onEditFieldsChange({ ...editFields, category: e.target.value })}
            className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
          >
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

  return (
    <Panel
      className={`p-5 group ${isDead ? "opacity-55 hover:opacity-80 transition-opacity" : ""}`}
      style={isApproved ? { borderColor: "color-mix(in srgb, var(--up) 28%, transparent)" } : undefined}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={statusConf.tone}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
            {statusConf.label}
          </Pill>
          <Pill tone="neutral">{catConf.label}</Pill>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-3 text-[11px] num text-[var(--text-4)]">
            {date && <span>{formatDate(date)}</span>}
            {idea.estimatedTime && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {idea.estimatedTime}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={onStartEdit}
              className="text-[var(--text-3)] hover:text-[var(--text)] transition-colors p-1"
              aria-label="Edit idea"
              title="Edit idea"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="text-[var(--text-3)] hover:text-[var(--down)] transition-colors p-1"
              aria-label="Delete idea"
              title="Delete idea"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Title + description */}
      <h3 className="text-[14px] font-semibold text-[var(--text)] mb-1.5 leading-snug">{idea.title}</h3>
      <p className="text-[var(--text-2)] text-[13px] leading-relaxed mb-4">{idea.description}</p>

      {/* Rejection reason */}
      {status === "rejected" && idea.rejectionReason && (
        <div
          className="rounded-[var(--r-sm)] px-3 py-2 mb-4"
          style={{
            background: "color-mix(in srgb, var(--down) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--down) 22%, transparent)",
          }}
        >
          <p className="text-[12px]" style={{ color: "var(--down)" }}>
            <span className="font-medium">Rejected:</span> {idea.rejectionReason}
          </p>
        </div>
      )}

      {/* Source */}
      {idea.source && idea.source !== "manual" && (
        <p className="text-[var(--text-4)] text-[11px] num mb-3">via {idea.source}</p>
      )}

      {/* Actions */}
      {!isDead && !isApproved && !isRejecting && (
        <div className="flex gap-2">
          <button
            onClick={() => updateIdea({ status: "approved" })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors"
            style={{ color: "var(--up)", borderColor: "color-mix(in srgb, var(--up) 24%, transparent)" }}
          >
            <Check className="w-3 h-3" />
            Approve
          </button>
          <button
            onClick={() => setIsRejecting(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors"
            style={{ color: "var(--down)", borderColor: "color-mix(in srgb, var(--down) 24%, transparent)" }}
          >
            <X className="w-3 h-3" />
            Reject
          </button>
        </div>
      )}

      {isApproved && (
        <div className="flex gap-2">
          <button
            onClick={handleMoveToTasks}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors"
            style={{ color: "var(--accent)", borderColor: "color-mix(in srgb, var(--accent) 24%, transparent)" }}
          >
            <ArrowRight className="w-3 h-3" />
            Move to Tasks
          </button>
          <button
            onClick={handleMoveToDone}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors"
            style={{ color: "var(--up)", borderColor: "color-mix(in srgb, var(--up) 24%, transparent)" }}
          >
            <CheckCircle2 className="w-3 h-3" />
            Move to Done
          </button>
        </div>
      )}

      {/* Reject input */}
      {isRejecting && (
        <div className="flex gap-2">
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleReject()}
            placeholder="Why reject? (helps Sage learn)"
            className="flex-1 bg-[var(--surface-2)] border rounded-full px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none transition-colors"
            style={{ borderColor: "color-mix(in srgb, var(--down) 28%, transparent)" }}
            autoFocus
          />
          <button
            onClick={handleReject}
            disabled={!rejectReason.trim()}
            className="px-3 py-2 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--down)", borderColor: "color-mix(in srgb, var(--down) 28%, transparent)" }}
          >
            Reject
          </button>
          <button
            onClick={() => { setIsRejecting(false); setRejectReason(""); }}
            className="px-3 py-2 rounded-full text-[12px] text-[var(--text-3)] hover:text-[var(--text)] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </Panel>
  );
}

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [newIdea, setNewIdea] = useState({ title: "", description: "", source: "manual", category: "build", estimatedTime: "1 hour", status: "new" });
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<IdeaEditFields>(EMPTY_IDEA_EDIT);

  const fetchIdeas = useCallback(async () => {
    try {
      const res = await fetch("/api/ideas");
      const data = await res.json();
      setIdeas(data);
    } catch { /* noop */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIdeas(); }, [fetchIdeas]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdea.title.trim() || !newIdea.description.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newIdea, createdAt: new Date().toISOString() }),
      });
      await fetchIdeas();
      setNewIdea({ title: "", description: "", source: "manual", category: "build", estimatedTime: "1 hour", status: "new" });
      setShowForm(false);
    } catch { /* noop */ } finally { setSubmitting(false); }
  };

  function startEditIdea(idea: Idea) {
    setEditingId(idea.id);
    setEditFields({
      title: idea.title,
      description: idea.description || "",
      category: idea.category || "build",
      estimatedTime: idea.estimatedTime || "1 hour",
    });
  }

  function cancelEditIdea() {
    setEditingId(null);
    setEditFields(EMPTY_IDEA_EDIT);
  }

  async function saveEditIdea(id: string) {
    if (!editFields.title.trim()) return;
    try {
      await fetch("/api/ideas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          title: editFields.title.trim(),
          description: editFields.description,
          category: editFields.category,
          estimatedTime: editFields.estimatedTime,
        }),
      });
      cancelEditIdea();
      fetchIdeas();
    } catch (e) {
      console.error("Failed to save idea edit", e);
    }
  }

  async function deleteIdea(id: string) {
    try {
      await fetch("/api/ideas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchIdeas();
    } catch (e) {
      console.error("Failed to delete idea", e);
    }
  }

  const sorted = [...ideas].sort((a, b) => {
    const da = a.createdAt || a.timestamp || "";
    const db = b.createdAt || b.timestamp || "";
    return db.localeCompare(da);
  });

  const filtered = sorted.filter((idea) => {
    const s = idea.status || "new";
    if (statusFilter === "active" && (s === "rejected" || s === "done")) return false;
    if (statusFilter !== "active" && statusFilter !== "all" && s !== statusFilter) return false;
    if (categoryFilter !== "all" && (idea.category || "") !== categoryFilter) return false;
    return true;
  });

  const uniqueCategories = [...new Set(ideas.map(i => i.category).filter(Boolean))];

  const statusTabs = [
    { key: "active", label: "Active", count: ideas.filter(i => !["rejected","done"].includes(i.status)).length },
    { key: "all", label: "All", count: ideas.length },
    { key: "approved", label: "Approved", count: ideas.filter(i => i.status === "approved").length },
    { key: "done", label: "Done", count: ideas.filter(i => i.status === "done").length },
    { key: "rejected", label: "Rejected", count: ideas.filter(i => i.status === "rejected").length },
  ];

  if (loading) {
    return (
      <div className="w-full mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-32" />
          </div>
          <Skeleton className="h-9 w-28 !rounded-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="panel p-5 space-y-3">
              <div className="flex gap-2"><Skeleton className="h-5 w-16 !rounded-full" /><Skeleton className="h-5 w-14 !rounded-full" /></div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto p-6 pb-16">
      {/* Header */}
      <div className="hq-rise flex items-end justify-between gap-4 pt-2 pb-8" style={rise(0)}>
        <div>
          <div className="eyebrow mb-2.5 flex items-center gap-1.5">
            <Lightbulb className="w-3.5 h-3.5" />
            Ideas
          </div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Idea Board</h1>
          <p className="num text-[var(--text-4)] text-[12px] mt-3">{filtered.length} showing · {ideas.length} total</p>
        </div>
        <Button
          variant={showForm ? "ghost" : "primary"}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "Cancel" : "Add Idea"}
        </Button>
      </div>

      {/* Add Idea Form */}
      {showForm && (
        <div className="hq-rise panel p-6 mb-8" style={rise(1)}>
          <span className="eyebrow">New Idea</span>
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <input
              type="text"
              value={newIdea.title}
              onChange={(e) => setNewIdea({ ...newIdea, title: e.target.value })}
              className={inputCls}
              placeholder="Idea title *"
              required
            />
            <textarea
              value={newIdea.description}
              onChange={(e) => setNewIdea({ ...newIdea, description: e.target.value })}
              className={`${inputCls} resize-none`}
              placeholder="Describe the idea *"
              rows={3}
              required
            />
            <div className="flex gap-3">
              <select
                value={newIdea.category}
                onChange={(e) => setNewIdea({ ...newIdea, category: e.target.value })}
                className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              >
                <option value="build">Build</option>
                <option value="content">Content</option>
                <option value="feature">Feature</option>
                <option value="thread">Thread</option>
                <option value="experiment">Experiment</option>
              </select>
              <select
                value={newIdea.estimatedTime}
                onChange={(e) => setNewIdea({ ...newIdea, estimatedTime: e.target.value })}
                className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              >
                <option value="30 minutes">30 min</option>
                <option value="1 hour">1 hour</option>
                <option value="2 hours">2 hours</option>
                <option value="3 hours">3 hours</option>
                <option value="Half day">Half day</option>
                <option value="Full day">Full day</option>
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || !newIdea.title.trim() || !newIdea.description.trim()}
              >
                {submitting ? "Adding..." : "Add Idea"}
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors flex items-center gap-1.5 border ${
              statusFilter === tab.key
                ? "bg-[var(--surface-2)] text-[var(--text)] border-[var(--line-strong)]"
                : "text-[var(--text-3)] hover:text-[var(--text)] border-[var(--line)] hover:border-[var(--line-strong)]"
            }`}
          >
            {tab.label}
            <span className="num text-[10px] text-[var(--text-4)]">{tab.count}</span>
          </button>
        ))}
        {uniqueCategories.length > 0 && (
          <>
            <div className="w-px h-4 bg-[var(--line)] mx-1" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent border border-[var(--line)] text-[var(--text-2)] px-3 py-1.5 rounded-full text-[12px] focus:outline-none focus:border-[var(--line-strong)]"
            >
              <option value="all">All Categories</option>
              {uniqueCategories.map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Ideas grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((idea) => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            isEditing={editingId === idea.id}
            editFields={editFields}
            onEditFieldsChange={setEditFields}
            onStartEdit={() => startEditIdea(idea)}
            onCancelEdit={cancelEditIdea}
            onSaveEdit={() => saveEditIdea(idea.id)}
            onDelete={() => deleteIdea(idea.id)}
            onUpdate={fetchIdeas}
          />
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={<Lightbulb className="w-8 h-8" />}
            title="No ideas found"
            hint={statusFilter !== "all" ? "Try adjusting your filters" : "Add your first idea to get started"}
          />
        </div>
      )}
    </div>
  );
}
```

Notes on the changes, so you understand what each piece is for:
- `IdeaEditFields` is a small, separate shape (title/description/category/estimatedTime —
  every field the "Add Idea" form already collects except `source`, which stays fixed to
  `"manual"` for anything created by hand and is not user-editable). Status is deliberately
  excluded — status transitions stay on the dedicated buttons.
- `editingId`/`editFields` live in `IdeasPage` (the parent), not inside `IdeaCard` — same
  reasoning as the Tasks board: a `useState` initializer inside the card would only run once
  per mount and could show stale values on a second edit.
- `handleMoveToTasks` and `handleMoveToDone` stay as local functions inside `IdeaCard`
  (alongside the pre-existing `updateIdea`/`handleReject`), since they only need `idea` and
  the already-present `onUpdate` callback — no new props required for them specifically,
  unlike the edit/delete plumbing which does need new props (state has to live in the parent).
- `handleMoveToTasks` deliberately does not use `updateIdea` (which always calls `onUpdate()`
  after the single PUT) — it needs its own two-step sequence with the delete only happening
  after a successful create, per the plan's global constraint.
- The isEditing early-return in `IdeaCard` means Approve/Reject/Move buttons and the
  rejection-reason box never render while a card is being edited — matches the Tasks board's
  `TaskCard` pattern exactly (edit mode replaces the whole card body).
- `Panel`'s className is extended with `group` (previously absent) so the new hover-revealed
  edit/delete icons can use `group-hover:opacity-100`, the same mechanism the Tasks board uses.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual visual check with the dev server**

Run: `npm run dev` (or confirm it's already running), then in a browser at `/ideas`:
1. Add a new idea, approve it — the card should now show "Move to Tasks" and "Move to Done"
   buttons instead of the old plain "✓ Approved" text.
2. Click "Move to Tasks" — the idea card should disappear from the Idea Board; go to `/tasks`
   and confirm a new task exists in "To Do" with the idea's title, description, and category
   carried over, no due date set.
3. Approve a different idea and click "Move to Done" instead — it should disappear from the
   default "Active" filter and appear under the "Done" tab, still on the Idea Board (not
   deleted, not turned into a task).
4. On any idea card (any status), hover to reveal the pencil/trash icons. Click the pencil —
   confirm the inline edit form shows the current title/description/category/estimated time.
   Change something, save — confirm it persists after a page reload.
5. Click trash on an idea — confirm it disappears immediately and stays gone after reload.
6. Reject an idea with a reason, reload the page, confirm the rejection reason still shows
   under "Rejected:" (this is the pre-existing Reject feature — confirm Task 1's schema fix
   actually made it persist, since it previously errored silently).

Stop and fix before proceeding if any of these deviate.

- [ ] **Step 4: Commit**

```bash
git add src/app/ideas/page.tsx
git commit -m "$(cat <<'EOF'
feat: add Move to Tasks/Done and edit/delete to the Idea Board

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 6: Deploy and verify live

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

Expected: `status` eventually becomes `"finished"`. If the build fails with `Could not
resolve host: github.com` (git clone) or a Docker registry auth/DNS timeout (base image
pull) — both classes of the known recurring transient DNS blip in this environment — retry
the deploy trigger; it may take more than one retry (this has happened before this session).

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

# Create a throwaway approved idea, then promote it, confirming the full cross-board flow
CREATED=$(curl -sS -X POST "https://dashboard.v-decent.org/api/ideas" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"title":"deploy verification idea","description":"checking the promotion flow end to end","category":"build","estimatedTime":"30 minutes","status":"approved"}')
echo "$CREATED"
IDEA_ID=$(echo "$CREATED" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Simulate "Move to Tasks": create the task, then delete the idea
TASK_CREATED=$(curl -sS -X POST "https://dashboard.v-decent.org/api/tasks" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"name":"deploy verification idea","description":"checking the promotion flow end to end","category":"build"}')
echo "$TASK_CREATED"
TASK_ID=$(echo "$TASK_CREATED" | python3 -c "import sys,json; print(json.load(sys.stdin)['task']['id'])")

curl -sS -X DELETE "https://dashboard.v-decent.org/api/ideas" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d "{\"id\":\"$IDEA_ID\"}"
echo

# Confirm the idea is gone and the task exists with description/category carried over, no due date
curl -sS "https://dashboard.v-decent.org/api/ideas" -H "x-internal-secret: $SECRET" | python3 -c "
import sys, json
ideas = json.load(sys.stdin)
print('idea still present:', any(i['id'] == '$IDEA_ID' for i in ideas))
"
curl -sS "https://dashboard.v-decent.org/api/tasks" -H "x-internal-secret: $SECRET" | python3 -c "
import sys, json
data = json.load(sys.stdin)
task = next(t for t in data['tasks'] if t['id'] == '$TASK_ID')
print(task)
"

# Cleanup the verification task
curl -sS -X DELETE "https://dashboard.v-decent.org/api/tasks" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d "{\"id\":\"$TASK_ID\"}"
echo

# Confirm the estimatedTime/rejectionReason fix: create an idea, PUT an estimatedTime change, confirm it persists
IDEA2=$(curl -sS -X POST "https://dashboard.v-decent.org/api/ideas" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"title":"estimatedTime persistence check","description":"x","category":"build","estimatedTime":"1 hour","status":"new"}')
IDEA2_ID=$(echo "$IDEA2" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -sS -X PUT "https://dashboard.v-decent.org/api/ideas" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d "{\"id\":\"$IDEA2_ID\",\"estimatedTime\":\"3 hours\"}"
echo
curl -sS "https://dashboard.v-decent.org/api/ideas" -H "x-internal-secret: $SECRET" | python3 -c "
import sys, json
ideas = json.load(sys.stdin)
idea = next(i for i in ideas if i['id'] == '$IDEA2_ID')
print('estimatedTime after PUT:', idea.get('estimatedTime'))
"
curl -sS -X DELETE "https://dashboard.v-decent.org/api/ideas" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d "{\"id\":\"$IDEA2_ID\"}"
```

Expected: the idea is confirmed gone after promotion, the created task shows the carried-over
description/category with `dueDate: null`, and the `estimatedTime` PUT (previously silently
failing) now shows `"3 hours"` on refetch — confirming Task 1's schema fix actually resolved
the pre-existing bug. Report to the user that the deploy is live and confirmed working
end-to-end via the API; the visual UI (buttons, edit forms, hover affordances) needs the
user's confirmation in the browser, matching the pattern used for prior client-only UI
changes this session.

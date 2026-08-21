# Personal Task Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the non-functional Notion-proxy `/tasks` page with a real, working personal
to-do board backed by Postgres, including delete and inline-edit affordances and an optional
due date.

**Architecture:** A new `PersonalTask` Prisma model backs a fully rewritten `/api/tasks`
route (`GET`/`POST`/`PATCH`/`DELETE`, no more Notion branching or mock fallback). The existing
4-column kanban UI in `src/app/tasks/page.tsx` is extended with priority/category/due-date
inputs on creation, and pencil/trash affordances plus an inline edit form on each card.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma ORM, Postgres (via the existing
`prisma db push --accept-data-loss` on every container boot — no migration files in this
repo), Tailwind, the shared `@/components/ui/kit` design system (`Button`, `Pill`, `rise`).

## Global Constraints

- Purely personal — no connection to `HermesTask` / the Hermes kanban system.
- Status values stay exactly `"Not started"` / `"Approved"` / `"In progress"` / `"Done"` —
  no UI column changes.
- No delete confirmation modal — deletion is immediate.
- `PersonalTask` model fields: `id` (`cuid()`), `name`, `status` (default `"Not started"`),
  `priority` (nullable string), `category` (nullable string), `dueDate` (nullable
  `DateTime`), `createdAt`, `updatedAt`.
- No test suite exists in this repo. Verification is `npx tsc --noEmit`, `npx prisma
  validate`, and manual checks (curl for the API, dev-server + visual reasoning for the UI —
  matching the pattern used throughout this session).
- Commit convention: clear subject + body, trailers `Co-Authored-By: Claude Sonnet 5
  <noreply@anthropic.com>` and `Claude-Session:
  https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW`.

---

### Task 1: Add the `PersonalTask` Prisma model

**Files:**
- Modify: `prisma/schema.prisma` (append new model at the end of the file)

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma.personalTask` client methods (`findMany`, `create`, `update`, `delete`),
  consumed by Task 2's rewritten API route. Field names/types: `id: string`, `name: string`,
  `status: string`, `priority: string | null`, `category: string | null`, `dueDate: Date |
  null`, `createdAt: Date`, `updatedAt: Date`.

- [ ] **Step 1: Append the model**

Add this to the end of `prisma/schema.prisma` (after the existing `HermesMemory` model, or
wherever the file currently ends):

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

- [ ] **Step 2: Validate the schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: completes without error, so `prisma.personalTask` is available to TypeScript in
Task 2 (this repo pushes the schema to the live DB via `prisma db push
--accept-data-loss` on container boot — no migration files to write here).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat: add PersonalTask model for the personal task board

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 2: Rewrite `/api/tasks` to use `PersonalTask`

**Files:**
- Modify: `src/app/api/tasks/route.ts` (full-file replacement — remove all Notion/mock code)

**Interfaces:**
- Consumes: `prisma.personalTask` from Task 1.
- Produces: HTTP contract consumed by Task 3's UI:
  - `GET` → `{ tasks: Array<{ id, name, status, priority, category, dueDate }> }`
    (`dueDate` is an ISO string or `null`).
  - `POST` body `{ name: string, priority?: string, category?: string, dueDate?: string }` →
    `{ task: {...} }` (same shape as one array element above).
  - `PATCH` body `{ id: string, status?: string, name?: string, priority?: string | null,
    category?: string | null, dueDate?: string | null }` (partial update — only provided
    fields change) → `{ task: {...} }`.
  - `DELETE` body `{ id: string }` → `{ success: true }`.

**Current file content (for reference):**

```ts
import { NextResponse } from "next/server";

// This would connect to Notion API
// For now, return mock data

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = "1264208d-f768-4604-b4cb-09f4d6fd41e3"; // Max's Tasks DB

export async function GET() {
  try {
    if (!NOTION_API_KEY) {
      // Return mock data if no API key
      return NextResponse.json({
        tasks: [
          { id: "1", name: "Review Polymarket bot strategy", status: "In progress", priority: "High", category: "Research" },
          { id: "2", name: "Build Hermy HQ dashboard", status: "In progress", priority: "High", category: "Content" },
          { id: "3", name: "Daily brief automation", status: "Approved", priority: "Medium", category: "Admin" },
        ],
      });
    }
    // ... (Notion fetch logic, removed in this task)
  } catch (error) {
    console.error("Tasks API error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}
// ... (POST and PATCH also branch on NOTION_API_KEY, removed in this task)
```

- [ ] **Step 1: Replace the full file**

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
    if (name !== undefined) data.name = name;
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
feat: back /api/tasks with Postgres instead of an unconfigured Notion proxy

NOTION_API_KEY was never set in production, so GET always returned a
hardcoded mock array and POST/PATCH silently no-op'd - nothing a user did
on the page ever persisted. Now reads/writes real PersonalTask rows.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 3: Add delete/edit/due-date UI to the Tasks page

**Files:**
- Modify: `src/app/tasks/page.tsx` (full-file replacement)

**Interfaces:**
- Consumes: the `/api/tasks` contract from Task 2 (`GET`/`POST`/`PATCH`/`DELETE` as
  described above).
- Produces: nothing consumed elsewhere — this is the top-level page component.

**Current file content (for reference — full file, 206 lines):**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button, Pill, rise } from "@/components/ui/kit";

interface Task {
  id: string;
  name: string;
  status: string;
  priority: string;
  category: string;
  dueDate?: string;
}

const columns = [
  { id: "Not started", label: "To Do" },
  { id: "Approved", label: "Approved" },
  { id: "In progress", label: "In Progress" },
  { id: "Done", label: "Done" },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, []);

  async function fetchTasks() {
    try {
      const res = await fetch("/api/tasks");
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
        body: JSON.stringify({ name: newTask, status: "Not started" }),
      });
      setNewTask("");
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
            <div className="eyebrow mb-2">Synced with Notion</div>
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
                        onStatusChange={(status) => updateTaskStatus(task.id, status)}
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
  onStatusChange,
}: {
  task: Task;
  done?: boolean;
  onStatusChange: (status: string) => void;
}) {
  const priorityTone: Record<string, "warn" | "neutral"> = {
    High: "warn",
    Medium: "neutral",
    Low: "neutral",
  };

  return (
    <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-1)] p-3.5 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] cursor-pointer group">
      <p className={`font-medium text-[13px] mb-3 leading-relaxed ${done ? "text-[var(--text-3)] line-through" : "text-[var(--text)]"}`}>
        {task.name}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {task.priority && (
          <Pill tone={priorityTone[task.priority] || "neutral"}>{task.priority}</Pill>
        )}
        {task.category && (
          <span className="text-[11px] text-[var(--text-3)]">{task.category}</span>
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
  return new Date(task.dueDate).getTime() < Date.now();
}

function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskId,
          name: editFields.name,
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

Notes on the changes, so you understand what each piece is for:
- `Task.priority`/`Task.category`/`Task.dueDate` become `string | null` (was `string`/no
  field) to match the API's real nullable values.
- `EditFields` is a separate, plain-string-only shape (form inputs are always strings, even
  for the date field which uses `<input type="date">`'s `YYYY-MM-DD` string format) —
  distinct from `Task` so there's no confusion between "what the API returns" and "what a
  form holds".
- `editingId`/`editFields` state lives in the parent (`TasksPage`), not inside `TaskCard`,
  specifically so re-entering edit mode on a different (or the same) card always starts from
  fresh values — a `useState` initializer inside `TaskCard` would only run once per mount and
  could show stale data on a second edit.
- `startEdit` converts `task.dueDate` (an ISO datetime string like
  `"2026-08-25T00:00:00.000Z"`) to the `YYYY-MM-DD` prefix `<input type="date">` expects via
  `.slice(0, 10)`.
- `isOverdue`/`formatDueDate` are plain helper functions, not component state — no need for
  them to be anything else.
- The card's top row becomes a flex row so the edit/delete icon buttons can sit to the right
  of the title; they're wrapped in the same `opacity-0 group-hover:opacity-100` pattern
  already used for the status `<select>` below, so the card's default (non-hover) appearance
  is unchanged from today.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual visual check with the dev server**

Run: `npm run dev` (or confirm it's already running), then in a browser at `/tasks`:
1. Add a task with a name, priority, category, and due date in the past — it should appear
   in "To Do" showing all three, with the due date in warn/orange color (overdue).
2. Add a task with a due date in the future — due date should show in the normal muted color.
3. Change a task's status via the dropdown — it should move columns and persist after a page
   reload.
4. Click the pencil icon on a card — it should switch to the inline edit form pre-filled with
   its current values. Change the name and save — the card should update and persist after
   reload.
5. Click the trash icon on a card — it should disappear immediately and stay gone after
   reload.
6. Reload the page from scratch — all state (including anything added in this pass) should
   still be there, no reversion to the old 3 hardcoded mock tasks.

Stop and fix before proceeding if any of these deviate.

- [ ] **Step 4: Commit**

```bash
git add src/app/tasks/page.tsx
git commit -m "$(cat <<'EOF'
feat: add delete, inline edit, and due dates to the Tasks page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 4: Deploy and verify live

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
resolve host: github.com` during git clone, this is the known recurring transient DNS blip in
this environment (not a code issue) — retry the deploy trigger once.

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

# GET should return an empty array (fresh table, no seed data) instead of the old 3 mock tasks
curl -sS "https://dashboard.v-decent.org/api/tasks" -H "x-internal-secret: $SECRET"

# POST should create a real row and return it with a cuid-style id
curl -sS -X POST "https://dashboard.v-decent.org/api/tasks" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"name":"deploy verification task","priority":"Low"}'

# GET again should now show that one task persisted
curl -sS "https://dashboard.v-decent.org/api/tasks" -H "x-internal-secret: $SECRET"

# PATCH should move it to Done
curl -sS -X PATCH "https://dashboard.v-decent.org/api/tasks" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"id":"<id-from-above>","status":"Done"}'

# DELETE should remove it, returning to an empty array
curl -sS -X DELETE "https://dashboard.v-decent.org/api/tasks" \
  -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" \
  -d '{"id":"<id-from-above>"}'
curl -sS "https://dashboard.v-decent.org/api/tasks" -H "x-internal-secret: $SECRET"
```

Expected: the full create → read → update → delete → read cycle works against the live
production database, ending with an empty `tasks` array again (the verification task cleaned
up, not left behind as clutter). Report to the user that the deploy is live and confirmed
working end-to-end via the API; the pencil/trash/due-date UI itself needs the user's visual
confirmation in the browser, matching the pattern used for prior client-only UI changes this
session.

# Support Team Issue Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Board" view to `/support-dev` and `/support-pro` showing the real V-Decent Support Team kanban queue (every mirrored task, grouped by status), by extracting and reusing the existing `/hermes` page's `TaskBoard` component instead of writing a fourth near-duplicate kanban implementation.

**Architecture:** `TaskBoard` (and its `timeAgo` dependency) move out of `src/app/hermes/page.tsx` into shared files — a pure, behavior-preserving refactor for `/hermes`. A new API route returns the same shape `/api/hermes/tasks` does, filtered to a V-Decent support board instead of the personal one, with assignee ids relabeled to friendly role names. `SupportTeamPage` gains a third view mode that renders the (now-shared) `TaskBoard` against that new route's data.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Prisma (no schema changes — `HermesTask` already has everything needed), existing `@/components/ui/kit` design primitives.

## Global Constraints

- No test framework exists in this repo — verification is `npx tsc` per task. No test suite to add.
- `src/app/hermes/page.tsx` must render **identically** after Tasks 1-2 — this is a pure extraction, not a rewrite. Every one of `timeAgo`'s 6 existing call sites in that file, and the `<TaskBoard tasks={tasks} total={taskTotal} lastSync={taskSync} />` render call, must keep working unchanged.
- No Prisma schema changes — `HermesTask` (id/board/title/assignee/status/priority/result/kanbanCreatedAt/kanbanStartedAt/kanbanCompletedAt/updatedAt/syncedAt) already has everything this feature needs.
- Dynamic API route params use the Next 16 async signature: `{ params }: { params: Promise<{ env: string }> }`, then `const { env } = await params;` (established convention in this repo).

---

### Task 1: Extract `timeAgo` into a shared utility

**Files:**
- Create: `src/lib/time-ago.ts`
- Modify: `src/app/hermes/page.tsx` (remove the local `timeAgo` definition, add an import — no other change)

**Interfaces:**
- Produces (used by Task 2, and by this task's own edit to `hermes/page.tsx`): `export function timeAgo(d: string | null): string`.

- [ ] **Step 1: Create `src/lib/time-ago.ts`**

```ts
export function timeAgo(d: string | null): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  if (Number.isNaN(diff)) return "—";
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 2: Remove the local `timeAgo` from `src/app/hermes/page.tsx`**

Find this exact block (it sits right after the `// ── Helpers ───...` comment, immediately before `async function getJSON`):

```ts
function timeAgo(d: string | null): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  if (Number.isNaN(diff)) return "—";
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
```

Delete it entirely (the `// ── Helpers ───` comment and the `getJSON` function that follows both stay — this removes only the `timeAgo` function itself).

- [ ] **Step 3: Import `timeAgo` in `src/app/hermes/page.tsx`**

Find the existing import block:

```ts
import {
  Panel,
  SectionHeader,
  Button,
  Pill,
  EmptyState,
  Skeleton,
  Eyebrow,
} from "@/components/ui/kit";
```

Add immediately after it:

```ts
import { timeAgo } from "@/lib/time-ago";
```

- [ ] **Step 4: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0 (confirms all 6 existing `timeAgo(...)` call sites in `hermes/page.tsx` still resolve correctly against the imported version).

- [ ] **Step 5: Commit**

```bash
git add src/lib/time-ago.ts src/app/hermes/page.tsx
git commit -m "$(cat <<'EOF'
extract timeAgo into a shared utility

Pulls this generic time-formatting helper out of hermes/page.tsx (where
it's used by 6 different components on that page) into its own file, so
the upcoming shared TaskBoard component can use it too without either
duplicating it or importing from a page file.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 2: Extract `TaskBoard` into a shared component

**Files:**
- Create: `src/components/task-board.tsx`
- Modify: `src/app/hermes/page.tsx` (remove the local `Task` interface, column helpers, and `TaskBoard` function; remove the now-unused `LayoutGrid` icon import; add an import for the new shared component — no other change)

**Interfaces:**
- Consumes: `timeAgo` from `@/lib/time-ago` (Task 1).
- Produces (used by Task 4, and by this task's own edit to `hermes/page.tsx`):
  - `export interface Task { id: string; board: string; title: string; assignee: string | null; status: string; priority: number | null; result: string | null; syncedAt: string }`
  - `export function TaskBoard({ tasks, total, lastSync, label, title }: { tasks: Task[]; total: number; lastSync: string | null; label?: string; title?: string })` — `label`/`title` default to `"Task board"`/`"Hermes kanban"`, matching `/hermes`'s current fixed header exactly when omitted.

- [ ] **Step 1: Create `src/components/task-board.tsx`**

```tsx
"use client";

import { LayoutGrid } from "lucide-react";
import { Panel, SectionHeader, EmptyState, Eyebrow } from "@/components/ui/kit";
import { timeAgo } from "@/lib/time-ago";

export interface Task {
  id: string;
  board: string;
  title: string;
  assignee: string | null;
  status: string;
  priority: number | null;
  result: string | null;
  syncedAt: string;
}

const COLUMN_ORDER = [
  "triage",
  "todo",
  "ready",
  "running",
  "review",
  "blocked",
  "done",
] as const;

function normStatus(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}
function columnFor(status: string): string {
  const k = normStatus(status);
  for (const c of COLUMN_ORDER) if (k.includes(c)) return c;
  if (k.includes("progress") || k.includes("doing")) return "running";
  if (k.includes("complete")) return "done";
  return "triage";
}
function columnTone(col: string): "neutral" | "up" | "down" | "warn" | "accent" {
  if (col === "done") return "up";
  if (col === "running") return "accent";
  if (col === "blocked") return "down";
  if (col === "review") return "warn";
  return "neutral";
}
const COLUMN_LABEL: Record<string, string> = {
  triage: "Triage",
  todo: "To do",
  ready: "Ready",
  running: "Running",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
};

export function TaskBoard({
  tasks,
  total,
  lastSync,
  label = "Task board",
  title = "Hermes kanban",
}: {
  tasks: Task[];
  total: number;
  lastSync: string | null;
  label?: string;
  title?: string;
}) {
  const groups: Record<string, Task[]> = {};
  for (const t of tasks) {
    const col = columnFor(t.status);
    (groups[col] ||= []).push(t);
  }
  const cols = COLUMN_ORDER.filter((c) => groups[c]?.length);

  return (
    <>
      <SectionHeader
        label={label}
        title={title}
        action={
          <div className="flex items-center gap-3">
            <span className="num text-[12px] text-[var(--text-2)]">{total} total</span>
            <span className="num text-[11px] text-[var(--text-3)]">
              synced {timeAgo(lastSync)}
            </span>
          </div>
        }
      />
      {tasks.length === 0 ? (
        <Panel className="p-2">
          <EmptyState
            icon={<LayoutGrid className="w-6 h-6" />}
            title="No tasks on the board"
            hint="Dispatched work and synced kanban cards will show up here."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cols.map((col) => {
            const tone = columnTone(col);
            return (
              <div key={col} className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between px-1">
                  <Eyebrow>{COLUMN_LABEL[col]}</Eyebrow>
                  <span className="num text-[11px] text-[var(--text-3)]">
                    {groups[col].length}
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {groups[col]
                    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
                    .map((t) => (
                      <div
                        key={t.id}
                        className="panel p-3.5"
                        style={{
                          borderLeft: `2px solid color-mix(in srgb, ${
                            tone === "neutral" ? "var(--text-3)" : `var(--${tone})`
                          } 55%, transparent)`,
                        }}
                      >
                        <p className="text-[13px] text-[var(--text)] leading-snug line-clamp-2">
                          {t.title}
                        </p>
                        <div className="flex items-center gap-2 mt-2.5">
                          {t.assignee && (
                            <span className="num text-[10.5px] text-[var(--text-3)]">
                              {t.assignee}
                            </span>
                          )}
                          {t.priority != null && t.priority > 0 && (
                            <span className="num text-[10.5px] text-[var(--text-3)] ml-auto">
                              P{t.priority}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Remove the local `Task` interface from `src/app/hermes/page.tsx`**

Find this exact block (sandwiched between `interface Ev { ... }` and `interface Health { ... }`):

```ts
interface Task {
  id: string;
  board: string;
  title: string;
  assignee: string | null;
  status: string;
  priority: number | null;
  result: string | null;
  syncedAt: string;
}

```

Delete it entirely (including its trailing blank line), leaving `interface Ev { ... }` and `interface Health { ... }` separated by a single blank line.

- [ ] **Step 3: Remove the column helpers and `TaskBoard` from `src/app/hermes/page.tsx`**

Find this exact block (right after `async function getJSON`'s closing `}`, before `function levelColor`):

```ts
// ── Task board column order ───────────────────────────────
const COLUMN_ORDER = [
  "triage",
  "todo",
  "ready",
  "running",
  "review",
  "blocked",
  "done",
] as const;

function normStatus(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}
function columnFor(status: string): string {
  const k = normStatus(status);
  for (const c of COLUMN_ORDER) if (k.includes(c)) return c;
  if (k.includes("progress") || k.includes("doing")) return "running";
  if (k.includes("complete")) return "done";
  return "triage";
}
function columnTone(col: string): "neutral" | "up" | "down" | "warn" | "accent" {
  if (col === "done") return "up";
  if (col === "running") return "accent";
  if (col === "blocked") return "down";
  if (col === "review") return "warn";
  return "neutral";
}
const COLUMN_LABEL: Record<string, string> = {
  triage: "Triage",
  todo: "To do",
  ready: "Ready",
  running: "Running",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
};

```

Delete it entirely (including its trailing blank line), leaving `function levelColor` immediately following `async function getJSON`'s closing brace with a single blank line between.

Separately, find this exact block (preceded by `// ── Task board ───...` comment, right before `// ── Cron / schedules ───...`):

```ts
// ── Task board ────────────────────────────────────────────
function TaskBoard({
  tasks,
  total,
  lastSync,
}: {
  tasks: Task[];
  total: number;
  lastSync: string | null;
}) {
  const groups: Record<string, Task[]> = {};
  for (const t of tasks) {
    const col = columnFor(t.status);
    (groups[col] ||= []).push(t);
  }
  const cols = COLUMN_ORDER.filter((c) => groups[c]?.length);

  return (
    <>
      <SectionHeader
        label="Task board"
        title="Hermes kanban"
        action={
          <div className="flex items-center gap-3">
            <span className="num text-[12px] text-[var(--text-2)]">{total} total</span>
            <span className="num text-[11px] text-[var(--text-3)]">
              synced {timeAgo(lastSync)}
            </span>
          </div>
        }
      />
      {tasks.length === 0 ? (
        <Panel className="p-2">
          <EmptyState
            icon={<LayoutGrid className="w-6 h-6" />}
            title="No tasks on the board"
            hint="Dispatched work and synced kanban cards will show up here."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cols.map((col) => {
            const tone = columnTone(col);
            return (
              <div key={col} className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between px-1">
                  <Eyebrow>{COLUMN_LABEL[col]}</Eyebrow>
                  <span className="num text-[11px] text-[var(--text-3)]">
                    {groups[col].length}
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {groups[col]
                    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
                    .map((t) => (
                      <div
                        key={t.id}
                        className="panel p-3.5"
                        style={{
                          borderLeft: `2px solid color-mix(in srgb, ${
                            tone === "neutral" ? "var(--text-3)" : `var(--${tone})`
                          } 55%, transparent)`,
                        }}
                      >
                        <p className="text-[13px] text-[var(--text)] leading-snug line-clamp-2">
                          {t.title}
                        </p>
                        <div className="flex items-center gap-2 mt-2.5">
                          {t.assignee && (
                            <span className="num text-[10.5px] text-[var(--text-3)]">
                              {t.assignee}
                            </span>
                          )}
                          {t.priority != null && t.priority > 0 && (
                            <span className="num text-[10.5px] text-[var(--text-3)] ml-auto">
                              P{t.priority}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

```

Delete it entirely (including its trailing blank line), leaving `// ── Cron / schedules ───...` and the `CronJob` type/`CronPanel` function immediately following the previous component with a single blank line between.

- [ ] **Step 4: Update imports in `src/app/hermes/page.tsx`**

Find the lucide-react import block:

```ts
import {
  Send,
  RefreshCw,
  Check,
  X,
  Pencil,
  Inbox,
  Clock,
  Zap,
  Activity as ActivityIcon,
  LayoutGrid,
  Pause,
  Play,
} from "lucide-react";
```

Remove `LayoutGrid,` (it was only used inside the now-extracted `TaskBoard`):

```ts
import {
  Send,
  RefreshCw,
  Check,
  X,
  Pencil,
  Inbox,
  Clock,
  Zap,
  Activity as ActivityIcon,
  Pause,
  Play,
} from "lucide-react";
```

Then, next to the `import { timeAgo } from "@/lib/time-ago";` line added in Task 1, add:

```ts
import { TaskBoard, type Task } from "@/components/task-board";
```

Do not change the render call `<TaskBoard tasks={tasks} total={taskTotal} lastSync={taskSync} />` (further down the file) at all — it now resolves against the imported component instead of a local one, with identical props and identical behavior.

- [ ] **Step 5: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 6: Verify no leftover references**

Run: `grep -n "function TaskBoard\|interface Task {" src/app/hermes/page.tsx`
Expected: no output (both now live only in `src/components/task-board.tsx`).

- [ ] **Step 7: Commit**

```bash
git add src/components/task-board.tsx src/app/hermes/page.tsx
git commit -m "$(cat <<'EOF'
extract TaskBoard into a shared component

Pulls the Task interface, column-bucketing helpers, and the TaskBoard
component itself out of hermes/page.tsx into their own file, unchanged
in behavior, so the upcoming V-Decent support issue board can reuse
the same battle-tested kanban UI instead of becoming a fourth
near-duplicate implementation of the same pattern in this codebase.
label/title are now optional props (defaulting to the exact strings
/hermes already hardcoded) so a second caller can customize the
header without touching /hermes's rendering at all.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 3: `/api/support-team/[env]/tasks` route

**Files:**
- Create: `src/app/api/support-team/[env]/tasks/route.ts`

**Interfaces:**
- Consumes: `prisma.hermesTask` (existing model, no changes); `type Task` from `@/components/task-board` (Task 2), used to annotate the mapped response so a field mismatch is a compile error, matching how the existing aggregate route (`src/app/api/support-team/[env]/route.ts`) already imports and annotates with `type Agent`.
- Produces (used by Task 4): `GET /api/support-team/dev/tasks` and `GET /api/support-team/pro/tasks` return `{ tasks: Task[]; counts: Record<string, number>; total: number; lastSync: string | null }`, where each `Task` matches the shape Task 2's `src/components/task-board.tsx` exports (`id, board, title, assignee, status, priority, result, syncedAt`), with `assignee` relabeled to a friendly role name where recognized. Any other `env` value returns `{ error: "invalid environment" }` with HTTP 400.

- [ ] **Step 1: Write `src/app/api/support-team/[env]/tasks/route.ts`**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Task } from "@/components/task-board";

export const dynamic = "force-dynamic";

type RoleId = "coordinator" | "apps" | "edge" | "infra" | "verifier";

const ROLE_NAMES: Record<RoleId, string> = {
  coordinator: "Coordinator",
  apps: "Apps",
  edge: "Edge",
  infra: "Infra",
  verifier: "Verifier",
};
const ROLE_IDS = new Set<string>(Object.keys(ROLE_NAMES));

function isVDecentEnv(value: string): value is "dev" | "pro" {
  return value === "dev" || value === "pro";
}

function formatAssignee(assignee: string | null, prefix: string): string | null {
  if (!assignee) return null;
  if (!assignee.startsWith(prefix)) return assignee;
  const roleId = assignee.slice(prefix.length);
  return ROLE_IDS.has(roleId) ? ROLE_NAMES[roleId as RoleId] : assignee;
}

export async function GET(_req: Request, { params }: { params: Promise<{ env: string }> }) {
  const { env } = await params;
  if (!isVDecentEnv(env)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

  const board = env === "dev" ? "vdecent-support-dev" : "vdecent-support-prod";
  const assigneePrefix = env === "dev" ? "vdecent-dev-" : "vdecent-prod-";

  const rows = await prisma.hermesTask.findMany({
    where: { board },
    orderBy: [{ status: "asc" }, { priority: "desc" }],
  });

  const tasks: Task[] = rows.map((t) => ({
    id: t.id,
    board: t.board,
    title: t.title,
    assignee: formatAssignee(t.assignee, assigneePrefix),
    status: t.status,
    priority: t.priority,
    result: t.result,
    syncedAt: t.syncedAt.toISOString(),
  }));

  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;

  const lastSync = rows.length
    ? rows.reduce((max, r) => (r.syncedAt > max ? r.syncedAt : max), rows[0].syncedAt).toISOString()
    : null;

  return NextResponse.json({ tasks, counts, total: tasks.length, lastSync });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/support-team/[env]/tasks/route.ts"
git commit -m "$(cat <<'EOF'
add /api/support-team/[env]/tasks route

Same response shape as /api/hermes/tasks, filtered to the V-Decent
support board for the given environment instead of the personal one,
with assignee ids relabeled to friendly role names (Apps, Coordinator,
etc.) where recognized — anything else (e.g. "codex" on some
swarm-root cards) passes through unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 4: Wire the "Board" view into `SupportTeamPage`

**Files:**
- Modify: `src/components/support-team-page.tsx` (full-file replacement — see below)

**Interfaces:**
- Consumes: `TaskBoard`, `type Task` from `@/components/task-board` (Task 2); fetches `GET /api/support-team/${env}/tasks` (Task 3).
- Produces: nothing consumed by later tasks — this is the last code task.

- [ ] **Step 1: Replace `src/components/support-team-page.tsx` in full**

Current file (191 lines) — confirm this matches what's on disk before editing; if it doesn't, STOP and report NEEDS_CONTEXT rather than guessing:

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

Replace it in full with:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import SupportOfficeView from "@/components/SupportOfficeView";
import { AgentCard, type Agent } from "@/components/agent-card";
import { AgentChat } from "@/components/agent-chat";
import { TaskBoard, type Task } from "@/components/task-board";

interface BoardData {
  tasks: Task[];
  total: number;
  lastSync: string | null;
}

const EMPTY_BOARD: BoardData = { tasks: [], total: 0, lastSync: null };

export function SupportTeamPage({ env, title }: { env: "dev" | "pro"; title: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [board, setBoard] = useState<BoardData>(EMPTY_BOARD);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "office" | "board">("office");
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch(`/api/support-team/${env}`);
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : []);
    } catch {}
    setLoading(false);
  }, [env]);

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch(`/api/support-team/${env}/tasks`);
      const data = await res.json();
      if (data && Array.isArray(data.tasks)) setBoard(data);
    } catch {}
  }, [env]);

  useEffect(() => {
    loadAgents();
    loadBoard();
    const interval = setInterval(() => { loadAgents(); loadBoard(); }, 10000); // poll every 10s
    return () => clearInterval(interval);
  }, [loadAgents, loadBoard]);

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
            <button
              onClick={() => setView("board")}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                view === "board"
                  ? "bg-white/[0.08] text-[var(--text)]"
                  : "text-[var(--text-3)] hover:text-[var(--text-2)]"
              }`}
            >
              Board
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

      {/* Board View */}
      {view === "board" && (
        <TaskBoard
          tasks={board.tasks}
          total={board.total}
          lastSync={board.lastSync}
          label="Issue board"
          title={`${title} incidents`}
        />
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
add Board view to SupportTeamPage

Third toggle option alongside Office/Cards, showing the real kanban
queue for this environment's support board via the now-shared
TaskBoard component, polled on the same 10s cadence as the agent
roster.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 5: Deploy and verify live

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

Poll `GET https://coolify.v-decent.org/api/v1/deployments/{deployment_uuid}` until `status` is `finished`. Retry once if it fails on a transient DNS blip during the git clone or base-image pull — this has happened repeatedly with this app and is unrelated to the code.

- [ ] **Step 3: Confirm `/hermes`'s existing board still renders correctly (the refactor's core risk)**

```bash
source ~/.bashrc
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "import json,sys; d=json.load(sys.stdin); print([e['value'] for e in d if not e.get('is_preview') and e['key']=='INTERNAL_API_SECRET'][0])")
curl -sS "https://dashboard.v-decent.org/api/hermes/tasks" -H "x-internal-secret: $SECRET" | python3 -m json.tool
```

Expected: same shape and same data as before this deploy (the Task 1-2 refactor changed nothing about this route or the personal board's data) — `{ tasks, counts, total, lastSync }`, `total` matching whatever the personal `"default"` board currently holds (0 at last check, per the prior fix's live verification).

- [ ] **Step 4: Verify the new tasks route for both environments**

```bash
curl -sS "https://dashboard.v-decent.org/api/support-team/dev/tasks" -H "x-internal-secret: $SECRET" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('total:', d['total'], '| counts:', d['counts'], '| lastSync:', d['lastSync'])
print('sample assignees:', sorted(set(t['assignee'] for t in d['tasks'] if t['assignee']))[:10])
"
curl -sS "https://dashboard.v-decent.org/api/support-team/pro/tasks" -H "x-internal-secret: $SECRET" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('total:', d['total'], '| counts:', d['counts'])
"
```

Expected: `dev` returns ~40 tasks (or however many are on the board by now) with `assignee` values like `Apps`/`Coordinator`/`Edge`/`Infra`/`Verifier` (relabeled) — and `codex` unchanged, since it's not one of the 5 known roles. `pro` returns `total: 0` (board is still empty as of the last check) without erroring.

- [ ] **Step 5: Ask the user to visually confirm in the browser**

Report to the user: deployed and live. Ask them to check the new "Board" toggle on `/support-dev` and `/support-pro`, and to spot-check that `/hermes`'s existing task board still looks and behaves exactly as before (same columns, same cards) — since this environment has no browser to verify the rendered UI directly.

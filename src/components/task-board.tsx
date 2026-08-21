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

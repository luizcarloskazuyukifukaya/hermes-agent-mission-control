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

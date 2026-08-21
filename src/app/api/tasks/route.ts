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

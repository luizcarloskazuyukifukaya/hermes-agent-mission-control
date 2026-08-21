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

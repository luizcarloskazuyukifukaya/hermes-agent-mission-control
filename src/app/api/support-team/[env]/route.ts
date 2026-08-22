import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Agent } from "@/components/agent-card";
import { LIVE_PROFILES } from "@/lib/live-profiles";

export const dynamic = "force-dynamic";

type RoleId = "coordinator" | "apps" | "edge" | "infra" | "verifier";

interface RosterEntry {
  id: RoleId;
  name: string;
  emoji: string;
  role: string;
}

const ROSTER: RosterEntry[] = [
  { id: "coordinator", name: "Coordinator", emoji: "🧭", role: "Coordinates incidents, delegates diagnosis, and owns traceable reports." },
  { id: "apps", name: "Apps", emoji: "📦", role: "Diagnoses applications, APIs, deployments, and databases." },
  { id: "edge", name: "Edge", emoji: "🌐", role: "Diagnoses Coolify, Cloudflare, DNS, tunnels, and reverse-proxy routing." },
  { id: "infra", name: "Infra", emoji: "🖥️", role: "Diagnoses nodes, Docker, Sentinel, and runtime health." },
  { id: "verifier", name: "Verifier", emoji: "🔍", role: "Independently verifies evidence, mitigations, and report completeness." },
];
const ROLE_IDS = new Set<string>(ROSTER.map((r) => r.id));
const OPEN_STATUSES = new Set(["todo", "ready", "scheduled"]);

function isVDecentEnv(value: string): value is "dev" | "pro" {
  return value === "dev" || value === "pro";
}

interface TaskLike {
  title: string;
  status: string;
  kanbanCreatedAt: Date | null;
  kanbanStartedAt: Date | null;
  kanbanCompletedAt: Date | null;
}

function taskTimestamp(t: TaskLike): number {
  const d = t.kanbanCompletedAt ?? t.kanbanStartedAt ?? t.kanbanCreatedAt;
  return d ? d.getTime() : 0;
}

export async function GET(_req: Request, { params }: { params: Promise<{ env: string }> }) {
  const { env } = await params;
  if (!isVDecentEnv(env)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

  const board = env === "dev" ? "vdecent-support-dev" : "vdecent-support-prod";
  const assigneePrefix = env === "dev" ? "vdecent-dev-" : "vdecent-prod-";

  const tasks = await prisma.hermesTask.findMany({ where: { board } });

  const byRole = new Map<RoleId, typeof tasks>();
  for (const t of tasks) {
    if (!t.assignee || !t.assignee.startsWith(assigneePrefix)) continue;
    const roleId = t.assignee.slice(assigneePrefix.length);
    if (!ROLE_IDS.has(roleId)) continue;
    const list = byRole.get(roleId as RoleId) ?? [];
    list.push(t);
    byRole.set(roleId as RoleId, list);
  }

  const agents: Agent[] = ROSTER.map((member) => {
    const memberTasks = byRole.get(member.id) ?? [];
    const byRecency = [...memberTasks].sort((a, b) => taskTimestamp(b) - taskTimestamp(a));

    const running = memberTasks.find((t) => t.status === "running");
    const openSorted = memberTasks
      .filter((t) => OPEN_STATUSES.has(t.status))
      .sort((a, b) => taskTimestamp(a) - taskTimestamp(b));
    const oldestOpen = openSorted[0];
    const blocked = memberTasks.find((t) => t.status === "blocked");
    const doneCount = memberTasks.filter((t) => t.status === "done").length;

    const status: Agent["status"] = running ? "working" : blocked ? "error" : oldestOpen ? "idle" : "idle";
    const currentTask = running?.title ?? oldestOpen?.title ?? undefined;

    const recentActivity = byRecency.slice(0, 10).map((t) => ({
      timestamp: new Date(taskTimestamp(t)).toISOString(),
      action: t.title,
      result: t.status,
    }));

    const lastActive = byRecency.length && taskTimestamp(byRecency[0])
      ? new Date(taskTimestamp(byRecency[0])).toISOString()
      : undefined;

    return {
      id: member.id,
      name: member.name,
      emoji: member.emoji,
      role: member.role,
      status,
      currentTask,
      lastActive,
      tasksCompleted: doneCount,
      totalCost: 0,
      recentActivity,
      live: LIVE_PROFILES.has(`${env}-${member.id}`),
    };
  });

  return NextResponse.json(agents);
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LIVE_PROFILES } from "@/lib/live-profiles";

const ROLE_IDS = new Set(["coordinator", "apps", "edge", "infra", "verifier"]);

function isVDecentEnv(value: string): value is "dev" | "pro" {
  return value === "dev" || value === "pro";
}

export async function POST(req: Request, { params }: { params: Promise<{ env: string }> }) {
  const { env } = await params;
  if (!isVDecentEnv(env)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

  const b = await req.json().catch(() => ({}));
  const role = (b.role || "").toString();
  const message = (b.message || "").toString().trim();
  if (!ROLE_IDS.has(role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (!LIVE_PROFILES.has(`${env}-${role}`)) {
    return NextResponse.json({ error: "this role is not live yet" }, { status: 400 });
  }

  const profile = `vdecent-${env === "dev" ? "dev" : "prod"}-${role}`;
  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: "chat",
      title: message.slice(0, 200),
      prompt: message,
      profile,
      sideEffecting: false,
      status: "queued",
    },
  });
  return NextResponse.json({ requestId: row.id });
}

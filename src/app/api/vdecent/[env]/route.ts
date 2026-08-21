import { NextResponse } from "next/server";
import { fetchAppManagerSection, fetchNodeManagerSection, type VDecentEnv } from "@/lib/vdecent";

export const dynamic = "force-dynamic";

function isVDecentEnv(value: string): value is VDecentEnv {
  return value === "dev" || value === "pro";
}

export async function GET(_req: Request, { params }: { params: Promise<{ env: string }> }) {
  const { env } = await params;
  if (!isVDecentEnv(env)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

  const [am, nm] = await Promise.all([
    fetchAppManagerSection(env),
    fetchNodeManagerSection(env),
  ]);

  return NextResponse.json({ am, nm });
}

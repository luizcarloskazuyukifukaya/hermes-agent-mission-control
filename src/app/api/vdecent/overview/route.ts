import { NextResponse } from "next/server";
import { fetchAppManagerSection, fetchNodeManagerSection, type HealthCounts, type Section } from "@/lib/vdecent";

export const dynamic = "force-dynamic";

function toCounts<T>(section: Section<T>): HealthCounts | null {
  return section.state === "ok" ? section.counts : null;
}

export async function GET() {
  const [devAm, devNm, prodAm, prodNm] = await Promise.all([
    fetchAppManagerSection("dev"),
    fetchNodeManagerSection("dev"),
    fetchAppManagerSection("pro"),
    fetchNodeManagerSection("pro"),
  ]);

  return NextResponse.json({
    dev: { am: toCounts(devAm), nm: toCounts(devNm) },
    prod: { am: toCounts(prodAm), nm: toCounts(prodNm) },
  });
}

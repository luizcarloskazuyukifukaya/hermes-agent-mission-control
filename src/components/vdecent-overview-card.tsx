"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel, Skeleton } from "@/components/ui/kit";
import type { HealthCounts } from "@/lib/vdecent";

interface EnvSummary {
  am: HealthCounts | null;
  nm: HealthCounts | null;
}
interface Overview {
  dev: EnvSummary;
  prod: EnvSummary;
}

const EMPTY: Overview = {
  dev: { am: null, nm: null },
  prod: { am: null, nm: null },
};

function IssueLine({ counts, okLabel, issueLabel, pendingLabel }: {
  counts: HealthCounts | null;
  okLabel: string;
  issueLabel: (n: number) => string;
  pendingLabel: (n: number) => string;
}) {
  if (!counts) return <p className="text-[13px] text-[var(--text-3)]">Not configured</p>;
  if (counts.atRisk > 0) {
    return <p className="text-[13px] font-medium" style={{ color: "var(--warn)" }}>⚠ {issueLabel(counts.atRisk)}</p>;
  }
  if (counts.pending > 0) {
    return <p className="text-[13px] text-[var(--text-3)]">○ {pendingLabel(counts.pending)}</p>;
  }
  return <p className="text-[13px] font-medium" style={{ color: "var(--up)" }}>✓ {okLabel}</p>;
}

function EnvColumn({ label, summary, href }: { label: string; summary: EnvSummary; href: string }) {
  return (
    <div className="flex-1 min-w-[200px]">
      <p className="eyebrow mb-2">{label}</p>
      <div className="space-y-1.5">
        <IssueLine
          counts={summary.am}
          okLabel="All healthy"
          issueLabel={(n) => `${n} app${n === 1 ? "" : "s"} at risk`}
          pendingLabel={(n) => `${n} app${n === 1 ? "" : "s"} pending`}
        />
        <IssueLine
          counts={summary.nm}
          okLabel="All nodes active"
          issueLabel={(n) => `${n} node${n === 1 ? "" : "s"} need attention`}
          pendingLabel={(n) => `${n} node${n === 1 ? "" : "s"} pending`}
        />
      </div>
      <Link href={href} className="inline-block mt-3 text-[12px] text-[var(--accent)] hover:underline">
        View {label} →
      </Link>
    </div>
  );
}

function isOverview(d: unknown): d is Overview {
  return !!d && typeof d === "object" && "dev" in d && "prod" in d;
}

export function VDecentOverviewCard() {
  const [data, setData] = useState<Overview>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/vdecent/overview")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (isOverview(d)) setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <Panel className="p-6">
      <p className="eyebrow mb-4">V-Decent Operations</p>
      {loading ? (
        <div className="flex flex-wrap gap-8">
          <Skeleton className="h-20 flex-1 min-w-[200px] rounded-[var(--r-lg)]" />
          <Skeleton className="h-20 flex-1 min-w-[200px] rounded-[var(--r-lg)]" />
        </div>
      ) : (
        <div className="flex flex-wrap gap-8">
          <EnvColumn label="Development" summary={data.dev} href="/vdecent-dev" />
          <EnvColumn label="Production" summary={data.prod} href="/vdecent-pro" />
        </div>
      )}
    </Panel>
  );
}

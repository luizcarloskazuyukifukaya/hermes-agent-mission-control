"use client";

import { useEffect, useState } from "react";
import { SectionHeader, Panel, Pill, EmptyState, Skeleton } from "@/components/ui/kit";
import type { Section, AppRow, NodeRow, HealthCounts } from "@/lib/vdecent";

interface EnvDetail {
  am: Section<AppRow>;
  nm: Section<NodeRow>;
}

const EMPTY_SECTION = { state: "not_configured" as const, counts: null, items: [], url: null, error: null };
const EMPTY: EnvDetail = { am: EMPTY_SECTION, nm: EMPTY_SECTION };

type PillTone = "up" | "warn" | "down";

function statusTone(status: string): PillTone {
  const s = status.toLowerCase();
  if (s === "online" || s === "healthy") return "up";
  if (s === "error" || s === "offline") return "down";
  return "warn";
}

function CountsPills({ counts, healthyLabel, pendingLabel, atRiskLabel }: {
  counts: HealthCounts;
  healthyLabel: string;
  pendingLabel: string;
  atRiskLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Pill tone="up">{counts.healthy} {healthyLabel}</Pill>
      <Pill tone="warn">{counts.pending} {pendingLabel}</Pill>
      <Pill tone="down">{counts.atRisk} {atRiskLabel}</Pill>
      <span className="num text-[12px] text-[var(--text-3)] ml-1">{counts.total} total</span>
    </div>
  );
}

function OpenLink({ url, label }: { url: string | null; label: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[var(--accent)] hover:underline">
      {label} ↗
    </a>
  );
}

function AppManagerSection({ section }: { section: Section<AppRow> }) {
  return (
    <Panel className="overflow-hidden">
      <div className="p-5 border-b border-[var(--line)] flex items-center justify-between gap-4 flex-wrap">
        <span className="eyebrow">App Manager</span>
        <OpenLink url={section.url} label="Open App Manager" />
      </div>
      {section.state === "not_configured" ? (
        <EmptyState title="App Manager isn't configured" hint="Set AM_*_API_URL to enable this section." className="py-10" />
      ) : section.state === "unreachable" ? (
        <EmptyState title="Couldn't reach App Manager" hint={section.error ?? undefined} className="py-10" />
      ) : (
        <>
          <div className="px-5 py-4 border-b border-[var(--line)]">
            {section.counts && (
              <CountsPills counts={section.counts} healthyLabel="healthy" pendingLabel="pending" atRiskLabel="at risk" />
            )}
          </div>
          {section.items.length === 0 ? (
            <EmptyState title="No registered apps" className="py-10" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[10px] text-[var(--text-3)] uppercase tracking-[0.12em] border-b border-[var(--line)]">
                    <th className="text-left px-5 py-3 font-medium">Name</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="text-right px-5 py-3 font-medium">SLA 30d</th>
                    <th className="text-left px-5 py-3 font-medium">FQDN</th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((app) => (
                    <tr key={app.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-5 py-3 text-[var(--text-2)]">{app.name}</td>
                      <td className="px-5 py-3"><Pill tone={statusTone(app.status)}>{app.status}</Pill></td>
                      <td className="px-5 py-3 text-right num text-[var(--text-2)]">{app.sla30d != null ? `${app.sla30d}%` : "—"}</td>
                      <td className="px-5 py-3">
                        {app.fqdn ? (
                          <a href={`https://${app.fqdn}`} target="_blank" rel="noopener noreferrer" className="text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
                            {app.fqdn} ↗
                          </a>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function NodeManagerSection({ section }: { section: Section<NodeRow> }) {
  return (
    <Panel className="overflow-hidden">
      <div className="p-5 border-b border-[var(--line)] flex items-center justify-between gap-4 flex-wrap">
        <span className="eyebrow">Node Manager</span>
        <OpenLink url={section.url} label="Open Node Manager" />
      </div>
      {section.state === "not_configured" ? (
        <EmptyState title="Node Manager isn't configured" hint="Set NM_*_API_URL and NM_*_API_TOKEN to enable this section." className="py-10" />
      ) : section.state === "unreachable" ? (
        <EmptyState title="Couldn't reach Node Manager" hint={section.error ?? undefined} className="py-10" />
      ) : (
        <>
          <div className="px-5 py-4 border-b border-[var(--line)]">
            {section.counts && (
              <CountsPills counts={section.counts} healthyLabel="online" pendingLabel="pending" atRiskLabel="error/offline" />
            )}
          </div>
          {section.items.length === 0 ? (
            <EmptyState title="No enrolled nodes" className="py-10" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[10px] text-[var(--text-3)] uppercase tracking-[0.12em] border-b border-[var(--line)]">
                    <th className="text-left px-5 py-3 font-medium">Hostname</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="text-right px-5 py-3 font-medium">CPU</th>
                    <th className="text-right px-5 py-3 font-medium">Mem</th>
                    <th className="text-right px-5 py-3 font-medium">Disk</th>
                    <th className="text-right px-5 py-3 font-medium">Slots</th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((node) => (
                    <tr key={node.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-5 py-3 text-[var(--text-2)]">{node.hostname}</td>
                      <td className="px-5 py-3"><Pill tone={statusTone(node.status)}>{node.status}</Pill></td>
                      <td className="px-5 py-3 text-right num text-[var(--text-2)]">{node.cpuPct != null ? `${node.cpuPct}%` : "—"}</td>
                      <td className="px-5 py-3 text-right num text-[var(--text-2)]">{node.memPct != null ? `${node.memPct}%` : "—"}</td>
                      <td className="px-5 py-3 text-right num text-[var(--text-2)]">{node.diskPct != null ? `${node.diskPct}%` : "—"}</td>
                      <td className="px-5 py-3 text-right num text-[var(--text-2)]">{node.slotsUsed ?? "—"}/{node.slotsCapacity ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

export function VDecentEnvPage({ env, title }: { env: "dev" | "pro"; title: string }) {
  const [data, setData] = useState<EnvDetail>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/vdecent/${env}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [env]);

  return (
    <div className="space-y-10 pb-8">
      <SectionHeader label="V-Decent Operations" title={title} />
      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-[var(--r-lg)]" />
          <Skeleton className="h-48 rounded-[var(--r-lg)]" />
        </div>
      ) : (
        <>
          <AppManagerSection section={data.am} />
          <NodeManagerSection section={data.nm} />
        </>
      )}
    </div>
  );
}

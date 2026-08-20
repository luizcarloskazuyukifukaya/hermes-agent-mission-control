# V-Decent Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live App Manager / Node Manager status pages for V-Decent's Development and Production environments, plus a compact summary on the dashboard homepage, per `docs/superpowers/specs/2026-08-20-vdecent-ops-dashboard-design.md`.

**Architecture:** Two new server-side Next.js API routes (`/api/vdecent/overview`, `/api/vdecent/[env]`) call the real App Manager and Node Manager APIs directly on every request (no caching), backed by one shared data-layer module. Two new pages (`/vdecent-dev`, `/vdecent-pro`) render via one shared client component parameterized by environment. The homepage gets a small summary card. Sidebar/command-palette nav is updated last, once the pages exist.

**Tech Stack:** Next.js 16 (App Router, TypeScript), existing `src/components/ui/kit.tsx` design primitives (`Panel`, `SectionHeader`, `Pill`, `EmptyState`), no new dependencies.

## Global Constraints

- No test framework exists in this repo (no jest/vitest, no `test` script) — verification is TypeScript type-checking (`npx tsc`) per task plus a final live check against the deployed app, matching how prior work in this repo has been verified. Do not add a test framework as part of this plan.
- Follow the existing design system exactly: reuse `Panel`, `SectionHeader`, `Pill`, `EmptyState` from `@/components/ui/kit` and the plain CSS custom properties (`--text`, `--text-2`, `--text-3`, `--line`, `--surface-2`, `--up`, `--down`, `--warn`, `--accent`) — not the legacy `--hq-*` aliases, which only two now-mostly-emptied files still use.
- Table markup mirrors `src/app/x-analytics/page.tsx`'s existing table exactly: `overflow-x-auto` > `table.w-full.text-[13px]` > `thead` row `text-[10px] text-[var(--text-3)] uppercase tracking-[0.12em] border-b border-[var(--line)]` > `th.px-5.py-3.font-medium` > `tbody` rows `border-b border-[var(--line)] last:border-0 hover:bg-[var(--surface-2)] transition-colors` > `td.px-5.py-3`.
- Dynamic API route params use the Next 16 async signature: `{ params }: { params: Promise<{ env: string }> }`, then `const { env } = await params;` (confirmed against `src/app/api/hermes/requests/[id]/route.ts`).
- All new routes/pages are automatically covered by the existing global auth gate in `src/middleware.ts` (blanket matcher) — no special-casing needed.
- Every external fetch (App Manager, Node Manager) happens server-side only, with an 8-second timeout via `AbortController`, one attempt, no retries — matches the approved "live fetch on page load" design decision.
- Node Manager's `X-API-Token` must never reach the client — it is only ever read from `process.env` inside server-side route/lib code, never passed to a client component as a prop.

---

### Task 1: Shared V-Decent data layer

**Files:**
- Create: `src/lib/vdecent.ts`
- Modify: `.env.example` (append new `OPTIONAL · V-Decent Ops` block at the end of the file)

**Interfaces:**
- Consumes: `process.env.AM_DEV_API_URL`, `AM_DEV_URL`, `AM_PROD_API_URL`, `AM_PROD_URL`, `NM_DEV_API_URL`, `NM_DEV_API_TOKEN`, `NM_DEV_URL`, `NM_PROD_API_URL`, `NM_PROD_API_TOKEN`, `NM_PROD_URL`.
- Produces (used by Tasks 2, 3, 4, 6):
  - `type VDecentEnv = "dev" | "pro"`
  - `type HealthCounts = { healthy: number; pending: number; atRisk: number; total: number }`
  - `type AppRow = { id: string; name: string; status: string; fqdn: string | null; sla30d: number | null; category: string | null; repoUrl: string | null }`
  - `type NodeRow = { id: string; hostname: string; status: string; cpuPct: number | null; memPct: number | null; diskPct: number | null; slotsUsed: number | null; slotsCapacity: number | null }`
  - `type SectionState = "ok" | "not_configured" | "unreachable"`
  - `type Section<T> = { state: SectionState; counts: HealthCounts | null; items: T[]; url: string | null; error: string | null }`
  - `async function fetchAppManagerSection(env: VDecentEnv): Promise<Section<AppRow>>`
  - `async function fetchNodeManagerSection(env: VDecentEnv): Promise<Section<NodeRow>>`

- [ ] **Step 1: Install dependencies (if not already installed)**

Run: `npm install`
Expected: completes without error; `node_modules/` and `node_modules/.prisma/client` now exist (the `postinstall` script runs `prisma generate` automatically).

- [ ] **Step 2: Write `src/lib/vdecent.ts`**

```ts
export type VDecentEnv = "dev" | "pro";

export type HealthCounts = {
  healthy: number;
  pending: number;
  atRisk: number;
  total: number;
};

export type AppRow = {
  id: string;
  name: string;
  status: string;
  fqdn: string | null;
  sla30d: number | null;
  category: string | null;
  repoUrl: string | null;
};

export type NodeRow = {
  id: string;
  hostname: string;
  status: string;
  cpuPct: number | null;
  memPct: number | null;
  diskPct: number | null;
  slotsUsed: number | null;
  slotsCapacity: number | null;
};

export type SectionState = "ok" | "not_configured" | "unreachable";

export type Section<T> = {
  state: SectionState;
  counts: HealthCounts | null;
  items: T[];
  url: string | null;
  error: string | null;
};

async function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function envSuffix(env: VDecentEnv): "DEV" | "PROD" {
  return env === "dev" ? "DEV" : "PROD";
}

export async function fetchAppManagerSection(env: VDecentEnv): Promise<Section<AppRow>> {
  const suffix = envSuffix(env);
  const apiUrl = process.env[`AM_${suffix}_API_URL`];
  const frontendUrl = process.env[`AM_${suffix}_URL`] || null;

  if (!apiUrl) {
    return { state: "not_configured", counts: null, items: [], url: frontendUrl, error: null };
  }

  try {
    const data = await fetchJson(`${apiUrl}/api/applications/page`) as {
      items?: Array<{
        id: string; name: string; status: string; fqdn?: string;
        sla_30d?: number; category?: string; repo_url?: string;
      }>;
      counts?: { healthy?: number; pending?: number; at_risk?: number; total?: number };
    };
    const rawItems = data.items ?? [];
    const counts: HealthCounts = {
      healthy: data.counts?.healthy ?? 0,
      pending: data.counts?.pending ?? 0,
      atRisk: data.counts?.at_risk ?? 0,
      total: data.counts?.total ?? rawItems.length,
    };
    const items: AppRow[] = rawItems.map((it) => ({
      id: it.id,
      name: it.name,
      status: it.status,
      fqdn: it.fqdn ?? null,
      sla30d: it.sla_30d ?? null,
      category: it.category ?? null,
      repoUrl: it.repo_url ?? null,
    }));
    return { state: "ok", counts, items, url: frontendUrl, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return { state: "unreachable", counts: null, items: [], url: frontendUrl, error: message };
  }
}

function bucketNodeStatus(status: string): "healthy" | "pending" | "atRisk" {
  if (status === "ONLINE") return "healthy";
  if (status === "ERROR" || status === "OFFLINE") return "atRisk";
  return "pending";
}

export async function fetchNodeManagerSection(env: VDecentEnv): Promise<Section<NodeRow>> {
  const suffix = envSuffix(env);
  const apiUrl = process.env[`NM_${suffix}_API_URL`];
  const token = process.env[`NM_${suffix}_API_TOKEN`];
  const frontendUrl = process.env[`NM_${suffix}_URL`] || null;

  if (!apiUrl || !token) {
    return { state: "not_configured", counts: null, items: [], url: frontendUrl, error: null };
  }

  try {
    const data = await fetchJson(`${apiUrl}/nodes`, { "X-API-Token": token }) as Array<{
      id: string; hostname: string; status: string;
      cpu_percent_usage?: number; memory_percent_usage?: number; disk_percent_usage?: number;
      app_slot_occupied?: number; app_capacity_slot?: number;
    }>;
    const rawNodes = Array.isArray(data) ? data : [];
    const items: NodeRow[] = rawNodes.map((n) => ({
      id: n.id,
      hostname: n.hostname,
      status: n.status,
      cpuPct: n.cpu_percent_usage ?? null,
      memPct: n.memory_percent_usage ?? null,
      diskPct: n.disk_percent_usage ?? null,
      slotsUsed: n.app_slot_occupied ?? null,
      slotsCapacity: n.app_capacity_slot ?? null,
    }));
    const counts: HealthCounts = { healthy: 0, pending: 0, atRisk: 0, total: items.length };
    for (const it of items) {
      const bucket = bucketNodeStatus(it.status);
      if (bucket === "healthy") counts.healthy += 1;
      else if (bucket === "atRisk") counts.atRisk += 1;
      else counts.pending += 1;
    }
    return { state: "ok", counts, items, url: frontendUrl, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return { state: "unreachable", counts: null, items: [], url: frontendUrl, error: message };
  }
}
```

- [ ] **Step 3: Append the new env var block to `.env.example`**

Add this to the end of the file:

```bash

# ─── OPTIONAL · V-Decent Ops (App Manager / Node Manager) ────────
# Only needed for the V-Decent Dev / V-Decent Pro pages and the homepage
# operations summary. Leave any pair blank to show that integration as
# "not configured" instead of erroring.

AM_DEV_API_URL="https://am-api-dev.example.org"
AM_DEV_URL="https://am-dev.example.org"
AM_PROD_API_URL="https://am-api.example.org"
AM_PROD_URL="https://am.example.org"

NM_DEV_API_URL="https://nm-api-dev.example.org"
NM_DEV_API_TOKEN="your-node-manager-dev-token"
NM_DEV_URL="https://nm-dev.example.org"
NM_PROD_API_URL="https://nm-api.example.org"
NM_PROD_API_TOKEN="your-node-manager-prod-token"
NM_PROD_URL="https://nm.example.org"
```

- [ ] **Step 4: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0 (no type errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/vdecent.ts .env.example
git commit -m "$(cat <<'EOF'
add V-Decent ops data layer (App Manager / Node Manager fetch + types)

Server-side fetch helpers for App Manager and Node Manager, per
environment, with a shared Section<T> shape (ok/not_configured/
unreachable) so callers can render each integration independently.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 2: Overview API route

**Files:**
- Create: `src/app/api/vdecent/overview/route.ts`

**Interfaces:**
- Consumes: `fetchAppManagerSection`, `fetchNodeManagerSection`, `HealthCounts` from `@/lib/vdecent` (Task 1).
- Produces (used by Task 6): `GET /api/vdecent/overview` returns
  `{ dev: { am: HealthCounts | null; nm: HealthCounts | null }; prod: { am: HealthCounts | null; nm: HealthCounts | null } }`.

- [ ] **Step 1: Write `src/app/api/vdecent/overview/route.ts`**

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/vdecent/overview/route.ts
git commit -m "$(cat <<'EOF'
add /api/vdecent/overview route

Lightweight counts-only endpoint for both environments in parallel,
used by the homepage summary card.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 3: Per-environment detail API route

**Files:**
- Create: `src/app/api/vdecent/[env]/route.ts`

**Interfaces:**
- Consumes: `fetchAppManagerSection`, `fetchNodeManagerSection`, `VDecentEnv`, `AppRow`, `NodeRow`, `Section` from `@/lib/vdecent` (Task 1).
- Produces (used by Task 4): `GET /api/vdecent/dev` and `GET /api/vdecent/pro` return
  `{ am: Section<AppRow>; nm: Section<NodeRow> }`. Any other `env` value returns
  `{ error: "invalid environment" }` with HTTP 400.

- [ ] **Step 1: Write `src/app/api/vdecent/[env]/route.ts`**

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/vdecent/[env]/route.ts"
git commit -m "$(cat <<'EOF'
add /api/vdecent/[env] route

Full App Manager + Node Manager detail (counts and item lists) for a
single environment (dev or pro), used by the V-Decent Dev/Pro pages.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 4: Shared environment detail page component

**Files:**
- Create: `src/components/vdecent-env-page.tsx`

**Interfaces:**
- Consumes: `Section`, `AppRow`, `NodeRow`, `HealthCounts` from `@/lib/vdecent` (Task 1); `Panel`, `SectionHeader`, `Pill`, `EmptyState` from `@/components/ui/kit`; fetches `GET /api/vdecent/${env}` (Task 3) client-side.
- Produces (used by Task 5): `export function VDecentEnvPage({ env, title }: { env: "dev" | "pro"; title: string })`.

- [ ] **Step 1: Write `src/components/vdecent-env-page.tsx`**

```tsx
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/vdecent-env-page.tsx
git commit -m "$(cat <<'EOF'
add shared V-Decent environment detail page component

Renders App Manager and Node Manager sections (health pills + full
table + link to the real UI) for one environment, driven entirely by
the env prop so /vdecent-dev and /vdecent-pro can share it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 5: `/vdecent-dev` and `/vdecent-pro` pages

**Files:**
- Create: `src/app/vdecent-dev/page.tsx`
- Create: `src/app/vdecent-pro/page.tsx`

**Interfaces:**
- Consumes: `VDecentEnvPage` from `@/components/vdecent-env-page` (Task 4).
- Produces: the routes `/vdecent-dev` and `/vdecent-pro`, referenced by Task 7 (nav).

- [ ] **Step 1: Write `src/app/vdecent-dev/page.tsx`**

```tsx
import { VDecentEnvPage } from "@/components/vdecent-env-page";

export default function VDecentDevPage() {
  return <VDecentEnvPage env="dev" title="V-Decent Development" />;
}
```

- [ ] **Step 2: Write `src/app/vdecent-pro/page.tsx`**

```tsx
import { VDecentEnvPage } from "@/components/vdecent-env-page";

export default function VDecentProPage() {
  return <VDecentEnvPage env="pro" title="V-Decent Production" />;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/vdecent-dev/page.tsx src/app/vdecent-pro/page.tsx
git commit -m "$(cat <<'EOF'
add /vdecent-dev and /vdecent-pro pages

Thin page files delegating to the shared VDecentEnvPage component.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 6: Homepage "V-Decent Operations" summary card

**Files:**
- Create: `src/components/vdecent-overview-card.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `HealthCounts` from `@/lib/vdecent` (Task 1); `Panel` from `@/components/ui/kit`; fetches `GET /api/vdecent/overview` (Task 2) client-side; links to `/vdecent-dev` and `/vdecent-pro` (Task 5).
- Produces: `export function VDecentOverviewCard()`, rendered in `src/app/page.tsx`.

- [ ] **Step 1: Write `src/components/vdecent-overview-card.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/kit";
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

function IssueLine({ counts, okLabel, issueLabel }: {
  counts: HealthCounts | null;
  okLabel: string;
  issueLabel: (n: number) => string;
}) {
  if (!counts) return <p className="text-[13px] text-[var(--text-3)]">Not configured</p>;
  if (counts.atRisk > 0) {
    return <p className="text-[13px] font-medium" style={{ color: "var(--warn)" }}>⚠ {issueLabel(counts.atRisk)}</p>;
  }
  return <p className="text-[13px] font-medium" style={{ color: "var(--up)" }}>✓ {okLabel}</p>;
}

function EnvColumn({ label, summary, href }: { label: string; summary: EnvSummary; href: string }) {
  return (
    <div className="flex-1 min-w-[200px]">
      <p className="eyebrow mb-2">{label}</p>
      <div className="space-y-1.5">
        <IssueLine counts={summary.am} okLabel="All healthy" issueLabel={(n) => `${n} app${n === 1 ? "" : "s"} at risk`} />
        <IssueLine counts={summary.nm} okLabel="All nodes active" issueLabel={(n) => `${n} node${n === 1 ? "" : "s"} need attention`} />
      </div>
      <Link href={href} className="inline-block mt-3 text-[12px] text-[var(--accent)] hover:underline">
        View {label} →
      </Link>
    </div>
  );
}

export function VDecentOverviewCard() {
  const [data, setData] = useState<Overview>(EMPTY);

  useEffect(() => {
    fetch("/api/vdecent/overview")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  return (
    <Panel className="p-6">
      <p className="eyebrow mb-4">V-Decent Operations</p>
      <div className="flex flex-wrap gap-8">
        <EnvColumn label="Development" summary={data.dev} href="/vdecent-dev" />
        <EnvColumn label="Production" summary={data.prod} href="/vdecent-pro" />
      </div>
    </Panel>
  );
}
```

- [ ] **Step 2: Wire it into `src/app/page.tsx`**

Current file (in full):

```tsx
"use client";

import { useEffect, useState } from "react";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Still up";
}

export default function Dashboard() {
  const [time, setTime] = useState(new Date());
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!mounted) return null;

  return (
    <div className="relative z-10 w-full mx-auto pb-16">
      <div className="hq-rise pt-4 pb-10">
        <div className="eyebrow mb-2.5">{greeting()}</div>
        <h1 className="text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--hq-text)]">{process.env.NEXT_PUBLIC_OWNER_NAME || "Founder"}</h1>
        <p className="num text-[var(--hq-text-ghost)] text-[12.5px] mt-3">
          {time.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          {"  ·  "}
          {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
        </p>
      </div>
    </div>
  );
}
```

Replace it in full with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { VDecentOverviewCard } from "@/components/vdecent-overview-card";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Still up";
}

export default function Dashboard() {
  const [time, setTime] = useState(new Date());
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!mounted) return null;

  return (
    <div className="relative z-10 w-full mx-auto pb-16">
      <div className="hq-rise pt-4 pb-10">
        <div className="eyebrow mb-2.5">{greeting()}</div>
        <h1 className="text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--hq-text)]">{process.env.NEXT_PUBLIC_OWNER_NAME || "Founder"}</h1>
        <p className="num text-[var(--hq-text-ghost)] text-[12.5px] mt-3">
          {time.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          {"  ·  "}
          {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
        </p>
      </div>
      <VDecentOverviewCard />
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/vdecent-overview-card.tsx src/app/page.tsx
git commit -m "$(cat <<'EOF'
add V-Decent Operations summary card to the dashboard homepage

Compact Dev vs Prod at-a-glance view (app/node issue counts), each
side linking through to its detail page.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 7: Sidebar and command palette navigation

**Files:**
- Modify: `src/components/sidebar.tsx`
- Modify: `src/components/command-palette.tsx`

**Interfaces:**
- Consumes: routes `/vdecent-dev`, `/vdecent-pro` (Task 5).
- Produces: nothing consumed by later tasks — this is the last code task.

- [ ] **Step 1: Update `src/components/sidebar.tsx`**

Replace the import block and `navGroups` (lines 6–48 in the current file):

```tsx
import {
  Home,
  Bot,
  Lightbulb,
  ClipboardList,
  Cpu,
  BookOpen,
  GitBranch,
  Server,
  Menu,
  X,
} from "lucide-react";

const navGroups = [
  {
    name: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: Home },
      { href: "/hermes", label: "Hermes", icon: Cpu },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
    ],
  },
  {
    name: "Data",
    items: [
      { href: "/vdecent-dev", label: "V-Decent Dev", icon: GitBranch },
      { href: "/vdecent-pro", label: "V-Decent Pro", icon: Server },
    ],
  },
  {
    name: "System",
    items: [
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/memory-wiki", label: "Memory Wiki", icon: BookOpen },
      { href: "/ideas", label: "Ideas", icon: Lightbulb },
    ],
  },
];
```

(`HeartPulse` and `Workflow` are dropped from the import list — both are now unused since `Client Pulse` and `Pipeline` are removed from `navGroups`. `mobileTabsRaw`, below this block, is unchanged — it already only references Dashboard/Ideas/Agents.)

- [ ] **Step 2: Update `src/components/command-palette.tsx`**

Replace the import block and `NAV` array (lines 11–37 in the current file):

```tsx
import {
  LayoutDashboard,
  GitBranch,
  Server,
  Activity,
  Bot,
  Lightbulb,
  ListChecks,
  Sparkles,
  CornerDownLeft,
  Search,
  Check,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "V-Decent Dev", href: "/vdecent-dev", icon: GitBranch },
  { label: "V-Decent Pro", href: "/vdecent-pro", icon: Server },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Ideas", href: "/ideas", icon: Lightbulb },
  { label: "Tasks", href: "/tasks", icon: ListChecks },
  { label: "Hermes", href: "/hermes", icon: Sparkles },
];
```

`Activity` was previously used only by the `Client Pulse` entry in `NAV` and is not used anywhere else in this file (the dispatch-row icons are `Sparkles`/`Check`) — it has already been dropped from the import list above. Do not leave it as an unused import.

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify no leftover references**

Run: `grep -n "Client Pulse\|/client-pulse\|Pipeline\|/content-os\|HeartPulse\|Workflow" src/components/sidebar.tsx src/components/command-palette.tsx`
Expected: no output (both files clean).

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar.tsx src/components/command-palette.tsx
git commit -m "$(cat <<'EOF'
add V-Decent Dev/Pro to nav, remove Content group and Client Pulse

Sidebar's Content group (Pipeline) and Data group's prior contents
(Client Pulse) are unlinked from the sidebar and command palette —
pages/routes stay working, just not in nav — and the Data group is
repurposed to hold the two new V-Decent Dev/Pro entries.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 8: Configure real credentials and deploy

**Files:** none (Coolify environment configuration + deployment only).

**Interfaces:**
- Consumes: all prior tasks' committed code, pushed to `main`.
- Produces: a live, verified deployment.

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Set the real V-Decent env vars on the `vdecent-hermes-dashboard` Coolify app**

Using the Coolify API (`COOLIFY_API_TOKEN` from `~/.bashrc`, app UUID `ezghadjtwn2fd9u6dlmfohcn`), set these 10 variables to their real values (the dev pair needs no token; App Manager needs no token at all — confirmed via live testing during design):

- `AM_DEV_API_URL` = `https://am-api-dev.v-decent.org`
- `AM_DEV_URL` = `https://am-dev.v-decent.org`
- `AM_PROD_API_URL` = `https://am-api.v-decent.org`
- `AM_PROD_URL` = `https://am.v-decent.org`
- `NM_DEV_API_URL` = `https://nm-api-dev.v-decent.org`
- `NM_DEV_API_TOKEN` = (the Node Manager dev `NEXT_PUBLIC_STATIC_API_TOKEN`, fetched from the `node-manager-dev` Coolify app's env, UUID `iirebbqtz5uzr6gtme480lsf`)
- `NM_DEV_URL` = `https://nm-dev.v-decent.org`
- `NM_PROD_API_URL` = `https://nm-api.v-decent.org`
- `NM_PROD_API_TOKEN` = (the Node Manager prod `NEXT_PUBLIC_STATIC_API_TOKEN`, fetched from the `node-manager-production` Coolify app's env, UUID `r9dxgzwq9yd688fe70mal0vb`)
- `NM_PROD_URL` = `https://nm.v-decent.org`

Set these through the Coolify web UI: open `https://coolify.v-decent.org`,
navigate to the `vdecent-hermes-dashboard` application's Environment
Variables tab, add each of the 10 key/value pairs above, and save. (Only
`GET .../envs` was verified against the Coolify API during design — this
plan doesn't rely on an unverified write-endpoint shape.)

- [ ] **Step 3: Trigger a deploy**

```bash
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

Poll `GET https://coolify.v-decent.org/api/v1/deployments/{deployment_uuid}` until `status` is `finished` (retry the deploy once if it fails on a transient DNS blip during the git clone or base-image pull — this has happened before with this app and is unrelated to the code).

- [ ] **Step 4: Verify the API routes live**

```bash
curl -sS "https://dashboard.v-decent.org/api/vdecent/overview" -H "Cookie: <a valid session cookie>"
```

(All routes require an authenticated session per `src/middleware.ts` — there is no `x-internal-secret` bypass for these routes, unlike `/api/hermes/*`. If curl-testing without a browser session, temporarily check the response is a 307/redirect-to-login rather than a 500, which confirms the route is registered and the middleware gate is working; full data verification requires a logged-in browser.)

Expected shape once authenticated: `{"dev":{"am":{...} or null,"nm":{...} or null},"prod":{"am":{...} or null,"nm":{...} or null}}`.

- [ ] **Step 5: Ask the user to visually confirm in the browser**

Report to the user: deployed and live. Ask them to check `/vdecent-dev`, `/vdecent-pro`, the homepage summary card, and the sidebar/command-palette nav in their own logged-in session, since this environment has no browser to verify the rendered UI directly.

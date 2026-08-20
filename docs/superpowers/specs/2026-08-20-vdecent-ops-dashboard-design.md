# V-Decent Operations Dashboard — Design

Date: 2026-08-20

## Purpose

Give the dashboard a live view of V-Decent's own infrastructure — App Manager
(registered applications) and Node Manager (enrolled nodes) — split by
Development and Production environment, with a compact at-a-glance summary
on the homepage and full detail pages per environment.

## Navigation changes

`src/components/sidebar.tsx` `navGroups` becomes:

```
Overview
  Dashboard        /
  Hermes           /hermes
  Tasks            /tasks
Data
  V-Decent Dev     /vdecent-dev
  V-Decent Pro     /vdecent-pro
System
  Agents           /agents
  Memory Wiki      /memory-wiki
  Ideas            /ideas
```

- The `Content` group (currently just "Pipeline") is removed. `Pipeline`
  (`/content-os`) is unlinked from the sidebar and command palette — same
  treatment as the earlier X/Articles/YouTube removal: the page and its API
  routes stay working, just not reachable from nav.
- The existing `Data` group's prior content, `Client Pulse` (`/client-pulse`),
  is also unlinked (same treatment) — the group is repurposed to hold
  `V-Decent Dev` / `V-Decent Pro` instead of being removed.
- `src/components/command-palette.tsx` `NAV` gets `V-Decent Dev` and
  `V-Decent Pro` added, and loses `Client Pulse` (its only current entry
  from these two groups — `Pipeline` was never in the palette).
- No changes to `/content-os` or `/client-pulse` page/route files themselves.

## Health bucketing

Both App Manager and Node Manager sections use the same three-way
categorization so the UI reads consistently:

**App Manager** — counts come directly from AM's own API response
(`counts.healthy`, `counts.pending`, `counts.at_risk`, `counts.total` from
`GET /api/applications/page`). No re-derivation needed.

**Node Manager** — NM's `GET /nodes` returns a raw array with a `status`
field (values defined in `backend/models/models.py::NodeStatus` in the
Node Manager repo). This dashboard buckets them itself:

- **healthy**: `ONLINE`
- **at risk**: `ERROR`, `OFFLINE`
- **pending**: everything else (`NEW_DEVICE`, `WAITING_ACTIVATION`,
  `ACTIVATED`, `BACKUP_RUNNING`, `UBUNTU_INSTALLING`, `DOCKER_INSTALLING`,
  `SSH_CONFIGURING`, `CLOUDFLARE_CONFIGURING`, `COOLIFY_PREPARING`,
  `SSH_READY`, `DECOMMISSIONING`)

## Data layer

Two new server-side Next.js API routes (protected by the existing global
`src/middleware.ts` auth gate like every other route — no special-casing
needed):

### `GET /api/vdecent/overview`

Counts only, both environments, fetched in parallel. Powers the homepage
card.

```ts
type EnvSummary = {
  am: { healthy: number; pending: number; atRisk: number; total: number } | null;
  nm: { healthy: number; pending: number; atRisk: number; total: number } | null;
};
type Overview = { dev: EnvSummary; prod: EnvSummary };
```

`am`/`nm` is `null` when that integration isn't configured or the fetch
failed — the homepage renders a neutral state ("Not configured" /
"Unavailable") rather than a health badge in that case.

### `GET /api/vdecent/[env]` (`env` = `dev` | `pro`)

Full detail for the two detail pages.

```ts
type AppRow = {
  id: string; name: string; status: string; fqdn: string | null;
  sla30d: number | null; category: string | null; repoUrl: string | null;
};
type NodeRow = {
  id: string; hostname: string; status: string;
  cpuPct: number | null; memPct: number | null; diskPct: number | null;
  slotsUsed: number | null; slotsCapacity: number | null;
};
type Section<T> = {
  state: "ok" | "not_configured" | "unreachable";
  counts: { healthy: number; pending: number; atRisk: number; total: number } | null;
  items: T[];
  url: string | null;   // link to the real AM/NM frontend, if configured
  error: string | null; // short message when state === "unreachable"
};
type EnvDetail = { am: Section<AppRow>; nm: Section<NodeRow> };
```

Each of `am` and `nm` is resolved independently — one being down/unconfigured
never blanks the other section or the rest of the page.

### Fetch behavior

- Server-side only (Node Manager's API token never reaches the client).
- One attempt per request, 8s timeout via `AbortController`. No retries, no
  caching, no background polling — matches the "live fetch on page load"
  decision. (`export const dynamic = "force-dynamic"` on both routes.)
- App Manager: plain `GET`, no auth header (confirmed public reads against
  `am-api-dev.v-decent.org` and expected symmetric for prod).
- Node Manager: `X-API-Token: <NM_{DEV,PROD}_API_TOKEN>` header.

### Environment variables

New `OPTIONAL` block in `.env.example`, following the file's existing
"blank disables the feature" convention:

```bash
# ─── OPTIONAL · V-Decent Ops (App Manager / Node Manager) ────────
# Only needed for the V-Decent Dev / V-Decent Pro pages and the homepage
# operations summary. Leave any pair blank to show that integration as
# "not configured" instead of erroring.

AM_DEV_API_URL="https://am-api-dev.example.org"
AM_DEV_URL="https://am-dev.example.org"          # link out to the real UI
AM_PROD_API_URL="https://am-api.example.org"
AM_PROD_URL="https://am.example.org"

NM_DEV_API_URL="https://nm-api-dev.example.org"
NM_DEV_API_TOKEN="your-node-manager-dev-token"
NM_DEV_URL="https://nm-dev.example.org"
NM_PROD_API_URL="https://nm-api.example.org"
NM_PROD_API_TOKEN="your-node-manager-prod-token"
NM_PROD_URL="https://nm.example.org"
```

(Real values for this deployment get set directly in Coolify's environment
for the `vdecent-hermes-dashboard` app at implementation time, not committed.)

## Pages

### `src/app/vdecent-dev/page.tsx` and `src/app/vdecent-pro/page.tsx`

Nearly identical, differing only in which `env` they pass to
`/api/vdecent/[env]` and their heading ("V-Decent Development" /
"V-Decent Production"). Given the near-total duplication, implement as a
single shared client component (e.g. `src/components/vdecent-env-page.tsx`)
parameterized by `env: "dev" | "pro"`, with each page file just rendering
`<VDecentEnvPage env="dev" />` / `<VDecentEnvPage env="pro" />` — matches
this codebase's existing pattern of thin page files delegating to shared
components.

Layout per page (matching existing `panel`/`eyebrow`/`--hq-*` design tokens
used throughout the app):

```
V-Decent Development

App Manager                                    Open App Manager ↗
● 0 healthy   ● 3 pending   ● 5 at risk         8 apps total
───────────────────────────────────────────────────────────────
 Name                    Status       SLA 30d   FQDN
 Andreia's Web Site      ● Error      98.5%     andreia.v-decent.org ↗
 ...

Node Manager                                   Open Node Manager ↗
● 0 online   ● 1 pending   ● 0 error/offline    1 node total
───────────────────────────────────────────────────────────────
 Hostname            Status               CPU   Mem   Disk   Slots
 vdecent-node-80     Waiting Activation   0%    0%    0%     0/0
```

- "Open App Manager ↗" / "Open Node Manager ↗" only render when that
  section's `url` is non-null (i.e. `AM_DEV_URL`/`NM_DEV_URL` etc. is set).
- `state === "not_configured"` renders a quiet placeholder line instead of
  the table ("Node Manager isn't configured for this environment").
- `state === "unreachable"` renders an inline error line with `error`
  instead of the table, counts pills omitted.
- Per-row FQDN links open the app's own public URL in a new tab; this is
  distinct from the "Open App Manager" link (which opens the AM UI itself).

### Homepage — `src/app/page.tsx`

Add a "V-Decent Operations" section below the existing header, above
nothing else (page currently has no other content). New shared component,
e.g. `src/components/vdecent-overview-card.tsx`, fetching
`/api/vdecent/overview` client-side on mount.

```
V-Decent Operations

Development                              Production
⚠ 5 apps at risk                         ✓ All healthy
○ 1 node waiting activation              ✓ All nodes active
[View Dev →]                             [View Pro →]
```

- "All healthy" / "All active" shown when that category's `atRisk`/pending-
  equivalent count is 0 — avoids visual noise when nothing's wrong.
- Each side links to `/vdecent-dev` / `/vdecent-pro`.
- If `am`/`nm` is `null` (not configured or overview fetch failed for that
  env), that line reads "Not configured" in a muted tone instead of a
  health badge.

## Out of scope (for this spec)

- Any mutating actions against App Manager/Node Manager (suspend/resume,
  node commands) — this is a read-only status view.
- Historical trends/graphs of app or node health over time.
- Operations Platform (billing/SLA snapshots) — not requested.
- Background polling/caching — explicitly deferred per the "live fetch"
  decision; can be revisited later if AM/NM latency or availability makes
  live fetch impractical.

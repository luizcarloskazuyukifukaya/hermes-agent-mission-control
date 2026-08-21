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

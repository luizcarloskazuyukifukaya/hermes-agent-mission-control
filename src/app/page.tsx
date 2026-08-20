"use client";

import { useEffect, useState, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { HermesBriefing } from "@/components/hermes-briefing";
import { ApprovalInbox } from "@/components/approval-inbox";

// ── Types ─────────────────────────────────────────────────
interface HLPosition {
  asset: string; direction: string; unrealizedPnl: number;
  unrealizedPnlPct: number; leverage: number; stopLoss?: number; takeProfit?: number;
}
interface Tweet { id: string; text: string; views: number; engRate: number; postedAt: string | null; tweetUrl: string | null }
interface Video  { title: string; thumbnail: string; url: string; publishedAt: string }
interface Draft  { id: string; text: string }
interface YTIdea { title: string; hook: string }
interface BuildIdea { title: string; description: string; effort: string }
interface Process { name: string; status: string; uptime: string }
interface KanbanTask { id: string; title: string; assignee: string; status: string; priority: number }
interface HermesKanban { board: string; slug: string; total: number; counts: Record<string, number>; tasks: KanbanTask[] }
interface ScoreComponent { score: number; weight?: number; label: string; detail?: string }
interface ScoreData { score: number; grade: string; label: string; color: string; period?: string; components: Record<string, ScoreComponent> }

interface HomeData {
  xFollowers: number; xGoal: number; xHandle: string;
  topTweets: Tweet[]; topTweet: Tweet | null; xViewsThisWeek: number;
  totalTweets: number; daysSincePost: number;
  bestPostingDay: string; bestPostingHourStr: string;
  topSageDrafts: Draft[];
  topYoutubeIdeas: YTIdea[];
  topBuildIdeas: BuildIdea[];
  topVideo: Video | null; latestVideo: Video | null;
  ytSubscribers: number; ytGoal: number;
  polyBalance: number; polyWinRate: number; polyTodayPnl: number; polyAllTimePnl: number;
  hlBalance: number; hlPosition: HLPosition | null; hlTodayPnl: number; hlAllTimePnl: number;
  allTimePnl: number; todayPnl: number;
  processes: Process[];
  hermesKanban: HermesKanban;
  xViewsTrend: number[];
  snapshots: { d: string; xf: number; yt: number; pnl: number }[];
}

const EMPTY: HomeData = {
  xFollowers: 0, xGoal: 100000, xHandle: "yourhandle",
  topTweets: [], topTweet: null, xViewsThisWeek: 0, totalTweets: 0,
  daysSincePost: 999, bestPostingDay: "—", bestPostingHourStr: "—",
  topSageDrafts: [], topYoutubeIdeas: [], topBuildIdeas: [],
  topVideo: null, latestVideo: null, ytSubscribers: 0, ytGoal: 20000,
  polyBalance: 0, polyWinRate: 0, polyTodayPnl: 0, polyAllTimePnl: 0,
  hlBalance: 0, hlPosition: null, hlTodayPnl: 0, hlAllTimePnl: 0,
  allTimePnl: 0, todayPnl: 0, processes: [],
  hermesKanban: { board: "Hermes 24/7 Assistant", slug: "hermes-24-7-assistant", total: 0, counts: {}, tasks: [] },
  xViewsTrend: [], snapshots: [],
};

// ── Animated counter ──────────────────────────────────────
function useCountUp(target: number, duration = 1400, enabled = true) {
  const [val, setVal] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!enabled || target === 0 || reduce) { setVal(target); return; }
    const start = Date.now();
    const tick = () => {
      const t = Math.min((Date.now() - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 4);
      setVal(Math.round(target * ease));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration, enabled]);
  return val;
}

// ── Helpers ───────────────────────────────────────────────
function fmtUsd(n: number, alwaysSign = false) {
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n >= 0 ? (alwaysSign ? "+" : "") : "-";
  return `${sign}$${abs}`;
}
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Still up";
}

// ── Section header ────────────────────────────────────────
function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="eyebrow">{children}</span>
      <span className="h-px flex-1 bg-[var(--hq-hairline)]" />
      {right}
    </div>
  );
}

// ── Ideas section ─────────────────────────────────────────
function IdeasPanel({ buildIdeas }: { buildIdeas: BuildIdea[] }) {
  return (
    <div className="panel flex flex-col p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <span className="eyebrow">Build Ideas</span>
      </div>

      <div className="space-y-1 min-h-[172px]">
        {buildIdeas.length > 0 ? buildIdeas.map((it, idx) => (
          <div key={idx} className="flex gap-3 items-center py-2 border-b border-[var(--hq-hairline)] last:border-0">
            <span className="num text-[11px] text-[var(--hq-text-ghost)] w-5 shrink-0">{String(idx + 1).padStart(2, "0")}</span>
            <p className="text-[var(--hq-text-dim)] text-[13px] font-medium line-clamp-1 flex-1">{it.title}</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md num border shrink-0"
              style={it.effort === "quick win"
                ? { color: "var(--hq-up)", borderColor: "rgba(52,211,153,0.25)", background: "rgba(52,211,153,0.08)" }
                : it.effort === "large"
                ? { color: "var(--hq-down)", borderColor: "rgba(251,113,133,0.25)", background: "rgba(251,113,133,0.08)" }
                : { color: "var(--hq-warn)", borderColor: "rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.08)" }}>
              {it.effort}
            </span>
          </div>
        )) : <Empty>No build ideas yet.</Empty>}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[var(--hq-text-ghost)] text-[13px] py-8 text-center">{children}</p>;
}

// ── Agents strip ──────────────────────────────────────────
function AgentsStrip({ processes }: { processes: Process[] }) {
  if (processes.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="eyebrow mr-1">System</span>
      {processes.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-lg border border-[var(--hq-hairline)] bg-white/[0.02] px-2.5 py-1.5">
          <span className="relative flex w-1.5 h-1.5">
            {p.status === "online" && <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--up) 60%, transparent)" }} />}
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: p.status === "online" ? "var(--up)" : "var(--down)" }} />
          </span>
          <span className="text-[var(--hq-text-dim)] text-[12px]">{p.name}</span>
          <span className="num text-[var(--hq-text-ghost)] text-[10px]">{p.uptime}</span>
        </div>
      ))}
    </div>
  );
}

// ── Hermes Kanban ─────────────────────────────────────────
function HermesKanbanPanel({ kanban }: { kanban: HermesKanban }) {
  const statusColor = (s: string) => {
    const k = s.toLowerCase();
    if (k.includes("done") || k.includes("complete")) return "var(--hq-up)";
    if (k.includes("progress") || k.includes("doing")) return "var(--accent)";
    if (k.includes("block")) return "var(--hq-down)";
    return "var(--hq-text-faint)";
  };
  const entries = Object.entries(kanban.counts || {});
  return (
    <div className="panel flex flex-col p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <span className="eyebrow">Hermes Board</span>
          <p className="text-[13px] text-[var(--hq-text-dim)] truncate mt-1">{kanban.board}</p>
        </div>
        <span className="num text-[22px] font-semibold text-[var(--hq-text)] shrink-0">{kanban.total}</span>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {entries.map(([status, count]) => (
            <span key={status} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium num"
              style={{ color: statusColor(status), background: `color-mix(in srgb, ${statusColor(status)} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${statusColor(status)} 22%, transparent)` }}>
              {status} {count}
            </span>
          ))}
        </div>
      )}

      {kanban.tasks.length === 0 ? <Empty>No active tasks.</Empty> : (
        <div className="space-y-0">
          {kanban.tasks.slice(0, 5).map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5 border-b border-[var(--hq-hairline)] last:border-0">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor(t.status) }} />
              <p className="text-[13px] text-[var(--hq-text-dim)] leading-snug line-clamp-1 flex-1">{t.title}</p>
              {t.assignee && <span className="num text-[10.5px] text-[var(--hq-text-ghost)] shrink-0">{t.assignee}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Momentum Score gauge (dashboard hero) ─────────────────
function ScoreGauge({ score }: { score: ScoreData }) {
  const tier = score.score >= 80 ? "var(--hq-up)" : score.score >= 60 ? "var(--hq-warn)" : "var(--hq-down)";
  const counted = useCountUp(score.score, 1400, true);
  const R = 50, C = 2 * Math.PI * R;
  const pct = Math.min(100, Math.max(0, counted));
  const comps = Object.entries(score.components || {}).slice(0, 4);
  return (
    <div className="flex items-center gap-5">
      <div className="relative w-[112px] h-[112px] shrink-0">
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--hq-hairline)" strokeWidth="6" />
          <circle cx="60" cy="60" r="50" fill="none" stroke={tier} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${(C * pct) / 100} ${C}`} style={{ transition: "stroke-dasharray 0.5s var(--ease)" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num font-semibold text-[32px] leading-none tracking-[-0.02em]" style={{ color: tier }}>{Math.round(counted)}</span>
          <span className="num text-[10.5px] text-[var(--hq-text-ghost)] mt-1">{score.grade}</span>
        </div>
      </div>
      <div className="hidden sm:block w-[176px]">
        <div className="eyebrow !text-[9.5px]">Momentum</div>
        <div className="text-[14px] font-semibold mt-0.5 mb-2.5" style={{ color: tier }}>{score.label}</div>
        <div className="space-y-[7px]">
          {comps.map(([k, c]) => {
            const cc = c.score >= 80 ? "var(--hq-up)" : c.score >= 40 ? "var(--hq-warn)" : "var(--hq-down)";
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="num text-[9.5px] text-[var(--hq-text-ghost)] w-14 truncate">{c.label.split(" ")[0]}</span>
                <div className="h-[3px] flex-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${c.score}%`, background: cc, opacity: 0.85, transition: "width 1s var(--ease)" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState<HomeData>(EMPTY);
  const [time, setTime] = useState(new Date());
  const [loaded, setLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [score, setScore] = useState<ScoreData | null>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    fetch("/api/score").then(r => r.ok ? r.json() : null).then(d => { if (d) setScore(d); }).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    fetch("/api/home")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setData(d); setTimeout(() => setLoaded(true), 100); } })
      .catch(() => {});
    const iv = setInterval(() => {
      fetch("/api/home").then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d); }).catch(() => {});
    }, 60_000);
    return () => clearInterval(iv);
  }, []);

  if (!mounted) return null;

  const stale = data.daysSincePost > 3 && data.daysSincePost < 999;
  const rise = (i: number) => ({ animationDelay: `${i * 60}ms` });

  return (
    <>
      <div className="relative z-10 w-full mx-auto pb-16">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="hq-rise pt-4 pb-10 flex flex-wrap items-end justify-between gap-6" style={rise(0)}>
          <div>
            <div className="eyebrow mb-2.5">{greeting()}</div>
            <h1 className="text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--hq-text)]">{process.env.NEXT_PUBLIC_OWNER_NAME || "Founder"}</h1>
            <p className="num text-[var(--hq-text-ghost)] text-[12.5px] mt-3">
              {time.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {"  ·  "}
              {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
            </p>
          </div>
          <div className="flex flex-col items-end gap-4">
            <div className="flex items-center gap-2.5">
              {data.daysSincePost < 999 && (
                <div className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
                  style={stale
                    ? { color: "var(--hq-warn)", borderColor: "rgba(251,191,36,0.22)", background: "rgba(251,191,36,0.07)" }
                    : { color: "var(--hq-up)", borderColor: "rgba(52,211,153,0.22)", background: "rgba(52,211,153,0.07)" }}>
                  <span className="num">{data.daysSincePost === 0 ? "Posted today" : `${data.daysSincePost}d since post`}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 rounded-full border border-[var(--hq-hairline)] bg-white/[0.02] px-2.5 py-1">
                <span className="relative flex w-1.5 h-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--up) 60%, transparent)" }} />
                  <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--up)" }} />
                </span>
                <span className="eyebrow !text-[9.5px] !text-[var(--hq-text-faint)]">Live</span>
              </div>
            </div>
            {score && <ScoreGauge score={score} />}
          </div>
        </div>

        {/* ── Brief + Approval inbox (side-by-side on wide) ─ */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
          <div className="xl:col-span-2 hq-rise" style={rise(1)}>
            <HermesBriefing />
          </div>
          <div className="xl:col-span-1 hq-rise" style={rise(2)}>
            <ApprovalInbox compact />
          </div>
        </div>

        {/* ── Signal ──────────────────────────────────────── */}
        <div className="mt-14">
          <SectionLabel>Signal</SectionLabel>
          <div className="hq-rise max-w-xl" style={rise(4)}><IdeasPanel buildIdeas={data.topBuildIdeas} /></div>
        </div>

        {/* ── Agents strip ────────────────────────────────── */}
        <div className="mt-14">
          <AgentsStrip processes={data.processes} />
        </div>
      </div>
    </>
  );
}

"use client";

import { useState, useEffect } from "react";
import type { Agent } from "@/components/agent-card";

// ── Desk layout ───────────────────────────────────────────
const DESK_LAYOUT = [
  { agentId: "coordinator", label: "Incident Command", zone: "lead" },
  { agentId: "apps",        label: "Apps Desk",         zone: "team" },
  { agentId: "edge",        label: "Edge Desk",         zone: "team" },
  { agentId: "infra",       label: "Infra Desk",        zone: "team" },
  { agentId: "verifier",    label: "Verification Desk", zone: "team" },
];

// ── Status → visual config ────────────────────────────────
const STATUS: Record<string, { glow: string; dot: string; bg: string; ring?: string }> = {
  working:   { glow: "shadow-[0_0_24px_6px_rgba(56,189,248,0.45)]",  dot: "bg-sky-400",     bg: "bg-sky-900/30 border-sky-500/40",     ring: "rgba(56,189,248,0.5)" },
  idle:      { glow: "shadow-[0_0_12px_2px_rgba(251,191,36,0.2)]",   dot: "bg-yellow-400",  bg: "bg-yellow-900/20 border-yellow-500/30" },
  error:     { glow: "shadow-[0_0_12px_2px_rgba(248,113,113,0.3)]",  dot: "bg-red-400",     bg: "bg-red-900/20 border-red-500/30" },
  offline:   { glow: "",                                               dot: "bg-neutral-600", bg: "bg-neutral-800/20 border-neutral-700/20" },
  online:    { glow: "shadow-[0_0_16px_3px_rgba(52,211,153,0.3)]",   dot: "bg-emerald-400", bg: "bg-emerald-900/20 border-emerald-500/30" },
  active:    { glow: "shadow-[0_0_16px_3px_rgba(52,211,153,0.3)]",   dot: "bg-emerald-400", bg: "bg-emerald-900/20 border-emerald-500/30" },
  completed: { glow: "shadow-[0_0_12px_2px_rgba(251,191,36,0.2)]",   dot: "bg-yellow-400",  bg: "bg-yellow-900/20 border-yellow-500/30" },
};

// ── Per-agent walk timing (keeps them out of sync) ────────
const WALK = {
  coordinator: { wanderDur: "14s", bobDur: "0.35s", bobDelay: "0s",    wanderDelay: "0s" },
  apps:        { wanderDur: "8s",  bobDur: "0.40s", bobDelay: "0.1s",  wanderDelay: "1.2s" },
  edge:        { wanderDur: "11s", bobDur: "0.45s", bobDelay: "0.2s",  wanderDelay: "2.5s" },
  infra:       { wanderDur: "9s",  bobDur: "0.38s", bobDelay: "0.05s", wanderDelay: "0.7s" },
  verifier:    { wanderDur: "12s", bobDur: "0.42s", bobDelay: "0.15s", wanderDelay: "3.1s" },
};

// ── Pixel art sprites ─────────────────────────────────────
// No custom sprites yet for the real roster — PixelSprite falls back to a
// generic 🤖 for any id with no entry here. Add an entry the same shape as
// this record to give a role custom pixel art later.
const SPRITE_DATA: Record<string, { palette: Record<string, string>; rows: string[] }> = {};

function PixelSprite({ agentId, size }: { agentId: string; size: number }) {
  const data = SPRITE_DATA[agentId];
  if (!data) return <span style={{ fontSize: size * 0.6 }}>🤖</span>;
  const { palette, rows } = data;
  const gw = rows[0]?.length ?? 16;
  const gh = rows.length;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${gw} ${gh}`} style={{ imageRendering: "pixelated" }}>
      {rows.map((row, y) =>
        row.split("").map((char, x) => {
          const color = char === "." ? null : palette[char];
          return color ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} /> : null;
        })
      )}
    </svg>
  );
}

// ── Activity bubble ───────────────────────────────────────
function ActivityBubble({ text, delay }: { text: string; delay: string }) {
  const short = text.length > 52 ? text.slice(0, 52) + "…" : text;
  return (
    <div
      className="absolute -top-12 left-1/2 z-20 pointer-events-none"
      style={{
        transform: "translateX(-50%)",
        animation: `bubble-cycle 8s ${delay} infinite`,
        opacity: 0,
        minWidth: 100,
        maxWidth: 160,
      }}
    >
      <div className="bg-neutral-800/90 border border-neutral-600/60 rounded-xl px-2.5 py-1.5 text-[9px] text-neutral-200 leading-snug shadow-lg">
        {short}
      </div>
      {/* Tail */}
      <div className="mx-auto w-2 h-2 overflow-hidden" style={{ marginTop: -1 }}>
        <div className="w-2 h-2 bg-neutral-700/80 rotate-45 origin-top-left scale-75 ml-[3px]" />
      </div>
    </div>
  );
}

// ── Animated monitor screen ───────────────────────────────
function MonitorScreen({ isWorking }: { isWorking: boolean }) {
  return (
    <div
      className={`w-10 h-7 rounded border flex flex-col gap-0.5 p-1 overflow-hidden
        ${isWorking ? "border-sky-500/60 bg-sky-950/60" : "border-neutral-600/40 bg-neutral-800/60"}`}
      style={isWorking ? { animation: "screen-flicker 1.2s infinite" } : undefined}
    >
      {isWorking ? (
        <>
          <div className="h-px bg-sky-400/80 rounded" style={{ width: "90%" }} />
          <div className="h-px bg-sky-300/50 rounded" style={{ width: "60%" }} />
          <div className="h-px bg-emerald-400/60 rounded" style={{ width: "75%" }} />
          <div className="h-px bg-sky-400/70 rounded" style={{ width: "40%" }} />
          <div className="h-px bg-sky-300/50 rounded" style={{ width: "85%" }} />
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-1 h-1 rounded-full bg-neutral-600/60" />
        </div>
      )}
    </div>
  );
}

// ── Agent desk tile ───────────────────────────────────────
function AgentDesk({ agent, label, isLead, onSelect }: { agent: Agent | undefined; label: string; isLead: boolean; onSelect?: (agent: Agent) => void }) {
  const rawStatus = agent?.status ?? "offline";
  const statusKey = STATUS[rawStatus] ? rawStatus : "idle";
  const colors = STATUS[statusKey];
  const isWorking = rawStatus === "working";
  const isOffline = rawStatus === "offline" || !agent;
  const spriteSize = isLead ? 56 : 44;
  const walk = WALK[agent?.id as keyof typeof WALK] ?? WALK.apps;

  // Pick bubble text: currentTask > last activity > null
  const bubbleText = agent?.currentTask
    || agent?.recentActivity?.[0]?.action
    || null;

  // Bubble cycle delay — stagger so not all pop at once
  const bubbleDelay = isLead ? "0.5s" : walk.wanderDelay;

  return (
    <div className="relative flex flex-col items-center gap-2">
      {/* Desk tile */}
      <div
        className={`relative rounded-2xl border overflow-visible transition-all duration-500
          ${isLead ? "w-44 h-44" : "w-36 h-36"}
          ${colors.bg} ${colors.glow}
          ${isOffline ? "opacity-40" : ""}
          ${agent && onSelect ? "cursor-pointer" : ""}
          hover:scale-105 hover:z-10`}
        style={isWorking ? { animation: "status-ring 1.5s infinite" } : undefined}
        onClick={agent && onSelect ? () => onSelect(agent) : undefined}
      >
        {/* Desk surface */}
        <div className={`absolute bottom-3 left-3 right-3 h-1/3 rounded-lg
          ${isOffline ? "bg-neutral-700/30" : "bg-neutral-800/50"} border-t border-neutral-700/40`}>
          {/* Monitor */}
          {!isOffline && (
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0">
              <MonitorScreen isWorking={isWorking} />
              <div className="w-3 h-1 bg-neutral-600/50" />
              <div className="w-5 h-0.5 bg-neutral-600/50 rounded" />
            </div>
          )}
        </div>

        {/* Avatar + walking animation */}
        <div className="absolute top-2 left-0 right-0 flex flex-col items-center">
          {/* Activity bubble lives OUTSIDE the flip wrapper so it never mirrors */}
          <div className="relative w-full flex justify-center">
            {bubbleText && !isOffline && (
              <ActivityBubble text={bubbleText} delay={bubbleDelay} />
            )}
          </div>

          {/* Horizontal wander wrapper */}
          <div
            style={
              isWorking
                ? { animation: `agent-type 0.55s ease-in-out infinite` }
                : isOffline
                ? undefined
                : { animation: `agent-wander ${walk.wanderDur} ${walk.wanderDelay} infinite ease-in-out` }
            }
          >
            {/* Vertical bob wrapper */}
            <div
              style={
                !isOffline && !isWorking
                  ? { animation: `agent-bob ${walk.bobDur} ${walk.bobDelay} infinite ease-in-out` }
                  : undefined
              }
            >
              <PixelSprite agentId={agent?.id ?? ""} size={spriteSize} />
            </div>
          </div>

          {/* Name + status dot */}
          <div className="flex items-center gap-1 mt-1">
            <div className={`w-1.5 h-1.5 rounded-full ${colors.dot} ${isWorking ? "animate-pulse" : ""}`} />
            <span className={`text-[10px] font-bold tracking-wider uppercase ${isOffline ? "text-neutral-600" : "text-white/80"}`}>
              {agent?.name ?? "Empty"}
            </span>
          </div>
        </div>

        {/* Tasks badge */}
        {agent && agent.tasksCompleted > 0 && (
          <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-neutral-700 border border-neutral-600 flex items-center justify-center z-10">
            <span className="text-[9px] font-bold text-white">{agent.tasksCompleted > 99 ? "99+" : agent.tasksCompleted}</span>
          </div>
        )}
      </div>

      {/* Label */}
      <div className="text-center">
        <div className={`text-[10px] uppercase tracking-wider ${isOffline ? "text-neutral-700" : "text-neutral-500"}`}>{label}</div>
        {agent?.role && <div className="text-[10px] text-neutral-600 truncate max-w-[140px]">{agent.role}</div>}
      </div>
    </div>
  );
}

// ── Scrolling activity ticker ─────────────────────────────
function ActivityTicker({ agents }: { agents: Agent[] }) {
  const events = agents
    .flatMap(a => (a.recentActivity ?? []).slice(0, 2).map(ev => ({ name: a.name, emoji: a.emoji, action: ev.action })))
    .slice(0, 8);

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (events.length === 0) return;
    const t = setInterval(() => setIdx(i => (i + 1) % events.length), 4000);
    return () => clearInterval(t);
  }, [events.length]);

  if (events.length === 0) return null;
  const ev = events[idx];

  return (
    <div className="flex items-center gap-2 bg-neutral-900/60 border border-neutral-800/40 rounded-xl px-4 py-2 max-w-xl mx-auto">
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
      <span className="text-[10px] text-neutral-500 font-mono shrink-0">{ev.name}</span>
      <span className="text-[10px] text-neutral-400 truncate">{ev.action.slice(0, 80)}</span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────
export default function SupportOfficeView({ agents, teamLabel, onSelectAgent }: { agents: Agent[]; teamLabel: string; onSelectAgent?: (agent: Agent) => void }) {
  const getAgent = (id: string) => agents.find(a => a.id === id);
  const leadAgent = getAgent("coordinator");
  const teamDesks = DESK_LAYOUT.filter(d => d.agentId !== "coordinator");

  return (
    <div className="relative rounded-3xl overflow-hidden border border-neutral-800/60 bg-neutral-950/80">
      {/* Floor */}
      <div
        className="relative p-8"
        style={{
          background:
            "repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,0.02) 39px,rgba(255,255,255,0.02) 40px)," +
            "repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,0.02) 39px,rgba(255,255,255,0.02) 40px)",
        }}
      >
        {/* Office sign */}
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center gap-3 bg-neutral-900/80 border border-neutral-700/40 rounded-2xl px-5 py-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono font-bold tracking-[0.2em] text-neutral-400 uppercase">
              {teamLabel}
            </span>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
        </div>

        {/* Desks */}
        <div className="flex flex-col items-center gap-8">
          {/* Row 1 — lead */}
          <AgentDesk agent={leadAgent} label="Incident Command" isLead={true} onSelect={onSelectAgent} />
          <div className="w-px h-4 bg-neutral-700/60" />
          {/* Row 2 — Team */}
          <div className="flex flex-wrap justify-center gap-6 md:gap-8">
            {teamDesks.map(desk => (
              <AgentDesk key={desk.agentId} agent={getAgent(desk.agentId)} label={desk.label} isLead={false} onSelect={onSelectAgent} />
            ))}
          </div>
        </div>

        {/* Activity ticker */}
        <div className="mt-8">
          <ActivityTicker agents={agents} />
        </div>

        {/* Floor props */}
        <div className="mt-4 flex items-center justify-center gap-6 opacity-20">
          <span className="text-2xl select-none">🌿</span>
          <div className="flex items-center gap-1">
            <span className="text-xl">☕</span>
            <span className="text-[10px] text-neutral-500 font-mono">FUEL STATION</span>
          </div>
          <span className="text-2xl select-none">🌿</span>
        </div>
      </div>

      {/* Legend */}
      <div className="border-t border-neutral-800/60 px-6 py-3 flex items-center gap-6 flex-wrap">
        {[
          { status: "working", label: "Working" },
          { status: "idle",    label: "Idle" },
          { status: "offline", label: "Offline" },
          { status: "error",   label: "Error" },
        ].map(({ status, label }) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${STATUS[status]?.dot ?? "bg-neutral-600"}`} />
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

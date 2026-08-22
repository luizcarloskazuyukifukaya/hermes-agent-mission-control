"use client";

import { useEffect, useState, useCallback } from "react";
import SupportOfficeView from "@/components/SupportOfficeView";
import { AgentCard, type Agent } from "@/components/agent-card";
import { AgentChat } from "@/components/agent-chat";
import { TaskBoard, type Task } from "@/components/task-board";
import { useAgentChats } from "@/lib/use-agent-chats";

interface BoardData {
  tasks: Task[];
  total: number;
  lastSync: string | null;
}

const EMPTY_BOARD: BoardData = { tasks: [], total: 0, lastSync: null };

export function SupportTeamPage({ env, title }: { env: "dev" | "pro"; title: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [board, setBoard] = useState<BoardData>(EMPTY_BOARD);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "office" | "board">("office");
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const { getThread, sendMessage } = useAgentChats(env);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch(`/api/support-team/${env}`);
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : []);
    } catch {}
    setLoading(false);
  }, [env]);

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch(`/api/support-team/${env}/tasks`);
      const data = await res.json();
      if (data && Array.isArray(data.tasks)) setBoard(data);
    } catch {}
  }, [env]);

  useEffect(() => {
    loadAgents();
    loadBoard();
    const interval = setInterval(() => { loadAgents(); loadBoard(); }, 10000); // poll every 10s
    return () => clearInterval(interval);
  }, [loadAgents, loadBoard]);

  if (loading) {
    return (
      <div className="relative min-h-screen p-8">
        <div className="relative z-10 w-full mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="sk h-32 rounded-[var(--r-lg)]" />)}
        </div>
      </div>
    );
  }

  const leadAgent = agents.find(a => a.id === "coordinator");
  const teamAgents = agents.filter(a => a.id !== "coordinator");
  const online = agents.filter(a => a.status !== "offline").length;
  const working = agents.filter(a => a.status === "working").length;
  const totalTasks = agents.reduce((sum, a) => sum + a.tasksCompleted, 0);

  return (
    <>
      <div className="relative z-10 w-full mx-auto text-[var(--text)] p-8 pb-16 space-y-8">
      {/* Header */}
      <div className="hq-rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2.5">V-Decent Support</div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">{title}</h1>
          <p className="text-[13px] text-[var(--text-3)] mt-3">Live from the vdecent-support-{env === "dev" ? "dev" : "prod"} kanban board</p>
        </div>
        <div className="flex items-center gap-6">
          {/* Stats */}
          <div className="flex gap-7 text-center">
            <div>
              <div className="num text-[22px] font-semibold leading-none" style={{ color: "var(--up)" }}>{online}<span className="text-[var(--text-4)]">/{agents.length}</span></div>
              <div className="eyebrow mt-1.5">Online</div>
            </div>
            <div>
              <div className="num text-[22px] font-semibold leading-none" style={{ color: "var(--accent)" }}>{working}</div>
              <div className="eyebrow mt-1.5">Working</div>
            </div>
            <div>
              <div className="num text-[22px] font-semibold leading-none text-[var(--text)]">{totalTasks}</div>
              <div className="eyebrow mt-1.5">Total Tasks</div>
            </div>
          </div>
          {/* View toggle */}
          <div className="flex rounded-full p-1 gap-1" style={{ border: "1px solid var(--line)" }}>
            <button
              onClick={() => setView("office")}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                view === "office"
                  ? "bg-white/[0.08] text-[var(--text)]"
                  : "text-[var(--text-3)] hover:text-[var(--text-2)]"
              }`}
            >
              Office
            </button>
            <button
              onClick={() => setView("cards")}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                view === "cards"
                  ? "bg-white/[0.08] text-[var(--text)]"
                  : "text-[var(--text-3)] hover:text-[var(--text-2)]"
              }`}
            >
              Cards
            </button>
            <button
              onClick={() => setView("board")}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                view === "board"
                  ? "bg-white/[0.08] text-[var(--text)]"
                  : "text-[var(--text-3)] hover:text-[var(--text-2)]"
              }`}
            >
              Board
            </button>
          </div>
        </div>
      </div>

      {/* Live Agent Chat Modal */}
      {chatAgent && (
        <AgentChat
          agent={chatAgent}
          env={env}
          thread={getThread(chatAgent.id)}
          onSend={(text) => sendMessage(chatAgent, text)}
          onClose={() => setChatAgent(null)}
        />
      )}

      {/* Office View */}
      {view === "office" && (
        <>
          <SupportOfficeView agents={agents} teamLabel={`${title} · Support Floor`} onSelectAgent={setChatAgent} />
          {/* Chat quick-launch strip */}
          <div className="flex flex-wrap gap-2 pt-2">
            {teamAgents.map(a => {
              const isOpen = chatAgent?.id === a.id;
              const isBusy = getThread(a.id).loading;
              return (
                <button key={a.id} onClick={() => setChatAgent(a)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] transition-colors panel-interactive ${
                    isOpen ? "bg-white/[0.08] text-[var(--text)]" : "text-[var(--text-2)]"
                  }`}
                  style={{
                    background: isOpen ? undefined : "var(--surface-1)",
                    border: isOpen ? "2px solid var(--up)" : "1px solid var(--line)",
                  }}>
                  <span>{a.emoji}</span> Chat with {a.name}
                  {isBusy && (
                    <span className="relative flex w-1.5 h-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--accent) 60%, transparent)" }} />
                      <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                    </span>
                  )}
                </button>
              );
            })}
            {leadAgent && (
              <button onClick={() => setChatAgent(leadAgent)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] transition-colors"
                style={{
                  color: "var(--accent)",
                  background: chatAgent?.id === leadAgent.id ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "color-mix(in srgb, var(--accent) 10%, transparent)",
                  border: chatAgent?.id === leadAgent.id ? "2px solid var(--up)" : "1px solid color-mix(in srgb, var(--accent) 28%, transparent)",
                }}>
                🧭 Chat with {leadAgent.name}
                {getThread(leadAgent.id).loading && (
                  <span className="relative flex w-1.5 h-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--accent) 60%, transparent)" }} />
                    <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                  </span>
                )}
              </button>
            )}
          </div>
        </>
      )}

      {/* Cards View */}
      {view === "cards" && (
        <>
          {/* Coordinator — full width */}
          {leadAgent && (
            <AgentCard
              agent={leadAgent}
              isExpanded={expandedAgent === leadAgent.id}
              onToggle={() => setExpandedAgent(expandedAgent === leadAgent.id ? null : leadAgent.id)}
            />
          )}

          {/* Team grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teamAgents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isExpanded={expandedAgent === agent.id}
                onToggle={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
              />
            ))}
          </div>

          {/* Org chart visual */}
          <div className="pt-6" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="eyebrow mb-5">Team Structure</div>
            <div className="flex flex-col items-center gap-2">
              {leadAgent && (
                <div className="flex items-center gap-2.5 rounded-[var(--r-md)] px-4 py-2.5"
                  style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 24%, transparent)" }}>
                  <span className="text-xl">{leadAgent.emoji}</span>
                  <div>
                    <div className="text-[13px] font-semibold text-[var(--text)]">{leadAgent.name}</div>
                    <div className="text-[10px] text-[var(--text-3)]">{leadAgent.role}</div>
                  </div>
                </div>
              )}
              <div className="w-px h-6" style={{ background: "var(--line-strong)" }} />
              <div className="flex items-center gap-0">
                <div className="w-32 h-px" style={{ background: "var(--line-strong)" }} />
                <div className="w-px h-4" style={{ background: "var(--line-strong)" }} />
                <div className="w-32 h-px" style={{ background: "var(--line-strong)" }} />
                <div className="w-px h-4" style={{ background: "var(--line-strong)" }} />
                <div className="w-32 h-px" style={{ background: "var(--line-strong)" }} />
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                {teamAgents.map(agent => (
                  <div key={agent.id} className="flex items-center gap-2.5 rounded-[var(--r-md)] px-3.5 py-2.5"
                    style={{ background: "var(--surface-1)", border: "1px solid var(--line)", opacity: agent.status === "offline" ? 0.5 : 1 }}>
                    <span className="text-lg">{agent.emoji}</span>
                    <div>
                      <div className="text-[12px] font-semibold text-[var(--text)]">{agent.name}</div>
                      <div className="text-[10px] text-[var(--text-3)]">{agent.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Board View */}
      {view === "board" && (
        <TaskBoard
          tasks={board.tasks}
          total={board.total}
          lastSync={board.lastSync}
          label="Issue board"
          title={`${title} incidents`}
          emptyTitle="No open incidents"
          emptyHint="Incidents mirrored from this environment's support board will show up here."
        />
      )}
      </div>
    </>
  );
}

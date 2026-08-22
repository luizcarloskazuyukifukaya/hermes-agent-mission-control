"use client";

import { useEffect, useState, useRef } from "react";
import type { Agent } from "@/components/agent-card";

const roleColors: Record<string, string> = {
  max: "from-amber-500/20 to-amber-600/5 border-amber-500/20",
  sage: "from-sky-500/20 to-sky-600/5 border-sky-500/20",
  knox: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/20",
  nova: "from-purple-500/20 to-purple-600/5 border-purple-500/20",
  pixel: "from-blue-500/20 to-blue-600/5 border-blue-500/20",
};

async function sendLive(env: "dev" | "pro", role: string, message: string): Promise<string> {
  const createRes = await fetch(`/api/support-team/${env}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, message }),
  });
  if (!createRes.ok) throw new Error("dispatch failed");
  const { requestId } = (await createRes.json()) as { requestId: string };

  // Poll up to ~5 minutes (bridge run timeout is 240s) at 2s intervals.
  for (let i = 0; i < 150; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const pollRes = await fetch(`/api/hermes/requests/${requestId}`);
    if (!pollRes.ok) continue;
    const { request } = (await pollRes.json()) as {
      request: { status: string; result: string | null; error: string | null };
    };
    if (request.status === "done") return request.result || "(no response)";
    if (request.status === "failed" || request.status === "rejected") {
      throw new Error(request.error || "request failed");
    }
  }
  throw new Error("timed out waiting for a reply");
}

export function AgentChat({ agent, env, onClose }: { agent: Agent; env: "dev" | "pro"; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<{ role: "user"|"assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const newMsgs = [...msgs, { role: "user" as const, content: text }];
    setMsgs(newMsgs);
    setLoading(true);
    try {
      if (agent.live) {
        const reply = await sendLive(env, agent.id, text);
        setMsgs([...newMsgs, { role: "assistant", content: reply }]);
      } else {
        const r = await fetch("/api/agent-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: agent.id, message: text, history: msgs }),
        });
        const d = await r.json() as { reply: string };
        setMsgs([...newMsgs, { role: "assistant", content: d.reply }]);
      }
    } catch {
      setMsgs([...newMsgs, { role: "assistant", content: "Sorry, something went wrong. Try again." }]);
    }
    setLoading(false);
  }

  const agentColor = roleColors[agent.id]?.split(" ")[0]?.replace("from-","text-")?.replace("/20","") || "text-[var(--text-3)]";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="elevated w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="text-2xl">{agent.emoji}</div>
          <div>
            <div className="text-[14px] font-semibold text-[var(--text)]">{agent.name}</div>
            <div className="text-[12px] text-[var(--text-3)]">{agent.role}</div>
          </div>
          <button onClick={onClose} className="ml-auto text-[var(--text-3)] hover:text-[var(--text)] transition-colors text-xl leading-none">×</button>
        </div>
        {/* Simulated / live notice */}
        {agent.live ? (
          <div className="px-4 py-1.5 text-center text-[10px] font-medium tracking-wide uppercase"
            style={{ background: "color-mix(in srgb, var(--up) 10%, transparent)", color: "var(--up)", borderBottom: "1px solid var(--line)" }}>
            Live — connected to hermes-{env}-{agent.id}
          </div>
        ) : (
          <div className="px-4 py-1.5 text-center text-[10px] font-medium tracking-wide uppercase"
            style={{ background: "color-mix(in srgb, var(--warn) 10%, transparent)", color: "var(--warn)", borderBottom: "1px solid var(--line)" }}>
            Simulated — not the live agent
          </div>
        )}
        {/* Messages */}
        <div className="h-80 overflow-y-auto p-4 space-y-3 flex flex-col" style={{ background: "var(--surface-1)" }}>
          {msgs.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[var(--text-3)] text-[13px] text-center">Ask {agent.name} anything.<br/>They&apos;re ready.</p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[80%] rounded-[var(--r-md)] px-3.5 py-2 text-[13px] leading-relaxed"
                style={m.role === "user"
                  ? { background: "var(--surface-3)", color: "var(--text)" }
                  : { background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
                {m.role === "assistant" && <span className="text-xs mr-1">{agent.emoji}</span>}
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-[var(--r-md)] px-3.5 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                <span className="text-[var(--text-3)] text-[13px]">
                  {agent.emoji} {agent.live ? "working — can take a couple of minutes on real diagnostic work…" : "thinking…"}
                </span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        {/* Input */}
        <div className="flex gap-2 p-3" style={{ borderTop: "1px solid var(--line)" }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
            placeholder={`Message ${agent.name}…`}
            className="flex-1 rounded-full px-4 py-2 text-[13px] text-[var(--text)] focus:outline-none transition-colors"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="btn-primary px-4 py-2 text-[13px]"
          >Send</button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useState } from "react";
import type { Agent } from "@/components/agent-card";

export interface ChatThread {
  msgs: { role: "user" | "assistant"; content: string }[];
  loading: boolean;
}

const EMPTY_THREAD: ChatThread = { msgs: [], loading: false };

async function sendLive(env: "dev" | "pro", role: string, message: string): Promise<string> {
  const createRes = await fetch(`/api/support-team/${env}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, message }),
  });
  if (!createRes.ok) throw new Error("dispatch failed");
  const { requestId } = (await createRes.json()) as { requestId: string };

  // Poll at 2s intervals. The bridge processes its queue serially (up to
  // 240s per request), so a message queued behind other in-flight work can
  // take a while to even start — budget generously (~20 minutes) rather
  // than timing out while the bridge is still actively on it.
  for (let i = 0; i < 600; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const pollRes = await fetch(`/api/hermes/requests/${requestId}`);
      if (!pollRes.ok) continue;
      const { request } = (await pollRes.json()) as {
        request: { status: string; result: string | null; error: string | null };
      };
      if (request.status === "done") return request.result || "(no response)";
      if (request.status === "failed" || request.status === "rejected") {
        throw new Error(request.error || "request failed");
      }
    } catch (err) {
      // Only continue on network/JSON errors; re-throw Hermes errors
      if (err instanceof TypeError || err instanceof SyntaxError) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("still waiting after a long time — the coordinator may still be working on this; try asking again");
}

export function useAgentChats(env: "dev" | "pro") {
  const [threads, setThreads] = useState<Record<string, ChatThread>>({});

  const getThread = useCallback(
    (agentId: string): ChatThread => threads[agentId] ?? EMPTY_THREAD,
    [threads]
  );

  const sendMessage = useCallback((agent: Agent, text: string) => {
    const id = agent.id;
    if (!text || threads[id]?.loading) return;
    const priorMsgs = threads[id]?.msgs ?? [];

    setThreads(prev => ({
      ...prev,
      [id]: { msgs: [...priorMsgs, { role: "user", content: text }], loading: true },
    }));

    (async () => {
      try {
        let reply: string;
        if (agent.live) {
          reply = await sendLive(env, agent.id, text);
        } else {
          const r = await fetch("/api/agent-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: agent.id, message: text, history: priorMsgs }),
          });
          const d = (await r.json()) as { reply: string };
          reply = d.reply;
        }
        setThreads(prev => {
          const existing = prev[id] ?? EMPTY_THREAD;
          return { ...prev, [id]: { msgs: [...existing.msgs, { role: "assistant", content: reply }], loading: false } };
        });
      } catch (err) {
        const content = agent.live && err instanceof Error
          ? err.message
          : "Sorry, something went wrong. Try again.";
        setThreads(prev => {
          const existing = prev[id] ?? EMPTY_THREAD;
          return { ...prev, [id]: { msgs: [...existing.msgs, { role: "assistant", content }], loading: false } };
        });
      }
    })();
  }, [env, threads]);

  return { getThread, sendMessage };
}

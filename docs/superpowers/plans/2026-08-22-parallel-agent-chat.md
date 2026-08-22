# Independent Per-Agent Chat State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the live-testing-reported bug where switching between "Chat with X" buttons bleeds message history and loses in-flight replies, because the chat modal is one unkeyed component instance sharing state across every agent.

**Architecture:** Move `msgs`/`loading` state out of `AgentChat` into a new hook, `useAgentChats(env)`, keyed per agent id and owned by `SupportTeamPage`. `AgentChat` becomes a presentational component driven by a `thread` prop and an `onSend` callback. Because the hook's state updates target a specific agent id via `setThreads(prev => ...)` regardless of what's currently rendered, a reply that resolves while a different agent's chat is open (or the modal is closed) still lands correctly and shows up when that agent's chat is reopened.

**Tech Stack:** Next.js 16 (App Router, TypeScript, client components). No backend changes — this is entirely a frontend state-management fix.

## Global Constraints

- No test framework exists in this repo — verification is `npx tsc`, plus a final ask for the user to reproduce the exact reported bug scenario in the browser (there's no headless way to exercise React state transitions in this environment).
- Exactly one chat modal is visible at a time — this plan does not add simultaneous multi-window/tiled chat display, only correct independent state per agent.
- The currently-typed-but-unsent draft text stays local to `AgentChat` (not lifted into the hook) — it's not part of the bug.
- Design spec: `docs/superpowers/specs/2026-08-22-parallel-agent-chat-design.md`.

---

### Task 1: `useAgentChats` hook + presentational `AgentChat`

**Files:**
- Create: `src/lib/use-agent-chats.ts`
- Modify: `src/components/agent-chat.tsx` (full rewrite — shown below)

**Interfaces:**
- Produces (used by Task 2): `ChatThread` type (`{ msgs: {role: "user"|"assistant"; content: string}[]; loading: boolean }`), `useAgentChats(env: "dev" | "pro")` returning `{ getThread(agentId: string): ChatThread; sendMessage(agent: Agent, text: string): void }`. `AgentChat`'s new prop signature: `{ agent: Agent; env: "dev" | "pro"; thread: ChatThread; onSend: (text: string) => void; onClose: () => void }`.

- [ ] **Step 1: Create the hook**

`src/lib/use-agent-chats.ts` (new file):

```ts
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
```

- [ ] **Step 2: Rewrite `AgentChat` as a presentational component**

Full replacement content for `src/components/agent-chat.tsx`:

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import type { Agent } from "@/components/agent-card";
import type { ChatThread } from "@/lib/use-agent-chats";
import { profileId } from "@/lib/live-profiles";

const roleColors: Record<string, string> = {
  max: "from-amber-500/20 to-amber-600/5 border-amber-500/20",
  sage: "from-sky-500/20 to-sky-600/5 border-sky-500/20",
  knox: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/20",
  nova: "from-purple-500/20 to-purple-600/5 border-purple-500/20",
  pixel: "from-blue-500/20 to-blue-600/5 border-blue-500/20",
};

export function AgentChat({
  agent, env, thread, onSend, onClose,
}: {
  agent: Agent;
  env: "dev" | "pro";
  thread: ChatThread;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const { msgs, loading } = thread;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    onSend(text);
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
            Live — connected to hermes-{profileId(env, agent.id).replace(/^vdecent-/, "")}
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
```

(Note: `agentColor` is computed but unused — this is pre-existing dead code carried over unchanged from the current file, not introduced by this rewrite. Leave it as-is; removing it is out of scope for this fix.)

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: errors in `src/components/support-team-page.tsx` only (it still calls the old `AgentChat` prop signature — that's Task 2). No errors in `src/lib/use-agent-chats.ts` or `src/components/agent-chat.tsx` themselves.

- [ ] **Step 4: Commit**

```bash
git add src/lib/use-agent-chats.ts src/components/agent-chat.tsx
git commit -m "$(cat <<'EOF'
refactor: move chat state into a per-agent useAgentChats hook

AgentChat owned msgs/loading internally as a single shared component
instance across every "Chat with X" button, so switching agents
mid-conversation bled message history together and could lose an
in-flight reply if you navigated away before it resolved. State now
lives in useAgentChats, keyed per agent id, so each agent's thread
and in-flight status survive being backgrounded. AgentChat itself
becomes presentational, driven by a thread prop and onSend callback.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 2: Wire `SupportTeamPage` to the hook, add selection + in-flight indicators

**Files:**
- Modify: `src/components/support-team-page.tsx`

**Interfaces:**
- Consumes: `useAgentChats` and `ChatThread` from Task 1 (`@/lib/use-agent-chats`); `AgentChat`'s new prop signature from Task 1.

- [ ] **Step 1: Import and call the hook**

Current top of `src/components/support-team-page.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import SupportOfficeView from "@/components/SupportOfficeView";
import { AgentCard, type Agent } from "@/components/agent-card";
import { AgentChat } from "@/components/agent-chat";
import { TaskBoard, type Task } from "@/components/task-board";
```

Replace with:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import SupportOfficeView from "@/components/SupportOfficeView";
import { AgentCard, type Agent } from "@/components/agent-card";
import { AgentChat } from "@/components/agent-chat";
import { TaskBoard, type Task } from "@/components/task-board";
import { useAgentChats } from "@/lib/use-agent-chats";
```

Then find:

```tsx
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
```

Replace with:

```tsx
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const { getThread, sendMessage } = useAgentChats(env);
```

- [ ] **Step 2: Pass `thread`/`onSend` to the chat modal**

Current:

```tsx
      {/* Live Agent Chat Modal */}
      {chatAgent && <AgentChat agent={chatAgent} env={env} onClose={() => setChatAgent(null)} />}
```

Replace with:

```tsx
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
```

- [ ] **Step 3: Add selected-state and in-flight indicators to the quick-launch buttons**

Current:

```tsx
          {/* Chat quick-launch strip */}
          <div className="flex flex-wrap gap-2 pt-2">
            {teamAgents.map(a => (
              <button key={a.id} onClick={() => setChatAgent(a)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] text-[var(--text-2)] transition-colors panel-interactive"
                style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
                <span>{a.emoji}</span> Chat with {a.name}
              </button>
            ))}
            {leadAgent && (
              <button onClick={() => setChatAgent(leadAgent)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] transition-colors"
                style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 28%, transparent)" }}>
                🧭 Chat with {leadAgent.name}
              </button>
            )}
          </div>
```

Replace with:

```tsx
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
                  style={{ background: isOpen ? undefined : "var(--surface-1)", border: "1px solid var(--line)" }}>
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
                  border: `1px solid color-mix(in srgb, var(--accent) ${chatAgent?.id === leadAgent.id ? "45" : "28"}%, transparent)`,
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
```

- [ ] **Step 4: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/support-team-page.tsx
git commit -m "$(cat <<'EOF'
feat: show which chat is open and which agents have a reply pending

The "Chat with X" buttons now highlight whichever agent's modal is
currently open, and show a small pulsing dot on any agent whose
reply is still in flight — even while a different agent's chat is
the one on screen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 3: Deploy and verify

**Files:** none (Coolify deployment + a request for user verification only).

**Interfaces:**
- Consumes: Task 1 and Task 2's committed code, pushed to `main`.

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Trigger a deploy and wait for it to finish**

```bash
source ~/.bashrc
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

Poll `GET https://coolify.v-decent.org/api/v1/deployments/{deployment_uuid}` until `status` is `finished`. Retry once on the known transient DNS blip; escalate if it fails twice or for any other reason.

- [ ] **Step 3: Regression check via curl — chat dispatch still works**

This change is entirely client-side (React state), so there's no new server behavior to verify — but confirm the underlying dispatch route this UI calls is unaffected by the deploy:

```bash
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "import json,sys; d=json.load(sys.stdin); print([e['value'] for e in d if not e.get('is_preview') and e['key']=='INTERNAL_API_SECRET'][0])")
curl -sS -X POST "https://dashboard.v-decent.org/api/support-team/dev/chat" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"role":"coordinator","message":"Quick check: reply with exactly CONFIRMED."}' | python3 -m json.tool
```

Poll the returned `requestId` via `GET /api/hermes/requests/{id}` until `done`. Expected: a real reply, confirming the deploy didn't break the underlying dispatch pipeline this fix sits on top of.

- [ ] **Step 4: Ask the user to reproduce the exact reported bug scenario in the browser**

Report to the user: deployed. Ask them to reproduce precisely what they reported: open `/support-pro`, click "Chat with Coordinator," send a message, and — before it resolves — click "Chat with Infra" (or any other role). Confirm: the Infra button now shows as selected (highlighted) and the Coordinator button shows a small pulsing dot while its reply is still pending; Infra's chat window is empty (not showing Coordinator's message); sending a message to Infra works and stays in Infra's own transcript; switching back to Coordinator shows its own conversation with the reply now present (not lost), and its pulsing dot is gone.

# Independent Per-Agent Chat State — Design

Date: 2026-08-22

## Purpose

Live chat was rolled out to all 10 V-Decent Support Team profiles in
[2026-08-22-live-support-team-rollout-design.md](./2026-08-22-live-support-team-rollout-design.md).
Testing it live surfaced a real frontend bug: the chat modal is a single component instance
shared across every "Chat with X" button. Clicking a different agent's button swaps which
agent's data is displayed, but React never remounts the component (no `key`), so its internal
`msgs`/`loading` state carries over unchanged. Concretely, reported live:

1. Sent a message to Coordinator (prod); while its reply was still pending, clicked "Chat with
   Infra" — the modal's banner correctly updated to show Infra, but the message transcript
   still held Coordinator's conversation.
2. Sent a message to Infra in that same (still-Coordinator's-transcript) window. It dispatched
   correctly to the real Infra profile server-side (confirmed: this part of the pipeline is
   unaffected), but arrived back into the same shared transcript as Coordinator's exchange.
3. Neither "Chat with X" button ever visually indicates which one is currently open — there was
   no way to tell, from the button row, that Infra's chat was the one actually on screen.

This is purely a client-state bug — the backend (`AgentRequest`, `hermes-bridge`, the chat
route) already handles fully independent, concurrent per-profile requests correctly. Nothing
here requires a backend change.

## What changes

### 1. Chat state moves out of `AgentChat`, into a new hook: `useAgentChats(env)`

New file: `src/lib/use-agent-chats.ts`. Owns:

```ts
interface ChatThread {
  msgs: { role: "user" | "assistant"; content: string }[];
  loading: boolean;
}
```

— one `ChatThread` per agent id, in a `Record<string, ChatThread>`, plus a
`sendMessage(agent: Agent, text: string): void` function. `sendMessage` updates state via the
functional form (`setThreads(prev => ...)`), so a reply that resolves after the user has
navigated to a different agent's chat — or closed the modal entirely — still lands in the
correct thread, because the update targets `threads[agent.id]` directly rather than depending
on what's currently rendered.

The `sendLive()` polling helper (currently the top of `agent-chat.tsx`) moves into this hook —
the code that owns the state performing an async update is what should run the async work
producing it, not a view component that might not be mounted when the work finishes.

`SupportTeamPage` calls `useAgentChats(env)` once and passes each agent's `thread` plus the
hook's `sendMessage` down to whichever chat is currently open.

### 2. `AgentChat` becomes presentational

Its props change from owning `agent`/`env`/`onClose` (with internal `msgs`/`loading` state) to:

```ts
{ agent: Agent; env: "dev" | "pro"; thread: ChatThread; onSend: (text: string) => void; onClose: () => void }
```

It still owns the currently-typed-but-unsent draft (`input`) as local state — that's not part
of the bug (nothing bleeds or gets lost from a draft resetting on switch), and lifting it too
would be scope creep for no behavioral benefit. Everything else it renders (`msgs`, `loading`,
the banner, the "thinking"/"working" bubble) now reads from `thread` instead of local state.

### 3. `SupportTeamPage`'s "Chat with X" buttons get selection + in-flight indicators

- The currently-open agent's button gets a selected-state highlight, using the same visual
  pattern already established by the page's own Office/Cards/Board view toggle
  (`bg-white/[0.08] text-[var(--text)]` vs. the unselected style).
- Any agent whose `thread.loading` is `true` — regardless of whether its chat is the one
  currently open — gets a small pulsing dot on its button, so a reply still in flight is visible
  at a glance without having to reopen that agent's chat to check.

## What does NOT change

- No backend/API changes — `POST /api/support-team/[env]/chat`, `GET /api/hermes/requests/:id`,
  and the bridge are all already correctly stateless-per-request and support genuine
  concurrency; this was verified conceptually true even before this fix (the dispatch to Infra
  in the bug report above did reach the real Infra profile correctly).
- Still exactly one chat modal visible at a time (not simultaneous tiled windows) — confirmed
  as the desired UX; "parallel" means each agent's own conversation and in-flight status survive
  being backgrounded, not multiple panels on screen at once.
- No change to session naming, polling intervals, or the live/simulated branching logic itself.

## Verification approach

No backend change means no new live/production risk beyond the existing chat feature's — this
is client-side state management. Verification is `npx tsc` plus a description of the fix for the
user to confirm visually in the browser (the same category of check every prior chat-UI change
in this plan has needed, since there's no headless way to exercise React state transitions in
this environment). Specifically ask the user to reproduce the exact reported sequence — open
Coordinator, send a message, switch to Infra before it resolves, send Infra a message, switch
back to Coordinator — and confirm both threads now stay correctly separated and the selected/
in-flight indicators behave as designed.

## Out of scope

- Simultaneous multi-window/tiled chat display.
- Persisting chat threads across a full page reload (threads live in React state, reset on
  navigation away from the page — unchanged from today's behavior, just now correctly isolated
  per agent instead of shared).
- Any change related to the separately-diagnosed-and-fixed prod-specialist `config.yaml` gap
  (unrelated infra issue, already resolved directly on the host, not part of this repo).

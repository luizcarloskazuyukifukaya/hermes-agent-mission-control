# Chat Selection Clarity & Office-Tile Click-to-Chat — Design

Date: 2026-08-22

## Purpose

Follow-up polish after live-testing [2026-08-22-parallel-agent-chat-design.md](./2026-08-22-parallel-agent-chat-design.md)'s
fix: the fix itself works, but two usability gaps remain on `/support-dev` and `/support-pro`:

1. The "Chat with X" buttons' selected-state highlight (a subtle background tint added by the
   prior fix) isn't visually clear enough to tell which chat is currently open at a glance.
2. The Office view's agent desk tiles (the pixel-sprite rectangles — the default view, and the
   most literal "agent icon" on the page) have no click handler at all; opening a chat is only
   possible via the "Chat with X" button row below them.

## What changes

### 1. Clear selected-state indicator: thick green ring

Both button types — the team-role buttons (`teamAgents.map`) and the Coordinator's distinctly
accent-colored button — get `border: 2px solid var(--up)` (the app's existing green/success
color, already used for the live-chat banner and the "Online" stat) when that agent's chat is
the one currently open, replacing/augmenting the current subtle background-only tint. This
unifies the "selected" visual language across both button types rather than leaving the
Coordinator button's own accent-intensity scheme as the only cue there. The busy/in-flight
pulsing-dot indicator (added in the prior fix) is unchanged.

### 2. Office view desk tiles open chat on click

`SupportOfficeView` (`src/components/SupportOfficeView.tsx`) gains a new optional prop:

```ts
onSelectAgent?: (agent: Agent) => void
```

Threaded down into `AgentDesk`, which adds an `onClick` handler on the desk tile — only when
`agent` is defined (some desk slots can be empty/unassigned) — calling `onSelectAgent(agent)`,
plus `cursor-pointer` so the tile visibly reads as clickable (the tile already has a
`hover:scale-105` affordance from its existing styling). `SupportTeamPage` passes
`onSelectAgent={setChatAgent}` — the same state setter the "Chat with X" buttons already call,
so clicking a desk tile has the identical effect as clicking that agent's button. Both remain
available side by side; this is an additional entry point, not a replacement.

## What does NOT change

- Cards view stays as-is — its cards remain click-to-expand-details only, not click-to-chat
  (confirmed scope: this round is Office view only).
- No backend/API changes.
- The underlying per-agent chat-state fix (`useAgentChats`, selection tracking) from the prior
  increment is unchanged — this is purely two additional UI affordances layered on top of it.

## Verification approach

`npx tsc` plus a request for the user to visually confirm in the browser — same category as
every prior chat-UI change in this thread, since there's no headless way to exercise this in
the current environment. Specifically: open a chat via a "Chat with X" button and confirm the
thick green ring appears on it; click a different agent's Office-view desk tile and confirm
that opens their chat too (with the ring moving to reflect the new selection).

## Out of scope

- Cards-view avatar click-to-chat (deferred; only Office-view tiles this round, per operator
  decision).
- Any change to the pulsing-dot busy indicator, the underlying `useAgentChats` hook, or the
  backend dispatch pipeline.

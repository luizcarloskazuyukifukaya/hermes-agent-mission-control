# Chat Selection Clarity & Office-Tile Click-to-Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the currently-open chat clearly visible (thick green ring on the selected "Chat with X" button) and add a second way to open a chat: clicking an agent's Office-view desk tile directly.

**Architecture:** Two independent, small UI-only changes on top of the already-shipped `useAgentChats` per-agent chat-state fix. No backend/API changes, no new state — both changes reuse `chatAgent`/`setChatAgent`, which already exist in `SupportTeamPage`.

**Tech Stack:** Next.js 16 (App Router, TypeScript, client components).

## Global Constraints

- No test framework exists in this repo — verification is `npx tsc`, plus a final ask for the user to visually confirm in the browser.
- Cards view is unaffected — click-to-chat is Office view only this round.
- Design spec: `docs/superpowers/specs/2026-08-22-chat-selection-clarity-design.md`.

---

### Task 1: Thick green ring on the selected chat button

**Files:**
- Modify: `src/components/support-team-page.tsx`

**Interfaces:** None — purely visual, no new props or state.

- [ ] **Step 1: Team-role buttons**

Current (`src/components/support-team-page.tsx`):

```tsx
                <button key={a.id} onClick={() => setChatAgent(a)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] transition-colors panel-interactive ${
                    isOpen ? "bg-white/[0.08] text-[var(--text)]" : "text-[var(--text-2)]"
                  }`}
                  style={{ background: isOpen ? undefined : "var(--surface-1)", border: "1px solid var(--line)" }}>
```

Replace with:

```tsx
                <button key={a.id} onClick={() => setChatAgent(a)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] transition-colors panel-interactive ${
                    isOpen ? "bg-white/[0.08] text-[var(--text)]" : "text-[var(--text-2)]"
                  }`}
                  style={{
                    background: isOpen ? undefined : "var(--surface-1)",
                    border: isOpen ? "2px solid var(--up)" : "1px solid var(--line)",
                  }}>
```

- [ ] **Step 2: Coordinator button**

Current:

```tsx
              <button onClick={() => setChatAgent(leadAgent)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] transition-colors"
                style={{
                  color: "var(--accent)",
                  background: chatAgent?.id === leadAgent.id ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "color-mix(in srgb, var(--accent) 10%, transparent)",
                  border: `1px solid color-mix(in srgb, var(--accent) ${chatAgent?.id === leadAgent.id ? "45" : "28"}%, transparent)`,
                }}>
```

Replace with:

```tsx
              <button onClick={() => setChatAgent(leadAgent)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] transition-colors"
                style={{
                  color: "var(--accent)",
                  background: chatAgent?.id === leadAgent.id ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "color-mix(in srgb, var(--accent) 10%, transparent)",
                  border: chatAgent?.id === leadAgent.id ? "2px solid var(--up)" : "1px solid color-mix(in srgb, var(--accent) 28%, transparent)",
                }}>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/support-team-page.tsx
git commit -m "$(cat <<'EOF'
feat: show the selected chat with a thick green ring

The prior fix's selected-state background tint wasn't visually clear
enough. Both the team-role buttons and the Coordinator button now
get a 2px var(--up) border when that agent's chat is the one open,
unifying the selected indicator across both button styles.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 2: Click an Office-view desk tile to open that agent's chat

**Files:**
- Modify: `src/components/SupportOfficeView.tsx`
- Modify: `src/components/support-team-page.tsx`

**Interfaces:**
- Produces: `SupportOfficeView`'s new optional prop `onSelectAgent?: (agent: Agent) => void`, threaded into `AgentDesk`'s new optional prop `onSelect?: (agent: Agent) => void`.

- [ ] **Step 1: `AgentDesk` gets a click handler**

Current (`src/components/SupportOfficeView.tsx`):

```tsx
function AgentDesk({ agent, label, isLead }: { agent: Agent | undefined; label: string; isLead: boolean }) {
```

Replace with:

```tsx
function AgentDesk({ agent, label, isLead, onSelect }: { agent: Agent | undefined; label: string; isLead: boolean; onSelect?: (agent: Agent) => void }) {
```

Then find:

```tsx
      {/* Desk tile */}
      <div
        className={`relative rounded-2xl border overflow-visible transition-all duration-500
          ${isLead ? "w-44 h-44" : "w-36 h-36"}
          ${colors.bg} ${colors.glow}
          ${isOffline ? "opacity-40" : ""}
          hover:scale-105 hover:z-10`}
        style={isWorking ? { animation: "status-ring 1.5s infinite" } : undefined}
      >
```

Replace with:

```tsx
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
```

(The click handler is only attached when both `agent` is defined — an empty desk slot has nothing
to open a chat for — and `onSelect` was actually passed, so this component still renders safely
if some future caller doesn't provide it.)

- [ ] **Step 2: Thread `onSelectAgent` through `SupportOfficeView` to both `AgentDesk` calls**

Current:

```tsx
export default function SupportOfficeView({ agents, teamLabel }: { agents: Agent[]; teamLabel: string }) {
```

Replace with:

```tsx
export default function SupportOfficeView({ agents, teamLabel, onSelectAgent }: { agents: Agent[]; teamLabel: string; onSelectAgent?: (agent: Agent) => void }) {
```

Then find:

```tsx
          <AgentDesk agent={leadAgent} label="Incident Command" isLead={true} />
```

Replace with:

```tsx
          <AgentDesk agent={leadAgent} label="Incident Command" isLead={true} onSelect={onSelectAgent} />
```

Then find:

```tsx
            {teamDesks.map(desk => (
              <AgentDesk key={desk.agentId} agent={getAgent(desk.agentId)} label={desk.label} isLead={false} />
            ))}
```

Replace with:

```tsx
            {teamDesks.map(desk => (
              <AgentDesk key={desk.agentId} agent={getAgent(desk.agentId)} label={desk.label} isLead={false} onSelect={onSelectAgent} />
            ))}
```

- [ ] **Step 3: Pass `setChatAgent` in from `SupportTeamPage`**

Current (`src/components/support-team-page.tsx`):

```tsx
          <SupportOfficeView agents={agents} teamLabel={`${title} · Support Floor`} />
```

Replace with:

```tsx
          <SupportOfficeView agents={agents} teamLabel={`${title} · Support Floor`} onSelectAgent={setChatAgent} />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/SupportOfficeView.tsx src/components/support-team-page.tsx
git commit -m "$(cat <<'EOF'
feat: open an agent's chat by clicking their Office-view desk tile

Office view's agent tiles had no click handler at all — chat could
only be opened via the "Chat with X" button row below them. Desk
tiles are now a second entry point to the same chat, coexisting with
the existing buttons.

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

- [ ] **Step 3: Light regression check via curl**

This change is entirely client-side (styling + a click handler), so there's minimal backend risk,
but confirm the dispatch pipeline this UI sits on top of is unaffected by the deploy:

```bash
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "import json,sys; d=json.load(sys.stdin); print([e['value'] for e in d if not e.get('is_preview') and e['key']=='INTERNAL_API_SECRET'][0])")
curl -sS -X POST "https://dashboard.v-decent.org/api/support-team/dev/chat" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"role":"coordinator","message":"Quick check: reply with exactly CONFIRMED."}' | python3 -m json.tool
```

Poll the returned `requestId` via `GET /api/hermes/requests/{id}` (remember to include the
`x-internal-secret` header on the poll requests too) until `done`. Expected: a real reply.

- [ ] **Step 4: Ask the user to visually confirm in the browser**

Report to the user: deployed. Ask them to open `/support-dev` or `/support-pro`, click a "Chat
with X" button and confirm it now shows a clear thick green ring while open, then close that
chat and click a different agent's Office-view desk tile directly (not the button) and confirm
that opens their chat too, with the ring moving to the newly-selected button.

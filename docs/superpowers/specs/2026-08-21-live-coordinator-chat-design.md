# Live Chat with the V-Decent Support Coordinator (Dev) — Design

Date: 2026-08-21

## Purpose

The V-Decent Support Team pages (`/support-dev`, `/support-pro`, added in
[2026-08-20-vdecent-support-team-design.md](./2026-08-20-vdecent-support-team-design.md))
ship with a chat feature that is explicitly simulated — `/api/agent-chat` describes each
role via a canned system prompt and OpenRouter, with no access to real incident data or
tools, and declines to diagnose or act. That spec called out "wiring chat to anything
real" as an explicit non-goal, deferred to a follow-up.

This is that follow-up, scoped to a single role/environment first: make chat with the
**dev Coordinator** (`vdecent-dev-coordinator`) a real, live connection to the actual
Hermes agent — not a description of the role, but the role itself. Once validated, the
same mechanism extends to the other 9 profiles (4 remaining roles × 2 environments) by
adding roster entries, not by building new plumbing.

## Background: how the live agent is already reachable (verified live during design)

`hermes-dev-coordinator` runs as a persistent Docker container on `vdecentserver0`
(`hermes gateway run`, via `~/scripts/run-hermes-gateway.py`), with
`HERMES_HOME=/home/kfukaya/.hermes/profiles/vdecent-dev-coordinator` inside the
container — bind-mounted from the host path `/home/kfukaya/hermes-agent/data`. That
gateway process is what feeds the profile's messaging channels (e.g. Telegram, if
configured); it is not itself an HTTP API this dashboard can call.

The `hermes-bridge` container (this repo's `hermes-bridge/bridge.mjs`) already bind-mounts
that same host directory (`/home/kfukaya/hermes-agent/data:/opt/data`, `HERMES_HOME=/opt/data`)
to run the default profile's oneshot/chat/kanban/cron work via the `hermes` CLI. Since
`/opt/data/profiles/vdecent-dev-coordinator` is the same directory the coordinator's own
container uses as its home, **no new volume, container, or credential is needed** — running
a oneshot prompt with `HERMES_HOME` pointed at that subdirectory instead of the default
runs it *as* the dev coordinator, using its already-working config/auth (its gateway
container is up and healthy today).

`hermes --help` confirms the relevant flags:
- `-z PROMPT` / `--oneshot PROMPT` — one-shot mode, prints only the final response text;
  approvals are auto-bypassed (already true for today's default-profile chat/dispatch —
  not a new risk category introduced by this feature).
- `--continue [SESSION_NAME]` / `-c` — resume a named session, or start it if it doesn't
  exist yet.

## Scope for this increment

Live chat ships for **`coordinator` × `dev` only**. All other 9 profiles (apps/edge/infra/
verifier × dev/prod, and the prod coordinator) keep using the existing simulated
`/api/agent-chat` path. The profile-directory naming convention already established by the
support-team feature (`vdecent-{dev,prod}-{role}`) is reused as-is, so extending later is
adding roster entries, not new plumbing.

Per design-time decisions: this is a **full live agent** (it can dispatch kanban tasks,
delegate to other roles, etc. — the same "oneshot bypasses Hermes's own per-tool approval
prompts" behavior the default profile's chat/dispatch already has), and each open chat
window keeps **real multi-turn memory** via a persistent named Hermes session, reused every
time that chat is reopened (not reset per session, not one-shot-per-message).

## Data model

Add one nullable column to `AgentRequest` (`prisma/schema.prisma`):

```prisma
model AgentRequest {
  ...
  profile String?   // e.g. "vdecent-dev-coordinator"; null = default profile (unchanged today)
  ...
}
```

No migration file — this repo runs `prisma db push` on every boot (`docker-entrypoint.sh`),
so this ships as a normal schema edit.

## Backend

### New route: `POST /api/support-team/[env]/chat`

Body: `{ role: string, message: string }`.

- Validates `env` (`dev`|`pro`) and `role` against the known 5-role roster.
- Builds `profile = "vdecent-{dev|prod}-{role}"`.
- Creates an `AgentRequest`: `kind: "chat"`, `title`/`prompt` from `message` (existing
  200-char title truncation), `profile`, `sideEffecting: false` → status `queued`
  immediately (no approval gate — matches today's chat/oneshot behavior; the dashboard's
  `AgentRequest` approval gate is orthogonal to what the agent's own tools can do, same as
  it already is for the default profile).
- Returns `{ requestId }`.

### Polling: `GET /api/hermes/requests/[id]`

`src/app/api/hermes/requests/[id]/route.ts` currently only exports `PATCH`. Add a `GET`
handler returning that single row (id, status, result, error, createdAt, finishedAt), so
the frontend can poll one request's progress instead of re-fetching the whole recent list.

### Bridge: `hermes-bridge/bridge.mjs`, `runRequest()`

For `kind === "chat"` requests carrying a non-null `profile`, exec with an overridden
`HERMES_HOME` and the continue flag instead of the current unconditional
`hermes(["-z", r.prompt || r.title])`:

```js
const profileHome = r.profile
  ? path.join(process.env.HERMES_HOME || path.join(os.homedir(), ".hermes"), "profiles", r.profile)
  : null;
const args = profileHome
  ? ["-z", r.prompt || r.title, "--continue", `dashboard-${r.profile}`]
  : ["-z", r.prompt || r.title];
const result = (await hermes(args, {
  timeout: RUN_TIMEOUT_MS,
  ...(profileHome ? { env: { ...process.env, HERMES_HOME: profileHome } } : {}),
})).trim();
```

`execFileP`'s call site (the `hermes()` helper) needs an `env` option threaded through to
`execFile`'s options. Everything else in `runRequest` — status transitions, `AgentEvent`
emission on start/done/fail, the existing timeout — is unchanged. Requests with no
`profile` (every existing use of `AgentRequest` today) behave exactly as they do now.

### Roster route: `src/app/api/support-team/[env]/route.ts`

Add a `live: boolean` field to each role in the static roster, `true` only for
`{ env: "dev", role: "coordinator" }` this increment, `false` for the other 9. This field
is the single toggle point for extending live chat to more profiles later — flip it, no
other code changes required for that role to go live (assuming its profile directory
already exists on the host, which all 10 already do).

## Frontend

### `src/components/agent-chat.tsx`

Branches on `agent.live`:

- **Live (`agent.live === true`):**
  1. Needs an `env` prop (passed down from `support-team-page.tsx`) to know which
     `/api/support-team/${env}/chat` to hit.
  2. `send()` POSTs `{ role: agent.id, message }`, gets back `{ requestId }`.
  3. Polls `GET /api/hermes/requests/${requestId}` every 2s (same interval
     `HermesDispatches` already uses) until `status` is `done` or `failed`.
  4. Appends `result` (or a friendly message derived from `error` on failure) as the
     assistant turn. `loading` stays true for the entire wait — the input stays disabled
     and the existing "thinking…" bubble covers what can be a multi-minute wait (the
     bridge's run timeout is 240s); copy should set that expectation, e.g. "the
     coordinator can take a couple of minutes on real diagnostic work."
  5. Client does **not** send a `history` array — conversational continuity lives
     server-side in the named Hermes session (`--continue`), not in the browser.
  6. The "Simulated — not the live agent" banner is replaced with a distinctly-styled
     "Live — connected to hermes-dev-coordinator" banner.
- **Simulated (`agent.live` falsy — the other 9 profiles):** unchanged, same synchronous
  `/api/agent-chat` call as today.

### `src/components/support-team-page.tsx`

Passes `env` through to every `<AgentChat agent={...} env={env} onClose={...} />` call
site (the office-view quick-launch strip and the cards-view launch).

No changes to `TaskBoard`, `SupportOfficeView`, or the roster's visual layout — this is
entirely inside the chat modal.

## Safety considerations (documented, not new — inherent to the approved mechanism)

- `hermes -z` auto-bypasses Hermes's own per-tool approval prompts. A chat message
  phrased as an instruction ("restart the app", "roll back the deploy") can cause the
  coordinator to actually delegate/dispatch real incident work. This is the intended
  behavior of "full live agent," not a bug, but worth stating plainly so it isn't a
  surprise the first time it happens.
- The dashboard's own `AgentRequest` approval gate (`sideEffecting` + Approval Inbox)
  does not apply to chat messages, matching today's default-profile chat. The only
  guardrail on what the coordinator will actually do is its own `SOUL.md`/tool
  configuration on the Hermes side, which this feature doesn't touch or need to.
- Two chat messages to the same profile processed concurrently (e.g. a rapid double-send)
  could race on the same named session. Mitigated in practice by the existing UI behavior
  of disabling input while `loading` is true — no additional server-side locking is added
  in this increment.
- If `hermes-bridge` restarts, the named session is unaffected — it lives in the mounted
  profile home on disk, not in bridge process memory. Reopening the chat later continues
  where it left off.

## Out of scope for this increment

- The other 8 profiles (apps/edge/infra/verifier × dev/prod) and the prod coordinator —
  stay simulated until this is validated, then extended by adding roster (`live: true`)
  entries.
- A "reset conversation" control for the named session — it grows indefinitely for now.
- Streaming responses — the UI polls to completion; no token-by-token streaming.
- Any change to Hermes-level (CLI-side) approval or tool restrictions — those remain fully
  owned by the coordinator's own profile configuration, not this dashboard.
- Concurrency locking beyond the existing UI-level "disable while loading."

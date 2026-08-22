# Live Chat Rollout to All V-Decent Support Team Profiles — Design

Date: 2026-08-22

## Purpose

[2026-08-21-live-coordinator-chat-design.md](./2026-08-21-live-coordinator-chat-design.md) wired
live chat for exactly one profile — `coordinator × dev` — as a first increment, deliberately
scoped so the mechanism (`AgentRequest.profile` → `hermes-bridge` execs the `hermes` CLI with
`HERMES_HOME` pointed at that profile's directory, plus `--continue` for a persistent named
session) could be proven before extending it. It has since been deployed, functionally verified
live (a real reply, real session continuity across messages, and a regression check that the
default profile's existing oneshot/chat is unaffected), and a follow-up whole-branch review
closed out both Important findings it raised — including making `LIVE_PROFILES` an actual
server-side gate (`src/lib/live-profiles.ts`), not just a UI toggle.

This is the planned second increment: extend live chat to the remaining 9 profiles — the other
4 dev roles (apps/edge/infra/verifier) and all 5 prod roles (coordinator/apps/edge/infra/
verifier) — all at once, per operator decision, rather than staging dev-then-prod. The
mechanism itself needs no new plumbing; every piece (the chat route, the roster route, the
bridge's profile-targeted exec, the polling frontend) was already built generic across all 10
profiles in the first increment. `LIVE_PROFILES` was always the intended single toggle point
for this.

## What changes

### 1. Widen `LIVE_PROFILES`

`src/lib/live-profiles.ts` currently exports:

```ts
export const LIVE_PROFILES = new Set<string>(["dev-coordinator"]);
```

Becomes all 10 role×env combinations:

```ts
export const LIVE_PROFILES = new Set<string>([
  "dev-coordinator", "dev-apps", "dev-edge", "dev-infra", "dev-verifier",
  "pro-coordinator", "pro-apps", "pro-edge", "pro-infra", "pro-verifier",
]);
```

(Keys use the route's own `env` values — `"dev"`/`"pro"` — matching the existing convention
already established by the one live entry; this is not the `"prod"`-remapped profile string,
which is a separate concern below.)

No other change is needed in the roster route (`src/app/api/support-team/[env]/route.ts`) or
the chat route (`src/app/api/support-team/[env]/chat/route.ts`) — both already consult
`LIVE_PROFILES` generically for any role/env pair; they were never hardcoded to the coordinator.

### 2. Fix the banner's profile-name mismatch (promoted from a logged Minor finding)

The final review of the first increment logged this as Minor #4, deferred because only the dev
coordinator was live at the time and its `env`-to-profile mapping happened to be a no-op
(`"dev"` → `"dev"`). It stops being a no-op the moment any `pro` role goes live, so it's fixed
as part of this increment rather than staying deferred.

**The bug:** the chat modal's banner (`src/components/agent-chat.tsx:105`) renders
`` `Live — connected to hermes-${env}-${agent.id}` ``, using the raw route param `env`
(`"dev"|"pro"`) directly. But the actual Hermes profile string, built in the chat route
(`src/app/api/support-team/[env]/chat/route.ts:30`), remaps `"pro"` to `"prod"`:
`` `vdecent-${env === "dev" ? "dev" : "prod"}-${role}` ``. So a live chat with any prod role
would show a banner reading "hermes-pro-coordinator" — a profile that does not exist on disk —
instead of the real "hermes-prod-coordinator".

**The fix:** add a shared `profileId(env, role)` helper to `src/lib/live-profiles.ts`,
exporting the exact mapping logic currently duplicated inline in the chat route:

```ts
export function profileId(env: "dev" | "pro", role: string): string {
  return `vdecent-${env === "dev" ? "dev" : "prod"}-${role}`;
}
```

The chat route's `POST` handler calls `profileId(env, role)` instead of its own inline template
literal. The banner in `agent-chat.tsx` calls
`` `Live — connected to hermes-${profileId(env, agent.id).replace(/^vdecent-/, "")}` `` (or
equivalently strips the `vdecent-` prefix some other clear way) instead of interpolating `env`
directly. Both call sites now derive the profile name from one place, so they cannot drift
again — the exact structural fix the first increment's review recommended.

## What does NOT change

- The bridge (`hermes-bridge/bridge.mjs`), the polling mechanism, the `AgentRequest` schema,
  the `GET /api/hermes/requests/:id` route — none of this is profile-count-aware; it already
  works identically for any of the 10 profiles. Nothing here needs to change to support more
  profiles going live.
- Session naming (`dashboard-<profile>`, one persistent session per role×env, reused every time
  that chat is reopened) — same pattern, now just exercised for 10 profiles instead of 1.
- No additional confirmation step, rate limit, or extra approval gate for prod roles beyond what
  already exists (per operator decision: same mechanism uniformly, no staged rollout). The
  existing safety posture — `hermes -z` bypasses Hermes's own per-tool approval prompts, and the
  dashboard's `AgentRequest` approval gate doesn't apply to chat — was already accepted for the
  dev coordinator in the first increment's design and applies identically to all 10 profiles now.

## Verification approach

Not all 9 newly-live profiles need an individual live functional smoke test — the mechanism has
already been proven generic (the first increment's implementation never special-cased the
coordinator; `LIVE_PROFILES` was always the only per-profile distinction). Live verification
after deploy is a spot check, not an exhaustive sweep:

- One additional dev role (e.g. `apps`) — confirms a non-coordinator role works.
- The prod coordinator specifically — highest-stakes profile (a real persistent daemon
  coordinating production incidents), worth confirming directly rather than by inference.
- A regression check that the existing dev-coordinator chat still works unchanged.
- The banner-naming fix verified directly: dispatch to a prod role and confirm the request
  actually reaches `vdecent-prod-<role>` (not `vdecent-pro-<role>`, which doesn't exist and
  would fail).

## Out of scope

- Any change to the bridge's serial queue processing, session lifecycle, or timeout handling —
  unrelated to profile count, already reviewed and fixed in the first increment.
- Custom per-role prompts, tool restrictions, or behavior changes on the Hermes side — entirely
  owned by each profile's own `SOUL.md`/config, not this dashboard.
- A "reset conversation" control, streaming responses, or concurrency locking beyond the
  existing UI-level "disable while loading" — same deferrals as the first increment, still
  deferred.

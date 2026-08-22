// Single toggle point for going live with more Hermes profiles later:
// "{env}-{roleId}" — consulted by both the roster route (sets Agent.live
// for the UI) and the chat route (enforces it server-side).
export const LIVE_PROFILES = new Set<string>([
  "dev-coordinator", "dev-apps", "dev-edge", "dev-infra", "dev-verifier",
  "pro-coordinator", "pro-apps", "pro-edge", "pro-infra", "pro-verifier",
]);

// The real Hermes profile directory name for a given role/env pair. `env`
// here is the route param's "dev"|"pro"; the actual profile on disk uses
// "prod", not "pro", for the production environment — this is the one
// place that remap happens, so callers (the chat route, the chat modal's
// banner) never have to duplicate it.
export function profileId(env: "dev" | "pro", role: string): string {
  return `vdecent-${env === "dev" ? "dev" : "prod"}-${role}`;
}

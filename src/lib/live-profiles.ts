// Single toggle point for going live with more Hermes profiles later:
// "{env}-{roleId}" — consulted by both the roster route (sets Agent.live
// for the UI) and the chat route (enforces it server-side).
export const LIVE_PROFILES = new Set<string>(["dev-coordinator"]);

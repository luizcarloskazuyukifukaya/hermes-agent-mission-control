# Collapsible Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fold/unfold toggle to the desktop sidebar so it can collapse to an icon-only
rail, giving the main content area (notably the kanban `TaskBoard`) more horizontal space.

**Architecture:** Single-file change to `src/components/sidebar.tsx`. A new `collapsed`
boolean state (persisted to `localStorage`), read after mount to avoid hydration mismatch,
conditionally narrows the desktop `<aside>` width and hides text/labels while keeping icons
and tooltips. `ConditionalLayout`'s flex layout already reflows `main` automatically — no
changes needed there.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Tailwind utility classes,
`lucide-react` icons (`ChevronsLeft`, `ChevronsRight` — confirmed present in
`node_modules/lucide-react`).

## Global Constraints

- Desktop only (`md:` breakpoint and up). Mobile's existing hamburger/overlay/bottom-tab-bar
  behavior must not change at all.
- Collapsed width: `md:w-[4.5rem]`. Expanded width: `md:w-[15rem]` (unchanged from today).
- `localStorage` key: `"sidebar-collapsed"`, values `"true"` / `"false"` (string, not JSON).
- Default (no stored value, or any value other than `"true"`) is expanded — must match
  today's behavior exactly for first-time visitors.
- No test suite exists in this repo (confirmed in prior sessions — no `test` script in
  `package.json`). Verification is `npx tsc` (type check) plus manual visual confirmation
  after deploy.
- This repo's working convention this session: commit with a clear subject + body, trailers
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW`.

---

### Task 1: Add collapsed state and icon-rail rendering to Sidebar

**Files:**
- Modify: `src/components/sidebar.tsx` (full file shown below with all changes applied —
  use this as the target end-state, not a diff)

**Interfaces:**
- Consumes: nothing new from outside this file. `navGroups` shape and `ConditionalLayout`'s
  flex-row parent are unchanged.
- Produces: nothing consumed elsewhere — this is a self-contained UI change.

**Current file content (for reference — this is what exists before your edit):**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  Home,
  Radio,
  ShieldAlert,
  Lightbulb,
  ClipboardList,
  Cpu,
  BookOpen,
  GitBranch,
  Server,
  Menu,
  X,
} from "lucide-react";

const navGroups = [
  {
    name: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: Home },
      { href: "/hermes", label: "Hermes", icon: Cpu },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
    ],
  },
  {
    name: "Data",
    items: [
      { href: "/vdecent-dev", label: "V-Decent Dev", icon: GitBranch },
      { href: "/vdecent-pro", label: "V-Decent Pro", icon: Server },
    ],
  },
  {
    name: "System",
    items: [
      { href: "/support-dev", label: "Support · Dev", icon: Radio },
      { href: "/support-pro", label: "Support · Pro", icon: ShieldAlert },
      { href: "/memory-wiki", label: "Memory Wiki", icon: BookOpen },
      { href: "/ideas", label: "Ideas", icon: Lightbulb },
    ],
  },
];

// Mobile tab bar - only show the most important
const mobileTabsRaw = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/support-dev", label: "Support", icon: Radio },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  // Close sidebar when resizing to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setIsOpen(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const Logo = () => (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-[10px] bg-[var(--text)] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
        <span className="text-[#0a0b0d] font-bold text-[13px] tracking-tight">H</span>
      </div>
      <span className="font-semibold text-[var(--text)] tracking-[-0.01em] text-[15px]">Hermy HQ</span>
    </div>
  );

  return (
    <>
      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-[var(--bg)]/90 backdrop-blur-xl border-b border-[var(--line)] px-4 py-3 flex items-center justify-between">
        <Logo />
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 text-[var(--text-2)] hover:text-[var(--text)] transition-colors rounded-lg hover:bg-[var(--surface-1)]"
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg)]/90 backdrop-blur-xl border-t border-[var(--line)] px-2 py-2 safe-area-pb">
        <nav className="flex justify-around">
          {mobileTabsRaw.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 p-2 px-3 rounded-lg transition-all ${
                  isActive
                    ? "text-[var(--text)] bg-[var(--surface-2)]"
                    : "text-[var(--text-3)] hover:text-[var(--text-2)] active:scale-95"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Desktop Sidebar */}
      <aside
        className={`
          fixed md:relative z-50 md:z-10
          w-64 md:w-[15rem] h-full
          bg-[var(--bg)] md:bg-transparent border-r border-[var(--line)]
          flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          top-0 left-0
        `}
      >
        {/* Logo */}
        <div className="hidden md:block px-5 pt-6 pb-8">
          <Logo />
        </div>

        {/* Spacer for mobile header */}
        <div className="h-16 md:hidden" />

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto">
          <div className="space-y-5">
            {navGroups.map((group) => (
              <div key={group.name}>
                <h3 className="eyebrow px-3 mb-1.5 !text-[10px] !text-[var(--text-4)]">
                  {group.name}
                </h3>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive =
                      pathname === item.href || pathname.startsWith(item.href + "/");
                    const Icon = item.icon;
                    return (
                      <div key={item.href}>
                        <Link
                          href={item.href}
                          className={`group relative flex items-center gap-3 px-3 py-[7px] rounded-[10px] transition-all duration-150 ${
                            isActive
                              ? "bg-[var(--surface-2)] text-[var(--text)]"
                              : "text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-1)]"
                          }`}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-[var(--accent)]" />
                          )}
                          <Icon
                            className={`w-[17px] h-[17px] shrink-0 ${
                              isActive ? "text-[var(--text)]" : "text-[var(--text-3)] group-hover:text-[var(--text-2)]"
                            }`}
                          />
                          <span className="text-[13.5px] font-medium">{item.label}</span>
                        </Link>
                        {"anchors" in group &&
                          isActive &&
                          (group as { anchors?: { href: string; label: string }[] }).anchors && (
                            <div className="ml-[26px] mt-0.5 space-y-0.5 border-l border-[var(--line)] pl-3">
                              {(group as { anchors: { href: string; label: string }[] }).anchors.map(
                                (a) => (
                                  <a
                                    key={a.href}
                                    href={a.href}
                                    className="block text-[12px] text-[var(--text-3)] hover:text-[var(--text-2)] py-1 transition-colors"
                                  >
                                    {a.label}
                                  </a>
                                )
                              )}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-[var(--line)]">
          <div className="flex items-center gap-2 text-[var(--text-3)] text-[11.5px]">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--up)] opacity-60 animate-ping" />
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[var(--up)]" />
            </span>
            <span>All systems online</span>
          </div>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 1: Replace the full file with the target end-state below**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  Home,
  Radio,
  ShieldAlert,
  Lightbulb,
  ClipboardList,
  Cpu,
  BookOpen,
  GitBranch,
  Server,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

const navGroups = [
  {
    name: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: Home },
      { href: "/hermes", label: "Hermes", icon: Cpu },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
    ],
  },
  {
    name: "Data",
    items: [
      { href: "/vdecent-dev", label: "V-Decent Dev", icon: GitBranch },
      { href: "/vdecent-pro", label: "V-Decent Pro", icon: Server },
    ],
  },
  {
    name: "System",
    items: [
      { href: "/support-dev", label: "Support · Dev", icon: Radio },
      { href: "/support-pro", label: "Support · Pro", icon: ShieldAlert },
      { href: "/memory-wiki", label: "Memory Wiki", icon: BookOpen },
      { href: "/ideas", label: "Ideas", icon: Lightbulb },
    ],
  },
];

// Mobile tab bar - only show the most important
const mobileTabsRaw = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/support-dev", label: "Support", icon: Radio },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Read persisted collapsed state after mount (avoids hydration mismatch —
  // server/first paint always assumes expanded).
  useEffect(() => {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true") {
      setCollapsed(true);
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  // Close sidebar on route change (mobile)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  // Close sidebar when resizing to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setIsOpen(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const Logo = () => (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-[10px] bg-[var(--text)] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] shrink-0">
        <span className="text-[#0a0b0d] font-bold text-[13px] tracking-tight">H</span>
      </div>
      <span className="font-semibold text-[var(--text)] tracking-[-0.01em] text-[15px]">Hermy HQ</span>
    </div>
  );

  return (
    <>
      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-[var(--bg)]/90 backdrop-blur-xl border-b border-[var(--line)] px-4 py-3 flex items-center justify-between">
        <Logo />
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 text-[var(--text-2)] hover:text-[var(--text)] transition-colors rounded-lg hover:bg-[var(--surface-1)]"
          aria-label="Toggle menu"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg)]/90 backdrop-blur-xl border-t border-[var(--line)] px-2 py-2 safe-area-pb">
        <nav className="flex justify-around">
          {mobileTabsRaw.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 p-2 px-3 rounded-lg transition-all ${
                  isActive
                    ? "text-[var(--text)] bg-[var(--surface-2)]"
                    : "text-[var(--text-3)] hover:text-[var(--text-2)] active:scale-95"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Desktop Sidebar */}
      <aside
        className={`
          fixed md:relative z-50 md:z-10
          w-64 h-full
          ${collapsed ? "md:w-[4.5rem]" : "md:w-[15rem]"}
          bg-[var(--bg)] md:bg-transparent border-r border-[var(--line)]
          flex flex-col
          transition-[transform,width] duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          top-0 left-0
        `}
      >
        {/* Logo + collapse toggle */}
        <div className="hidden md:flex items-center justify-between px-5 pt-6 pb-8">
          {collapsed ? (
            <button
              onClick={toggleCollapsed}
              className="flex flex-col items-center gap-2 text-[var(--text-3)] hover:text-[var(--text)] transition-colors"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <div className="w-8 h-8 rounded-[10px] bg-[var(--text)] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
                <span className="text-[#0a0b0d] font-bold text-[13px] tracking-tight">H</span>
              </div>
              <ChevronsRight className="w-4 h-4" />
            </button>
          ) : (
            <>
              <Logo />
              <button
                onClick={toggleCollapsed}
                className="p-1.5 text-[var(--text-3)] hover:text-[var(--text)] transition-colors rounded-lg hover:bg-[var(--surface-1)]"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Spacer for mobile header */}
        <div className="h-16 md:hidden" />

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto">
          <div className="space-y-5">
            {navGroups.map((group) => (
              <div key={group.name}>
                {!collapsed && (
                  <h3 className="eyebrow px-3 mb-1.5 !text-[10px] !text-[var(--text-4)]">
                    {group.name}
                  </h3>
                )}
                {collapsed && (
                  <div className="mx-3 mb-1.5 border-t border-[var(--line)] md:block hidden" />
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive =
                      pathname === item.href || pathname.startsWith(item.href + "/");
                    const Icon = item.icon;
                    return (
                      <div key={item.href}>
                        <Link
                          href={item.href}
                          title={collapsed ? item.label : undefined}
                          className={`group relative flex items-center gap-3 px-3 py-[7px] rounded-[10px] transition-all duration-150 ${
                            collapsed ? "md:justify-center" : ""
                          } ${
                            isActive
                              ? "bg-[var(--surface-2)] text-[var(--text)]"
                              : "text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-1)]"
                          }`}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-[var(--accent)]" />
                          )}
                          <Icon
                            className={`w-[17px] h-[17px] shrink-0 ${
                              isActive ? "text-[var(--text)]" : "text-[var(--text-3)] group-hover:text-[var(--text-2)]"
                            }`}
                          />
                          {!collapsed && (
                            <span className="text-[13.5px] font-medium">{item.label}</span>
                          )}
                        </Link>
                        {!collapsed &&
                          "anchors" in group &&
                          isActive &&
                          (group as { anchors?: { href: string; label: string }[] }).anchors && (
                            <div className="ml-[26px] mt-0.5 space-y-0.5 border-l border-[var(--line)] pl-3">
                              {(group as { anchors: { href: string; label: string }[] }).anchors.map(
                                (a) => (
                                  <a
                                    key={a.href}
                                    href={a.href}
                                    className="block text-[12px] text-[var(--text-3)] hover:text-[var(--text-2)] py-1 transition-colors"
                                  >
                                    {a.label}
                                  </a>
                                )
                              )}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className={`px-4 py-4 border-t border-[var(--line)] ${collapsed ? "md:flex md:justify-center" : ""}`}>
          <div className="flex items-center gap-2 text-[var(--text-3)] text-[11.5px]">
            <span className="relative flex w-1.5 h-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--up)] opacity-60 animate-ping" />
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[var(--up)]" />
            </span>
            {!collapsed && <span>All systems online</span>}
          </div>
        </div>
      </aside>
    </>
  );
}
```

Notes on the changes from the current file, so you understand what each piece is for:
- `SIDEBAR_COLLAPSED_KEY` constant holds the exact localStorage key `"sidebar-collapsed"`.
- `collapsed` state defaults to `false`; a `useEffect` on mount reads localStorage and flips
  it to `true` only if the stored value is exactly `"true"` — this runs client-side only
  (component is already `"use client"`), so there's no SSR/hydration mismatch: first paint on
  every load (including server-rendered) is the expanded layout, then it may immediately
  switch to collapsed on the client if that was the stored preference.
- `toggleCollapsed` flips state and writes the new boolean (via `String(next)`) back to
  localStorage in the same call.
- The mobile header's `Logo` usage and the mobile bottom tab bar are **completely unchanged**
  — `collapsed` only affects the desktop `<aside>` markup below the mobile-only pieces.
  `w-64` (the mobile overlay width) is unconditional; only the `md:w-[...]` class is
  conditional on `collapsed`.
  - Note: `w-64` (16rem) and `md:w-[15rem]` differ slightly (mobile overlay historically used
    a slightly different width than desktop) — this plan does not change that pre-existing
    discrepancy, only adds the `md:w-[4.5rem]` collapsed variant.
- The logo row becomes a flex row with `justify-between` so the toggle button can sit at the
  far right when expanded; when collapsed, the row instead shows a small vertical stack (logo
  mark, then the expand chevron) since there's no room for a side-by-side layout at 4.5rem.
- Group headers (`eyebrow` labels) are only rendered when `!collapsed`; a plain divider line
  replaces them when collapsed, for visual separation between groups.
- Each nav `Link` gets `title={collapsed ? item.label : undefined}` so hovering a collapsed
  icon shows a native browser tooltip with the page name.
- `anchors` sub-navigation rendering is gated on `!collapsed` (in addition to its existing
  `isActive` gate) — per the spec, sub-nav is hidden while collapsed since no group currently
  defines `anchors`, this has no visible runtime effect today but keeps the code path correct.
- Footer text ("All systems online") is only rendered when `!collapsed`; the status dot
  always renders and gets `shrink-0` added so it doesn't get squeezed in the narrower rail.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (this repo has no separate test suite; `tsc` is the verification gate
used throughout this session for TypeScript changes).

- [ ] **Step 3: Manual visual check with the dev server**

Run: `npm run dev` (or confirm it's already running), then in a browser:
1. Load any page at desktop width (≥768px) — sidebar should look exactly as it does today
   (expanded, `«` chevron visible next to the logo).
2. Click the `«` chevron — sidebar should narrow to the icon rail, group header text and nav
   labels should disappear, footer text should disappear, a `»` chevron should appear under
   the logo mark.
3. Hover over a collapsed nav icon — a tooltip with its label should appear.
4. Click a collapsed nav icon — navigation should still work.
5. Reload the page — the sidebar should still be collapsed (persisted).
6. Click `»` to expand again, reload — should stay expanded (persisted).
7. Shrink the browser to mobile width (<768px) — hamburger header and bottom tab bar should
   look and behave exactly as before, regardless of the desktop `collapsed` state.

Stop and fix before proceeding if any of these deviate.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "$(cat <<'EOF'
feat: add collapsible desktop sidebar

Fold the sidebar to an icon-only rail so wide layouts (e.g. the kanban
TaskBoard) get more horizontal room. State persists in localStorage.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SkigbpXhMNXWQPJCYN7qdW
EOF
)"
```

---

### Task 2: Deploy and verify live

**Files:** none (deployment/verification only).

- [ ] **Step 1: Push to origin/main**

```bash
git push origin main
```

- [ ] **Step 2: Trigger Coolify redeploy**

```bash
source ~/.bashrc
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" \
  "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

Note the returned `deployment_uuid`.

- [ ] **Step 3: Poll until finished**

```bash
source ~/.bashrc
curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" \
  "https://coolify.v-decent.org/api/v1/deployments/<deployment_uuid>"
```

Expected: `status` eventually becomes `"finished"`. If the build fails with a
`Could not resolve host: github.com` error during git clone, this is a known recurring
transient DNS blip in this environment (not a code issue) — retry the deploy trigger once.

- [ ] **Step 4: Verify live**

Since this is a purely client-rendered UI change with no API-observable signal, verification
is visual: report to the user that the deploy is live and ask them to check the new fold
toggle on `dashboard.v-decent.org` (e.g. try it on `/support-dev`'s Board view, the original
motivating case).

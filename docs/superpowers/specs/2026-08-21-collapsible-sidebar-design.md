# Collapsible Sidebar — Design

Date: 2026-08-21

## Purpose

Let the operator fold the desktop sidebar down to an icon-only rail so the main content area
(especially wide layouts like the kanban `TaskBoard`, where columns like Blocked/Done get
squeezed) gets significantly more horizontal room. Motivating case: viewing `/support-dev`'s
or `/support-pro`'s Board view with all kanban columns visible side by side.

## Scope

Desktop only (`md:` breakpoint and above). Mobile already collapses the sidebar into a
hamburger overlay + bottom tab bar by default — that behavior is unrelated and untouched by
this feature.

## State

`Sidebar` (`src/components/sidebar.tsx`) gains a new `collapsed` boolean, alongside the
existing `isOpen` (mobile overlay) state:

- On mount, read `localStorage.getItem("sidebar-collapsed")`. `"true"` → `collapsed = true`;
  anything else (including missing key, first-ever visit) → `collapsed = false`.
- Toggling calls `setCollapsed` and writes the new value to `localStorage` as `"true"` /
  `"false"` in the same handler.
- Reading `localStorage` only happens client-side (this component is already `"use client"`),
  inside a `useEffect` so the initial server-rendered/first-paint markup matches the default
  (`false`) and there's no hydration mismatch — the collapsed layout applies on the client
  render right after mount.

## Layout mechanics

`ConditionalLayout` (`src/components/conditional-layout.tsx`) already renders `Sidebar` and
`<main>` as siblings in a `flex h-screen` row, with `main` at `flex-1`. No changes needed
there — shrinking the sidebar's width alone gives `main` the extra space automatically.

Desktop `<aside>` width becomes conditional:
- Expanded (current): `md:w-[15rem]`
- Collapsed: `md:w-[4.5rem]`

Both transition via the same `transition-transform duration-300 ease-in-out` class already
present, extended to also transition `width`.

## Collapsed appearance

- **Logo row:** the "H" mark square stays; the "Hermy HQ" text label is hidden (conditionally
  not rendered, not just visually hidden, to avoid layout ghosting).
- **Group headers:** the eyebrow labels ("OVERVIEW", "DATA", "SYSTEM") are hidden. A thin
  divider (reusing `--line`) replaces each header's vertical space so groups stay visually
  separated.
- **Nav items:** icon-only, horizontally centered in the rail. The active-item accent bar
  (left edge) and hover background remain exactly as today. Each link gets a native
  `title={item.label}` attribute so hovering shows a browser tooltip with the page name —
  the only affordance for the now-hidden text.
- **Footer:** the status dot stays; the "All systems online" text is hidden, dot remains
  centered.
- Anchors (the `"anchors" in group` sub-links block, currently only used if a group defines
  `anchors`) are hidden entirely while collapsed — sub-navigation requires expanding first.
  (No group currently defines `anchors`, so this has no visible effect today; noted for
  completeness since the code path exists.)

## Toggle button

A small chevron button next to the logo:
- **Expanded:** `«` (ChevronsLeft, from `lucide-react`, already a dependency), positioned at
  the right edge of the logo row.
- **Collapsed:** `»` (ChevronsRight), centered under the logo mark (logo row becomes just the
  mark + chevron stacked, since there's no text to share the row with).
- Click toggles `collapsed` and persists to `localStorage` as described above.
- `aria-label="Collapse sidebar"` / `"Expand sidebar"` matching state, same pattern as the
  existing mobile menu button's `aria-label="Toggle menu"`.

## Out of scope

- Mobile behavior — untouched.
- Per-group collapse/expand (accordion-style hiding of individual nav groups) — this feature
  is a single whole-sidebar fold, not per-section folding.
- Resizable/draggable sidebar width — fixed collapsed width (`4.5rem`), not user-adjustable.
- Keyboard shortcut to toggle — mouse/touch click only for this pass.

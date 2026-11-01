---
name: vistar-theming
description: Vistar design system and theming rules (tokens, light/dark/system/scheduled themes, motion, accessibility, UI kit). Use for any UI, chart, 3D scene or email template in Vistar.
---

# Vistar theming and design

Source of truth: `packages/shared/src/design/tokens.ts` (palettes), `packages/shared/src/theme.ts`
(resolution + boot script), `apps/web/styles/theme.css` (Tailwind mapping), `apps/web/components/ui/*`
(kit, live at `/kit`). Do not copy values; import or use the utilities.

## Look
- Clean enterprise (Linear / HubSpot / Stripe). No neon, no glassmorphism, no decorative gradients.
- Inter, body 14px (`text-base`), dense tables 13px (`text-sm`), labels 12px (`text-xs`). Weights 400/500/600.
- One accent: indigo (`bg-accent`, `text-accent-text`, `bg-accent-soft`). Use it for the primary action and selection only. One primary button per view.
- Status colours only as soft chips (`<StatusChip status>` or `<Chip tone>`): on call = blue, idle/available = green, busy = amber, offline/away = grey, error = red.
- Radius 8px (`rounded-md`), cards 12px (`rounded-lg`). Elevation `shadow-card` (rest), `shadow-raised` (hover), `shadow-overlay` (menus, dialogs), `shadow-lift` (dragging).
- Lucide line icons at 16px. Avatars are initials circles (`<Avatar name>`).
- The `frontend-design` skill asks for a distinctive aesthetic; for Vistar the brief above wins. Spend the "signature" on motion quality and data density, not new colours or fonts.

## Tokens (Tailwind utilities)
- Surfaces: `bg-bg` (page), `bg-surface` (cards), `bg-surface-2` (hover, zebra), `bg-surface-3` (pressed).
- Text: `text-fg`, `text-fg-secondary`, `text-muted` (on surface), `text-muted-strong` (small text on `bg`; plain `muted` fails AA there).
- Borders: `border-border`, `border-border-strong` (hover).
- Feedback text: `text-danger-text`, `text-success-text`, `text-warning-text`.
- Charts: `var(--chart-1..6)`, grid `var(--chart-grid)`, axis `var(--chart-axis)`.
- The default Tailwind palette is disabled. `bg-blue-500` does not exist; never use hex in class names.
- JS (Three.js, canvas, Recharts props, emails): `palettes[theme]['chart-1']` with `useDocumentTheme()`.

## Themes
- Modes: System (default, live `prefers-color-scheme`), Light, Dark, Scheduled (dark between user hours in the WORKSPACE timezone).
- `<html data-theme="light|dark">` is set before first paint by `getThemeBootScript()` from cookie `vistar_theme`. Never read `localStorage` for theme in render; no flash.
- Resolve with `resolveTheme()`; schedule the next flip with `msUntilNextThemeSwitch()`.
- Every screen, chart, 3D scene and email must be checked in BOTH themes. Dark is not inverted light: surfaces step up in lightness (`bg` < `surface` < `surface-2`).
- Theme toggle lives in the top bar (all panels) and in Employee "Notifications and theme".

## Motion
- 150-250 ms, `ease-standard`. Purposeful: numbers tick up, new rows slide in with a brief highlight (`data-new="true"` on `TableRow`), sparklines update live, skeletons while loading, view switches cross-fade 200 ms.
- Physics (drag, rope edges) uses `@react-spring/web`; UI transitions use `motion`.
- Always gate on `useReducedMotion()` (OS setting or `data-reduced-motion="on"`): replace motion with instant state changes, keep focus and feedback.

## Accessibility (WCAG AA)
- Contrast: tokens already pass AA when used as documented. Do not put `text-muted` on `bg`.
- Keyboard: everything reachable and operable; visible focus (`focus-ring` utility or kit components). Drag and drop always has a menu alternative ("Move to stage...").
- Icon-only buttons need `aria-label`. Forms use `<FormField>` (label, hint, error, aria wiring).
- Dialogs: always a `DialogTitle`. Toasts are announcements, not the only feedback for errors in forms.
- Touch targets in the Employee panel: at least 44x44 px.
- Charts and the 3D floor have a text equivalent (table or list).

## Layout
- Company and Super Admin panels: left sidebar (grouped), top bar (search, theme toggle, notifications, avatar), content max width as needed; dense tables.
- Employee panel: mobile-first, bottom nav (Home, Leads, Calls, Inbox, More), no horizontal scroll except Board columns.
- Responsive: desktop, tablet, mobile. On mobile Table views render as card lists.

## Checklist before you finish a screen
- [ ] Light and dark screenshots look right (no hard-coded colours).
- [ ] Loading, empty and error states exist.
- [ ] Keyboard-only path works; focus visible.
- [ ] Reduced motion respected.
- [ ] Mobile width (375px) has no horizontal scroll (except Board).

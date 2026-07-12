/**
 * @projective/ui/navigation — the nested shell layout engine + wayfinding atoms (DESIGN_SYSTEM.md
 * Part D). Structure (unified convention): `components/` · `islands/` · `hooks/` · `styles/` ·
 * `types/`.
 *
 * The three-zone nested frame:
 *   - AppShell     (Red)   — permanent outer shell: top utility bar + global sidebar (user/desktop).
 *   - MiddleNav    (Blue)  — page-level nav lane, nested within Red, framing the canvas.
 *   - PageCanvas   (Green) — central stage, nested within Blue (or directly within Red).
 *
 * Curvature: each nested frame curves its top-left always, and its bottom-left only when a parent
 * track remains beneath it (`flushBottom={false}` / `useFlushBottom`). Persona/device gates hide the
 * sidebar for guests + mobile and switch the top bar to a glass (`backdrop-filter`) header.
 *
 * Interactive pieces (`islands/`) are named exports — hydrate them via a `features/<group>/islands/`
 * wrapper in the app.
 *
 * Roster still to build (§C.1): AppBar, NavigationDrawer, Breadcrumbs, Tabs, Pagination,
 * DropdownMenu, ContextMenu, Stepper.
 */

// #region Components
export { AppShell, type AppShellProps } from "./components/AppShell.tsx";
export { ShellTopBar, type ShellTopBarProps } from "./components/ShellTopBar.tsx";
export { ShellSidebar, type ShellSidebarProps } from "./components/ShellSidebar.tsx";
export { ShellFrame, type ShellFrameProps } from "./components/ShellFrame.tsx";
export { MiddleNav, type MiddleNavProps } from "./components/MiddleNav.tsx";
export { PageCanvas, type PageCanvasProps } from "./components/PageCanvas.tsx";
export { NavItem, type NavItemProps } from "./components/NavItem.tsx";
export { Link, type LinkProps } from "./components/Link.tsx";
// #endregion

// #region Islands (interactive — hydrate via app wrappers)
export { MiddleNavSplitter, type MiddleNavSplitterProps } from "./islands/MiddleNavSplitter.tsx";
export { MobileMenu, type MobileMenuProps } from "./islands/MobileMenu.tsx";
// #endregion

// #region Hooks
export { useMediaQuery } from "./hooks/useMediaQuery.ts";
export { useFlushBottom } from "./hooks/useFlushBottom.ts";
export { type Splitter, useSplitter, type UseSplitterOptions } from "./hooks/useSplitter.ts";
// #endregion

// #region Types
export type { FrameSurface, LaneMode, Persona } from "./types/mod.ts";
// #endregion

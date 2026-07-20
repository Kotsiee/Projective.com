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
 * Wayfinding atoms (PrimeNG parity): Menu, Menubar, MegaMenu, TieredMenu, PanelMenu, SlideMenu,
 * ContextMenu, Breadcrumb, Steps, TabMenu, TabView/TabPanel, Paginator. Every menu-shaped control
 * consumes the shared `MenuItem` model (`@projective/ui` root types).
 */

// #region Components
export { AppShell, type AppShellProps } from "./components/AppShell.tsx";
export { ShellTopBar, type ShellTopBarProps } from "./components/ShellTopBar.tsx";
export { ShellSidebar, type ShellSidebarProps } from "./components/ShellSidebar.tsx";
export { ShellFrame, type ShellFrameProps } from "./components/ShellFrame.tsx";
export { MiddleNav, type MiddleNavProps } from "./components/MiddleNav.tsx";
export { PageCanvas, type PageCanvasProps } from "./components/PageCanvas.tsx";
export { NavItem, type NavItemProps } from "./components/NavItem.tsx";
export { BottomNav, type BottomNavItem, type BottomNavProps } from "./components/BottomNav.tsx";
export { Link, type LinkProps } from "./components/Link.tsx";
// #endregion

// #region Islands (interactive — hydrate via app wrappers)
export { MiddleNavSplitter, type MiddleNavSplitterProps } from "./islands/MiddleNavSplitter.tsx";
export { MobileMenu, type MobileMenuProps } from "./islands/MobileMenu.tsx";
export { TreeNav, type TreeNavNode, type TreeNavProps } from "./islands/TreeNav.tsx";
// #endregion

// #region Menus (popup + inline, cascading submenus over the shared MenuItem model)
export { Menu, type MenuProps } from "./islands/Menu.tsx";
export { Menubar, type MenubarProps } from "./islands/Menubar.tsx";
export { MegaMenu, type MegaMenuProps } from "./islands/MegaMenu.tsx";
export { TieredMenu, type TieredMenuProps } from "./islands/TieredMenu.tsx";
export { PanelMenu, type PanelMenuProps } from "./islands/PanelMenu.tsx";
export { SlideMenu, type SlideMenuProps } from "./islands/SlideMenu.tsx";
export { ContextMenu, type ContextMenuProps } from "./islands/ContextMenu.tsx";
// #endregion

// #region Trails, steps & tabs
export { Breadcrumb, type BreadcrumbProps } from "./components/Breadcrumb.tsx";
export { Steps, type StepsProps } from "./islands/Steps.tsx";
export { TabMenu, type TabMenuProps } from "./islands/TabMenu.tsx";
export { TabPanel, type TabPanelProps, TabView, type TabViewProps } from "./islands/TabView.tsx";
export {
	Pagination,
	Paginator,
	type PaginatorPageEvent,
	type PaginatorProps,
} from "./islands/Paginator.tsx";
// #endregion

// #region Hooks
export { useMediaQuery } from "./hooks/useMediaQuery.ts";
export { useFlushBottom } from "./hooks/useFlushBottom.ts";
// `Splitter` (the useSplitter return type) is aliased to avoid colliding with layout's Splitter
// component in the umbrella `export *`.
export {
	type Splitter as SplitterController,
	useSplitter,
	type UseSplitterOptions,
} from "./hooks/useSplitter.ts";
// #endregion

// #region Types
export type { FrameSurface, LaneMode, Persona } from "./types/mod.ts";
// #endregion

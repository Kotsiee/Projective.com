import { Fragment, type JSX, type VNode } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { UserContext } from "@projective/types/auth";
import { PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import {
	ActionMenu,
	composeMenu,
	linkActionItems,
	linkOpenItem,
	type MenuItem,
	NavItem,
	ShellSidebar,
} from "@projective/ui/navigation";
import type { NavPreviewKind } from "@projective/types/user";
import { Tooltip } from "@projective/ui/feedback";
// The shell's header styling lives in a server component (UserShell), whose CSS import is NOT in any
// island's client-bundle graph and so never ships. Riding it on this always-present island injects it
// (same pattern as the footer's NewsletterForm island — see storage/footer decisions).
import "@web/features/shell/styles/user-shell.css";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { NavIcon, SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import {
	globalNav,
	type NavModelItem,
	type NavSublink,
} from "@web/features/shell/core/nav-model.ts";
import { useEffectiveContext } from "@web/features/shell/core/effective-context.ts";
import { isEditableTarget, isToggleSidebarShortcut } from "@web/features/shell/core/shortcuts.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { loadNavPreview, navPreviews } from "@web/features/shell/core/nav-preview-state.ts";
import { PREVIEW_KIND, previewRows } from "@web/features/shell/core/nav-preview-menu.ts";
import { noteCopied } from "@web/features/shell/core/copy-note.ts";

/** The link a right-click on the rail landed on, and the preview its destination lists. */
interface RailLink {
	href: string;
	label: string;
	kind?: NavPreviewKind;
}

/** The rail landmark — the right-click surface. */
const railEl = (): HTMLElement | null => document.querySelector<HTMLElement>(".ui-shell-sidebar");

export interface ShellSidebarIslandProps {
	/** Current pathname — drives active state (was resolved server-side; now re-gated live too). */
	path: string;
	/**
	 * The hydrated user context — the roster is derived from it (seller-only Services/Businesses/Teams,
	 * Analytics gating). Re-derived live from the DEV Context Switcher seam so a persona flip re-gates
	 * the rail with no reload; inert in production. Defaults to a personal member.
	 */
	context?: UserContext;
}

/**
 * ShellSidebar island — the interactive global rail for the desktop user shell (DESIGN_SYSTEM.md
 * Part D.1). Owns the cached collapse/expand preference (persisted via storage-keys.ts, mirrored to
 * `:root[data-sidebar]` so width paints pre-hydration with no flash), renders collapsed icons as
 * square blocks with real `Tooltip` labels (never native `title`), and exposes YouTube-style nested
 * disclosures under items that carry `children` (Projects → project workspaces shown by their owner's
 * circular avatar, Products & Services / Teams / Businesses → kind-strict lists). The collapse/expand
 * control is a labelless custom morphing SVG pinned bottom-left. Composes the package's presentational
 * `ShellSidebar` frame.
 *
 * Ctrl+B / Cmd+B toggles the rail from anywhere except while typing (fields, editable regions, the
 * rich-text editor keep the chord).
 *
 * Right-click (or the ContextMenu key / Shift+F10) opens one menu (Decision #370): on Messages ·
 * Projects · Catalogue · Teams · Businesses, first the viewer's top three there, saved and starred
 * first, read only when that menu opens; then, on any rail link, its Open row (press to open; hover
 * for a new tab or a new window) and Copy link; on the empty rail, Expand / Collapse navigation.
 *
 * The roster is computed **in the island** via {@link globalNav} off a live {@link useEffectiveContext}
 * so it matches SSR on hydration (same inputs) yet re-gates instantly when the DEV Context Switcher
 * changes the simulated persona — the same seam every other role-aware surface consumes.
 */
export default function ShellSidebarIsland(
	{ path, context = PERSONAL_MEMBER_CONTEXT }: ShellSidebarIslandProps,
): JSX.Element {
	// Live effective context (SSR base → dev-seam-overridden). `globalNav` is pure, so recomputing on
	// change is cheap and paints the correct roster with no reload.
	const effective = useEffectiveContext(context);
	const items = useComputed<NavModelItem[]>(() => globalNav(path, effective.value.context));

	// SSR default = collapsed (matches the _app.tsx pre-paint script's default); reconciled to the
	// cached preference on mount to avoid a hydration mismatch.
	const collapsed = useSignal(true);
	// Groups whose disclosure is open — seeded from the active route (baseline roster) so a deep link
	// lands expanded. A persona flip may add/remove groups; the user's open set carries over harmlessly.
	const openGroups = useSignal<string[]>(
		globalNav(path, context).filter((i) =>
			i.children?.length && (i.active || i.children.some((c) => c.active))
		).map((i) => i.key),
	);

	useEffect(() => {
		const stored = readStored("local", LocalKeys.SIDEBAR_COLLAPSED);
		const isCollapsed = stored !== "0"; // unset or "1" → collapsed (default slim rail)
		collapsed.value = isCollapsed;
		document.documentElement.dataset.sidebar = isCollapsed ? "collapsed" : "expanded";
	}, []);

	const toggleCollapsed = () => {
		const next = !collapsed.value;
		collapsed.value = next;
		writeStored("local", LocalKeys.SIDEBAR_COLLAPSED, next ? "1" : "0");
		document.documentElement.dataset.sidebar = next ? "collapsed" : "expanded";
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!isToggleSidebarShortcut(e)) return;
			if (isEditableTarget(e.target instanceof Element ? e.target : null)) return;
			e.preventDefault();
			toggleCollapsed();
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, []);

	// #region Right-click menu
	const railLink = useSignal<RailLink | null>(null);
	// Capture runs before the menu's own listener, so the rows are already for this link when it opens.
	useEffect(() => {
		const rail = railEl();
		if (!rail) return;
		const onContextMenu = (e: MouseEvent) => {
			const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
			const href = a?.getAttribute("href");
			if (!a || !href) {
				railLink.value = null;
				return;
			}
			const item = items.peek().find((i) => i.href === href);
			const sub = items.peek().flatMap((i) => i.children ?? []).find((c) => c.href === href);
			const kind = item ? PREVIEW_KIND[item.key] : undefined;
			railLink.value = {
				href,
				label: item?.label ?? sub?.label ?? a.textContent?.trim() ?? "",
				kind,
			};
			if (kind) void loadNavPreview(kind);
		};
		rail.addEventListener("contextmenu", onContextMenu, true);
		return () => rail.removeEventListener("contextmenu", onContextMenu, true);
	}, []);

	const railMenu = (): MenuItem[] => {
		const link = railLink.value;
		if (!link) {
			const apple = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
			return [{
				key: "rail-toggle",
				label: collapsed.value ? "Expand navigation" : "Collapse navigation",
				icon: collapsed.value ? "expand" : "collapse",
				shortcut: apple ? "⌘ B" : "Ctrl B",
				command: toggleCollapsed,
			}];
		}
		// The destination's own rows first — what a right-click on it is for, as a jump list — then the
		// link itself: Open (hover for a new tab or window) with Copy link beside it.
		return composeMenu(
			link.kind
				? previewRows(
					link.kind,
					navPreviews.value[link.kind],
					Date.now(),
					effective.value.context.locale,
					noteCopied,
				)
				: [],
			[
				linkOpenItem({
					key: "rail-open",
					href: link.href,
					label: `Open ${link.label}`,
					copy: false,
				}),
				...linkActionItems({
					href: link.href,
					title: link.label,
					include: ["copy-link"],
					onCopied: noteCopied,
				}),
			],
		);
	};
	// #endregion

	const toggleGroup = (key: string) => {
		const set = new Set(openGroups.value);
		set.has(key) ? set.delete(key) : set.add(key);
		openGroups.value = [...set];
	};

	// #region Renderers
	const renderLeaf = (item: NavModelItem): VNode => (
		<Tooltip content={item.label} placement="right" delay="none">
			<NavItem
				href={item.href}
				label={item.label}
				icon={<NavIcon name={item.icon} />}
				active={item.active}
				dot={item.dot}
			/>
		</Tooltip>
	);

	const renderSublinkLead = (sub: NavSublink): VNode | null => {
		if (sub.avatar) {
			// Individual workspaces show the OWNER's circular avatar — never a generic icon.
			return (
				<span class="ui-sidebar-sublink__avatar">
					<UserAvatar
						image={sub.avatar}
						alt={sub.owner ?? ""}
						label={sub.owner ?? ""}
						shape="circle"
						size={22}
					/>
				</span>
			);
		}
		if (sub.icon) {
			return (
				<span class="ui-sidebar-sublink__icon">
					<NavIcon name={sub.icon} />
				</span>
			);
		}
		return null;
	};

	const renderGroup = (item: NavModelItem): VNode => {
		const open = openGroups.value.includes(item.key);
		const subId = `nav-sub-${item.key}`;
		return (
			<div class="ui-sidebar-group" data-open={open ? "true" : "false"}>
				<div class="ui-sidebar-group__row">
					{renderLeaf(item)}
					<button
						type="button"
						class="ui-sidebar-group__caret"
						aria-expanded={open}
						aria-controls={subId}
						aria-label={`${open ? "Collapse" : "Expand"} ${item.label} shortcuts`}
						onClick={() => toggleGroup(item.key)}
					>
						<NavIcon name="chevron" />
					</button>
				</div>
				<ul id={subId} class="ui-sidebar-sublinks">
					{item.children!.map((sub) => (
						<li key={sub.href}>
							<a
								href={sub.href}
								class={`ui-sidebar-sublink${sub.active ? " ui-sidebar-sublink--active" : ""}`}
								aria-current={sub.active ? "page" : undefined}
							>
								{renderSublinkLead(sub)}
								<span class="ui-sidebar-sublink__text">{sub.label}</span>
								{sub.dot ? <span class="ui-visually-hidden">has updates</span> : null}
							</a>
						</li>
					))}
				</ul>
			</div>
		);
	};

	const renderItem = (item: NavModelItem): VNode =>
		item.children?.length ? renderGroup(item) : renderLeaf(item);
	// #endregion

	return (
		<>
			<ShellSidebar
				label="Global navigation"
				footer={
					<button
						type="button"
						class="ui-shell-sidebar__toggle"
						aria-expanded={!collapsed.value}
						aria-label={collapsed.value ? "Expand navigation" : "Collapse navigation"}
						onClick={toggleCollapsed}
					>
						<SidebarToggleIcon />
					</button>
				}
			>
				{items.value.map((item) => <Fragment key={item.key}>{renderItem(item)}</Fragment>)}
			</ShellSidebar>
			<ActionMenu
				aria-label={railLink.value ? `${railLink.value.label} menu` : "Navigation menu"}
				surface={railEl}
				model={typeof document === "undefined" ? [] : railMenu()}
			/>
		</>
	);
}

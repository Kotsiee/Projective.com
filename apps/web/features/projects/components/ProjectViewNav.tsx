import type { JSX, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { type ProjectViewLink, projectViewLinks } from "./detail-glyphs.tsx";
import { KebabIcon } from "./glyphs.tsx";
import { fitViewNav } from "../core/viewnav-fit.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * ProjectViewNav — the compact, minimalist navigation pinned in the sidebar's sticky footer. Two
 * clusters, and nothing else:
 *
 *   - **Left** — the lane Expand/Collapse toggle (reuses the global rail's {@link SidebarToggleIcon}
 *     glyph + its morphing-divider slide, scoped to THIS lane in project-sidebar.css).
 *   - **Right** — the view links as icon-only anchors, each labelled by a portal {@link Tooltip}; the
 *     Board icon/label is DYNAMICALLY resolved off the engagement format (Pipeline · Timeline ·
 *     Calendar). Whatever does not fit folds into the kebab **More** popover.
 *
 * The row is **width-aware**, because the lane it sits in is drag-resizable: a `ResizeObserver` on the
 * footer plus a one-time measurement of each control's natural width fit as many links as the live
 * width allows, truncating from the RIGHTMOST inward and restoring them in their original order as
 * the lane grows back. Available width is the footer's CONTENT box less the collapse trigger (with
 * its margins), the row gap, and — only when something actually overflows — the kebab trigger.
 *
 * The kebab is not a fixture of the row — it exists only to hold what was folded, so a lane wide
 * enough for every link renders no kebab at all. Nothing is pinned into the menu: priority is stated
 * by ORDER alone, so the last link is simply the first to go. The one control that never folds is the
 * collapse toggle, because it is what gets the lane back.
 *
 * Rendering every link inline is the SSR / pre-measurement fallback — nothing is hidden until real
 * geometry has been read, so the first byte is complete and a no-JS reader keeps the whole row.
 */

/** The primary site sidebar the `top`/`top-end` popovers must never slide under (edge-detection). */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

/** Width reserved for the kebab before it has been measured for real — one 2rem icon square. */
const KEBAB_ESTIMATE = 32;

/** The footer's usable width — its CONTENT box, since `clientWidth` includes its inline padding. */
function contentWidthOf(el: HTMLElement): number {
	const cs = getComputedStyle(el);
	const pad = (parseFloat(cs.paddingInlineStart) || 0) + (parseFloat(cs.paddingInlineEnd) || 0);
	return Math.max(0, el.clientWidth - pad);
}

/** What a flex item actually costs the row: its border box PLUS its inline margins. */
function outerWidthOf(el: HTMLElement): number {
	const cs = getComputedStyle(el);
	const margin = (parseFloat(cs.marginInlineStart) || 0) + (parseFloat(cs.marginInlineEnd) || 0);
	return el.getBoundingClientRect().width + margin;
}

/** A resolved column gap, or the supplied fallback when the value is `normal`/unset. */
function gapOf(el: HTMLElement, fallback: number): number {
	const g = parseFloat(getComputedStyle(el).columnGap);
	return Number.isFinite(g) ? g : fallback;
}

/**
 * {@link Tooltip} wraps its anchor in a `.ui-tooltip__anchor` span, so the element the flex row lays
 * out is that span and not the control inside it. Measuring the control instead would under-count the
 * row by the wrapper's own box on every single item.
 */
function flexItemOf(el: Element): HTMLElement {
	return el.closest<HTMLElement>(".ui-tooltip__anchor") ?? (el as HTMLElement);
}

export interface ProjectViewNavProps {
	detail: ProjectDetail;
	/** Live pathname — drives the active icon. */
	currentPath: string;
	/** Whether the lane is collapsed (drives the toggle glyph + label). */
	collapsed: boolean;
	/** The effective service archetype — sessions drop Submissions + label the Board "Calendar". */
	sessionKind?: "none" | "normal" | "group";
	onToggleCollapse: () => void;
}

export function ProjectViewNav(
	{ detail, currentPath, collapsed, sessionKind = "none", onToggleCollapse }: ProjectViewNavProps,
): JSX.Element {
	const base = `/projects/${detail.slug}`;
	const links = projectViewLinks(detail, sessionKind);

	const navRef = useRef<HTMLElement>(null);
	const linksRef = useRef<HTMLDivElement>(null);
	const collapseRef = useRef<HTMLButtonElement>(null);

	// Measured geometry. The link widths + fixed chrome are captured once against the all-inline
	// render (icon squares are static, so natural widths are stable); `containerW` then tracks the
	// live footer width. `ready` gates the fold so nothing is hidden before real numbers exist.
	const geo = useRef({ btn: [] as number[], gapLinks: 2, gapRow: 8, collapse: 0 });
	const containerW = useSignal(0);
	const ready = useSignal(false);
	// A SIGNAL rather than another field on `geo`, because the fit is derived during render: the value
	// itself is then the dependency, and refining the estimate to the real measurement re-renders the
	// row on its own. A counter bumped beside a mutable ref would say only THAT something changed.
	const kebabW = useSignal(KEBAB_ESTIMATE);

	// The link set is not fixed: a dev-simulated session archetype drops Submissions and a standard
	// engagement puts it back, so widths captured for one set describe the other wrongly — too few and
	// a real link is stranded in the menu forever, too many and the row folds one link early. The
	// identity of the set is what a measurement is valid FOR, so it is measured alongside the widths.
	const linkKey = links.map((l) => l.key).join("|");
	const measuredFor = useRef("");

	/**
	 * Read the live footer width, re-measuring the natural geometry whenever it does not yet describe
	 * the links currently on the row.
	 *
	 * A zero width is NOT a narrow lane — it is the collapsed rail, where `.proj-detail__full` is
	 * `display: none` and every offset reads 0. Caching that would fold every link away and then
	 * restore nothing when the lane re-opens, so a hidden footer is skipped and the last good geometry
	 * stands. The footer's width is driven top-down by the splitter, never by its own children, so
	 * re-splitting the row can never feed back into the observer.
	 *
	 * Held in a ref, and re-assigned on every render, because the observer is installed once at mount:
	 * a closure captured there would keep measuring against the link set the component had on its
	 * first frame.
	 */
	const syncRef = useRef<() => void>(() => {});
	syncRef.current = () => {
		const el = navRef.current;
		const row = linksRef.current;
		if (!el || !row) return;
		const w = contentWidthOf(el);
		if (w <= 0) return;
		if (measuredFor.current !== linkKey) {
			const nodes = row.querySelectorAll<HTMLElement>(
				".proj-viewnav__btn:not(.proj-viewnav__more)",
			);
			// Only an UNFOLDED row can describe the whole set — a folded one lists the survivors, and
			// caching their widths as the set's would leave the row permanently narrower than it needs
			// to be. This guard is the precondition itself rather than a bet on effect ordering: a
			// signal write is visible to the very next read, so an invalidation and a measurement that
			// merely run in the right ORDER still land in the same commit, against the old DOM.
			if (nodes.length !== links.length) {
				ready.value = false;
				return;
			}
			geo.current.gapRow = gapOf(el, geo.current.gapRow);
			geo.current.gapLinks = gapOf(row, geo.current.gapLinks);
			const toggle = collapseRef.current;
			geo.current.collapse = toggle ? outerWidthOf(flexItemOf(toggle)) : 0;
			geo.current.btn = Array.from(nodes, (node) => outerWidthOf(flexItemOf(node)));
			measuredFor.current = linkKey;
			ready.value = true;
		}
		containerW.value = w;
	};

	useEffect(() => {
		const el = navRef.current;
		if (!el) return;
		const run = () => syncRef.current();
		run();
		const ro = new ResizeObserver(run);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	/**
	 * A changed link set invalidates the cached widths and nothing more — dropping `ready` is what
	 * paints every link inline again, which is the render the measurement needs.
	 */
	useEffect(() => {
		if (measuredFor.current !== linkKey) ready.value = false;
	}, [linkKey]);

	/**
	 * Re-measure while the widths do not describe the links on the row. Un-gated by deps on purpose:
	 * it has to run on whichever render finally paints the full set, and it self-limits — a successful
	 * pass sets `ready`, and every later run returns on the first line.
	 */
	useEffect(() => {
		if (!ready.value) syncRef.current();
	});

	/** Once the kebab is actually on screen, replace the estimate with its real width. */
	useEffect(() => {
		const node = linksRef.current?.querySelector<HTMLElement>(".proj-viewnav__more");
		if (!node) return;
		const w = outerWidthOf(flexItemOf(node));
		if (w > 0 && Math.abs(w - kebabW.value) > 1) kebabW.value = w;
	});

	/**
	 * Fit the links into the live width, folding the rightmost away first.
	 *
	 * Derived during render rather than in a `useComputed`, and that is a correctness point rather than
	 * a style one: a computed re-evaluates only when one of its SIGNAL dependencies changes, and the
	 * link set is an ordinary prop-derived array. A dev-simulated session (which drops Submissions and
	 * relabels the Board) therefore left the computed serving its cached answer, and the row rendered
	 * the PREVIOUS archetype's links until some unrelated signal happened to invalidate it — measured
	 * as a row that was reliably one flip behind. Reading the signals here instead subscribes the
	 * component itself, so both inputs are current on every render.
	 */
	const visibleCount = ready.value && containerW.value > 0
		? fitViewNav({ ...geo.current, kebab: kebabW.value, containerW: containerW.value }).visible
		: links.length;
	const visible = links.slice(0, visibleCount);
	// The menu holds exactly what was folded, in the order it was folded from — so a reader scanning
	// inline-then-menu still reads Details → Board → … → Attachments.
	const menu: ProjectViewLink[] = links.slice(visibleCount);

	const hrefFor = (seg: string) => (seg ? `${base}/${seg}` : base);
	const isActive = (seg: string) =>
		seg ? currentPath === hrefFor(seg) : currentPath === base || currentPath === `${base}/`;
	const menuActive = menu.some((l) => isActive(l.seg));

	return (
		<nav class="proj-viewnav" aria-label="Project views" ref={navRef}>
			<Tooltip content={collapsed ? "Expand lane" : "Collapse lane"} placement="top">
				<button
					type="button"
					ref={collapseRef}
					class="proj-viewnav__collapse"
					data-collapsed={collapsed ? "true" : undefined}
					aria-label={collapsed ? "Expand lane" : "Collapse lane"}
					aria-pressed={collapsed}
					onClick={onToggleCollapse}
				>
					<SidebarToggleIcon />
				</button>
			</Tooltip>

			<div class="proj-viewnav__links" ref={linksRef}>
				{visible.map((link) => (
					<Tooltip key={link.key} content={link.label} placement="top">
						<a
							class="proj-viewnav__btn"
							href={hrefFor(link.seg)}
							data-active={isActive(link.seg) ? "true" : undefined}
							aria-current={isActive(link.seg) ? "page" : undefined}
							aria-label={link.label}
						>
							<span class="proj-viewnav__icon" aria-hidden="true">{link.icon}</span>
						</a>
					</Tooltip>
				))}

				{menu.length > 0 && (
					<Popover
						placement="top-end"
						avoid={SHELL_AVOID}
						allowOverflow={["top"]}
						class="proj-cardmenu-pop"
						trigger={(api) => (
							<Tooltip content="More views" placement="top">
								<button
									type="button"
									ref={api.ref as RefObject<HTMLButtonElement>}
									class="proj-viewnav__btn proj-viewnav__more"
									data-active={menuActive ? "true" : undefined}
									data-open={api.expanded ? "true" : undefined}
									aria-label="More views"
									aria-haspopup="menu"
									aria-expanded={api.expanded}
									aria-controls={api.panelId}
									onClick={api.toggle}
								>
									<span class="proj-viewnav__icon" aria-hidden="true">{KebabIcon}</span>
								</button>
							</Tooltip>
						)}
					>
						<div class="proj-cardmenu" role="menu" aria-label="More project views">
							{menu.map((link) => (
								<a
									key={link.key}
									role="menuitem"
									class="proj-cardmenu__item"
									href={hrefFor(link.seg)}
									data-active={isActive(link.seg) ? "true" : undefined}
									aria-current={isActive(link.seg) ? "page" : undefined}
								>
									<span class="proj-cardmenu__icon" aria-hidden="true">{link.icon}</span>
									<span class="proj-cardmenu__label">{link.label}</span>
								</a>
							))}
						</div>
					</Popover>
				)}
			</div>
		</nav>
	);
}

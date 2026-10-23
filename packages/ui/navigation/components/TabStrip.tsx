import { cloneElement, type JSX, type RefObject, type VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import "../styles/tabstrip.css";
import { cx } from "../../core/cx.ts";
import { Icon } from "../../icons/mod.ts";
import { Button } from "../../fields/components/Button.tsx";
import { Popover } from "../../feedback/islands/Popover.tsx";
import { Tooltip } from "../../feedback/islands/Tooltip.tsx";
import { overflowsTrack, shouldCollapseTabs, stepIndex, swipeStep } from "../core/tab-strip.ts";

// #region Props
/** One tab in a {@link TabStrip}. */
export interface TabStripItem<K extends string = string> {
	key: K;
	label: string;
	/** Leading glyph, cloned at every render site (the Preact VNode-reuse hazard). */
	icon?: VNode;
	/** A quiet unseen-activity dot after the label (§D.1 — a dot, never a count). */
	dot?: boolean;
	/** Words added to the tab's accessible name only — the count a dot stands for ("3 unread"). */
	hint?: string;
}

/** A tab that navigates: the strip renders anchors and the URL owns the active tab. */
export interface TabStripLinkItem<K extends string = string> extends TabStripItem<K> {
	href: string;
}

/**
 * `header` — the middle-nav header band's strip: full height, centred between the identity and the
 * action tray, its underline on the band's seam, label folding to the glyph below `--bp-md`.
 * `lane` — the quieter strip at the head of a lane: smaller type, start-aligned, filling its row.
 */
export type TabStripTone = "header" | "lane";

interface TabStripBaseProps<K extends string> {
	/** Accessible name of the tab set. */
	label: string;
	activeKey: K;
	tone?: TabStripTone;
	class?: string;
}

/** Link tabs: each tab is an address (`aria-current="page"` on the active one). */
export interface TabStripLinkProps<K extends string = string> extends TabStripBaseProps<K> {
	items: readonly TabStripLinkItem<K>[];
	onSelect?: undefined;
	panelId?: undefined;
}

/** In-place tabs: a `role="tablist"` that switches or filters a region without navigating. */
export interface TabStripSelectProps<K extends string = string> extends TabStripBaseProps<K> {
	items: readonly TabStripItem<K>[];
	onSelect: (key: K) => void;
	/**
	 * The id of the `role="tabpanel"` region the tabs switch. Each tab gets the id `{panelId}-tab-{key}`
	 * and `aria-controls={panelId}` (the compact control carries the active tab's id), so the panel can
	 * name itself with `aria-labelledby`.
	 */
	panelId?: string;
}

export type TabStripProps<K extends string = string> =
	| TabStripLinkProps<K>
	| TabStripSelectProps<K>;
// #endregion

// #region Measurement
function inlinePadding(el: Element): number {
	const cs = getComputedStyle(el);
	return (parseFloat(cs.paddingInlineStart) || 0) + (parseFloat(cs.paddingInlineEnd) || 0);
}

/** The inline extent the visible children of `tray` occupy (hidden controls measure 0 and are skipped). */
function trayContentWidth(tray: Element): number {
	let start = Infinity;
	let end = -Infinity;
	for (const child of Array.from(tray.children)) {
		const r = child.getBoundingClientRect();
		if (r.width === 0) continue;
		start = Math.min(start, r.left);
		end = Math.max(end, r.right);
	}
	return end > start ? end - start : 0;
}

function sharesRow(a: Element, b: Element): boolean {
	const ra = a.getBoundingClientRect();
	const rb = b.getBoundingClientRect();
	return ra.top < rb.bottom && ra.bottom > rb.top;
}

function collapses(root: HTMLElement, natural: number, tone: TabStripTone, count: number): boolean {
	if (tone === "lane") {
		return overflowsTrack(root.clientWidth - inlinePadding(root), natural, count);
	}
	const host = root.parentElement;
	if (!host) return false;
	const trailing = root.nextElementSibling;
	return shouldCollapseTabs({
		headerInner: host.clientWidth - inlinePadding(host),
		tabsNatural: natural,
		actionsContent: trailing && sharesRow(trailing, root) ? trayContentWidth(trailing) : 0,
		gap: parseFloat(getComputedStyle(host).columnGap) || 0,
	}, count);
}
// #endregion

function TabFace({ item }: { item: TabStripItem }): JSX.Element {
	return (
		<>
			{item.icon && (
				<span class="ui-tabstrip__icon" aria-hidden="true">{cloneElement(item.icon)}</span>
			)}
			<span class="ui-tabstrip__label">{item.label}</span>
			{item.dot && <span class="ui-tabstrip__dot" aria-hidden="true" />}
			{item.hint && <span class="ui-visually-hidden">{`, ${item.hint}`}</span>}
		</>
	);
}

/**
 * TabStrip — the one tab strip of every middle-nav surface: the header band's view tabs (`tone="header"`,
 * link tabs into nested routes) and a lane's in-place tabs (`tone="lane"`, a `role="tablist"`).
 *
 * Expanded, the tabs are plain text items whose active state is a monochrome `--on-surface` label and
 * 2px underline. When the strip no longer fits it collapses to one ghost dropdown — the active tab and
 * a caret — between two ghost chevrons that step circularly through the tabs. The dropdown opens a
 * `Popover` picker of every tab; a horizontal swipe on it steps like the chevrons. All three controls
 * are the `Button` primitive's tier-5 ghost (`text`, `secondary`, `sm`, `rounded`); a link step wears
 * the same classes on an anchor.
 *
 * Collapse is MEASURED, not a viewport query. A hidden zero-size copy of the full strip gives its
 * natural width in either layout; a `ResizeObserver` on it, the host row and the trailing tray re-runs
 * the pure rule in `core/tab-strip.ts` (`header`: the centred strip would reach the trailing tray;
 * `lane`: it no longer fits its own track). SSR renders the expanded strip, so a narrow host switches
 * on hydration. A single tab is not a choice: the strip keeps its box and shows nothing.
 */
export function TabStrip<K extends string = string>(props: TabStripProps<K>): JSX.Element {
	const tone = props.tone ?? "header";
	const items: readonly (TabStripItem<K> & { href?: string })[] = props.items;
	const select = props.onSelect;

	const rootRef = useRef<HTMLElement>(null);
	const measureRef = useRef<HTMLSpanElement>(null);
	const prevRef = useRef<HTMLAnchorElement>(null);
	const nextRef = useRef<HTMLAnchorElement>(null);
	const currentItemRef = useRef<HTMLElement>(null);
	const observer = useRef<ResizeObserver | null>(null);
	const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
	const swallowClick = useRef(false);

	const compact = useSignal(false);
	const pickerOpen = useSignal(false);

	// #region Collapse detection
	function measure(): void {
		const root = rootRef.current;
		const strip = measureRef.current;
		if (!root || !strip) return;
		const next = collapses(root, strip.getBoundingClientRect().width, tone, items.length);
		if (next === compact.value) return;
		compact.value = next;
		if (!next) pickerOpen.value = false;
	}

	useLayoutEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		if (typeof ResizeObserver !== "undefined") {
			observer.current ??= new ResizeObserver(() => measure());
			const ro = observer.current;
			ro.disconnect();
			ro.observe(root);
			if (measureRef.current) ro.observe(measureRef.current);
			if (tone === "header" && root.parentElement) {
				ro.observe(root.parentElement);
				const tray = root.nextElementSibling;
				if (tray) {
					ro.observe(tray);
					for (const child of Array.from(tray.children)) ro.observe(child);
				}
			}
		}
		measure();
	});

	useEffect(() => () => observer.current?.disconnect(), []);
	// #endregion

	const found = items.findIndex((t) => t.key === props.activeKey);
	const index = Math.max(0, found);
	const current = items[index];
	const prev = items[stepIndex(index, -1, items.length)];
	const next = items[stepIndex(index, 1, items.length)];
	const single = items.length < 2;
	const tabId = (key: K) => (select && props.panelId ? `${props.panelId}-tab-${key}` : undefined);

	function step(delta: -1 | 1): void {
		if (select) select((delta === 1 ? next : prev).key);
		else (delta === 1 ? nextRef : prevRef).current?.click();
	}

	// #region Swipe (pointer events cover touch, pen and a mouse drag alike)
	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLButtonElement>): void {
		if (e.button !== 0 || !e.isPrimary) return;
		swallowClick.current = false;
		swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
		e.currentTarget.setPointerCapture(e.pointerId);
	}

	function onPointerUp(e: JSX.TargetedPointerEvent<HTMLButtonElement>): void {
		const start = swipe.current;
		swipe.current = null;
		if (!start || start.id !== e.pointerId) return;
		const delta = swipeStep(e.clientX - start.x, e.clientY - start.y);
		if (delta === 0) return;
		swallowClick.current = true;
		step(delta);
	}
	// #endregion

	// #region Expanded
	function onKeyDown(event: KeyboardEvent): void {
		if (!select || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		const tabs = Array.from(
			(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("[role='tab']"),
		);
		const at = tabs.indexOf(event.target as HTMLButtonElement);
		if (at < 0) return;
		event.preventDefault();
		const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === "rtl";
		const forward = (event.key === "ArrowRight") !== rtl;
		const to = event.key === "Home"
			? 0
			: event.key === "End"
			? tabs.length - 1
			: stepIndex(at, forward ? 1 : -1, tabs.length);
		tabs[to].focus();
		select(items[to].key);
	}

	const expanded = items.map((item) => {
		const active = item.key === props.activeKey;
		if (!select) {
			return (
				<a
					key={item.key}
					class="ui-tabstrip__tab"
					href={item.href}
					data-active={active ? "true" : undefined}
					aria-current={active ? "page" : undefined}
				>
					<TabFace item={item} />
				</a>
			);
		}
		return (
			<button
				key={item.key}
				type="button"
				role="tab"
				id={tabId(item.key)}
				aria-controls={props.panelId}
				aria-selected={active}
				tabIndex={active ? 0 : -1}
				class="ui-tabstrip__tab"
				data-active={active ? "true" : undefined}
				onClick={() => select(item.key)}
			>
				<TabFace item={item} />
			</button>
		);
	});
	// #endregion

	// #region Compact
	function stepControl(delta: -1 | 1): JSX.Element {
		const target = delta === 1 ? next : prev;
		const words = `${delta === 1 ? "Next" : "Previous"}: ${target.label}`;
		const glyph = <Icon name={delta === 1 ? "chevron-right" : "chevron-left"} />;
		return (
			<Tooltip content={words} placement="bottom">
				{select
					? (
						<Button
							variant="text"
							severity="secondary"
							size="sm"
							rounded
							iconOnly
							icon={glyph}
							class="ui-tabstrip__step"
							aria-label={words}
							onClick={() => step(delta)}
						/>
					)
					: (
						<a
							ref={delta === 1 ? nextRef : prevRef}
							class="ui-button ui-button--secondary ui-button--text ui-button--size-sm ui-button--rounded ui-button--icon-only ui-tabstrip__step"
							href={target.href}
							aria-label={words}
						>
							<span class="ui-button__icon">{glyph}</span>
						</a>
					)}
			</Tooltip>
		);
	}

	const pending = items.some((t) => t.dot);

	const collapsed = current && (
		<>
			{stepControl(-1)}
			<Popover
				open={pickerOpen}
				placement="bottom"
				label={props.label}
				class="ui-tabstrip__picker"
				initialFocusRef={currentItemRef as RefObject<HTMLElement>}
				trigger={(api) => (
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						rounded
						class="ui-tabstrip__current"
						triggerRef={api.ref as RefObject<HTMLElement>}
						icon={current.icon ? cloneElement(current.icon) : undefined}
						id={tabId(current.key)}
						data-active={found >= 0 ? "true" : undefined}
						aria-haspopup="dialog"
						aria-expanded={api.expanded}
						aria-controls={api.panelId}
						aria-label={`${current.label}${current.hint ? `, ${current.hint}` : ""}, switch view`}
						onPointerDown={onPointerDown}
						onPointerUp={onPointerUp}
						onPointerCancel={() => (swipe.current = null)}
						onClick={() => {
							if (swallowClick.current) {
								swallowClick.current = false;
								return;
							}
							api.toggle();
						}}
					>
						<span class="ui-tabstrip__current-label">{current.label}</span>
						{pending && <span class="ui-tabstrip__dot" aria-hidden="true" />}
						<span class="ui-tabstrip__caret" aria-hidden="true">
							<Icon name="chevron-down" />
						</span>
					</Button>
				)}
			>
				<ul class="ui-tabstrip__menu">
					{items.map((item) => {
						const active = item.key === props.activeKey;
						const face = (
							<>
								<span class="ui-tabstrip__option-icon" aria-hidden="true">
									{item.icon && cloneElement(item.icon)}
								</span>
								<span class="ui-tabstrip__option-label">{item.label}</span>
								{item.dot && <span class="ui-tabstrip__dot" aria-hidden="true" />}
								{item.hint && <span class="ui-visually-hidden">{`, ${item.hint}`}</span>}
								{active && (
									<span class="ui-tabstrip__check" aria-hidden="true">
										<Icon name="check" />
									</span>
								)}
							</>
						);
						return (
							<li key={item.key}>
								{select
									? (
										<button
											type="button"
											ref={active ? (currentItemRef as RefObject<HTMLButtonElement>) : undefined}
											class="ui-tabstrip__option"
											aria-current={active ? "true" : undefined}
											onClick={() => {
												pickerOpen.value = false;
												select(item.key);
											}}
										>
											{face}
										</button>
									)
									: (
										<a
											ref={active ? (currentItemRef as RefObject<HTMLAnchorElement>) : undefined}
											class="ui-tabstrip__option"
											href={item.href}
											aria-current={active ? "page" : undefined}
											onClick={() => (pickerOpen.value = false)}
										>
											{face}
										</a>
									)}
							</li>
						);
					})}
				</ul>
			</Popover>
			{stepControl(1)}
		</>
	);
	// #endregion

	const measureCopy = (
		<span class="ui-tabstrip__measure" aria-hidden="true">
			<span ref={measureRef} class="ui-tabstrip__measure-row">
				{items.map((item) => (
					<span key={item.key} class="ui-tabstrip__tab">
						<TabFace item={item} />
					</span>
				))}
			</span>
		</span>
	);

	const className = cx(
		"ui-tabstrip",
		`ui-tabstrip--${tone}`,
		compact.value && "ui-tabstrip--compact",
		single && "ui-tabstrip--single",
		props.class,
	);
	const body = compact.value && current ? collapsed : expanded;

	if (!select) {
		return (
			<nav
				ref={rootRef}
				class={className}
				aria-label={props.label}
				aria-hidden={single ? "true" : undefined}
			>
				{body}
				{measureCopy}
			</nav>
		);
	}
	return (
		<div
			ref={rootRef as RefObject<HTMLDivElement>}
			class={className}
			role={compact.value ? "group" : "tablist"}
			aria-label={props.label}
			aria-hidden={single ? "true" : undefined}
			onKeyDown={onKeyDown}
		>
			{body}
			{measureCopy}
		</div>
	);
}

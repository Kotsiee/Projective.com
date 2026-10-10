import { cloneElement, type JSX, type RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { Popover } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { cx } from "@ui/core/cx.ts";
import { shouldCollapseTabs, stepIndex, swipeStep } from "../core/tab-strip.ts";

/**
 * ChannelTabStrip — the centre region of a `.chan-header` (the project `ChannelHeader` and the
 * messaging `ConversationHeader` both mount it): the underlined view tabs, with a responsive overflow
 * collapse.
 *
 * EXPANDED (the desktop default) it renders exactly the strip the headers always rendered — real anchors,
 * URL-driven `data-active` underline. COMPACT takes over when the full strip would collide with the
 * trailing `.chan-header__actions`: only the active tab shows, centred, without its underline, between
 * a `prev` and a `next` chevron that step circularly through the tabs (never disabled). Pressing the
 * active tab opens a picker listing every tab; a horizontal swipe on it steps like the chevrons.
 *
 * The decision is MEASURED, not a viewport query, so it follows the real header width (lane, docked
 * panel, labels that change with the dev Context Switcher). A hidden, zero-size `aria-hidden` copy of
 * the full strip is always mounted and styled by the same `.chan-tab` rules as the live one, so its
 * natural width is known in either layout; a `ResizeObserver` on it, the header and every action
 * control re-runs {@link shouldCollapseTabs}. The server renders EXPANDED (it cannot measure), so a
 * narrow header switches to compact on hydration.
 *
 * Every step control is an anchor to the target tab, and a swipe clicks that same anchor — so stepping
 * is ordinary navigation by one code path, whatever triggered it. The compact active control keeps
 * `.chan-tab[data-tab-key][data-active]`, which `chat-composer.css` keys the Chat canvas off via `:has`.
 *
 * A single tab is not a choice, so `--single` hides the strip's contents while the nav stays as the
 * empty centre spacer and the active tab stays in the DOM for that `:has` hook.
 */

// #region Props
/** One view tab, resolved by the host header (its href and its glyph). */
export interface ChannelTabItem {
	key: string;
	label: string;
	href: string;
	/** A shared glyph VNode — cloned at each render site here (the Preact VNode-reuse hazard). */
	icon: JSX.Element;
}

export interface ChannelTabStripProps {
	/** The visible tabs, in display order. */
	tabs: ChannelTabItem[];
	/** The URL-resolved active tab key. */
	activeKey: string;
	/** Accessible name of the tab navigation (e.g. "Channel views"). */
	label: string;
}
// #endregion

// #region Measurement
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
// #endregion

export function ChannelTabStrip({ tabs, activeKey, label }: ChannelTabStripProps): JSX.Element {
	const navRef = useRef<HTMLElement>(null);
	const measureRef = useRef<HTMLSpanElement>(null);
	const prevRef = useRef<HTMLAnchorElement>(null);
	const nextRef = useRef<HTMLAnchorElement>(null);
	const currentItemRef = useRef<HTMLAnchorElement>(null);
	const observer = useRef<ResizeObserver | null>(null);
	const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
	const swallowClick = useRef(false);

	const compact = useSignal(false);
	const pickerOpen = useSignal(false);

	// #region Collapse detection
	function measure(): void {
		const nav = navRef.current;
		const strip = measureRef.current;
		const header = nav?.closest<HTMLElement>(".chan-header");
		if (!nav || !strip || !header) return;
		const cs = getComputedStyle(header);
		const tray = header.querySelector(":scope > .chan-header__actions");
		const next = shouldCollapseTabs({
			headerInner: header.clientWidth - (parseFloat(cs.paddingInlineStart) || 0) -
				(parseFloat(cs.paddingInlineEnd) || 0),
			tabsNatural: strip.getBoundingClientRect().width,
			actionsContent: tray ? trayContentWidth(tray) : 0,
			gap: parseFloat(cs.columnGap) || 0,
		}, tabs.length);
		if (next !== compact.value) {
			compact.value = next;
			if (!next) pickerOpen.value = false;
		}
	}

	// Re-sync the observed set on every render: the tab set (dev Context Switcher) and the action tray
	// (Details toggle on/off, `--desktop` controls hidden by the breakpoint) both change under us.
	useLayoutEffect(() => {
		const nav = navRef.current;
		const header = nav?.closest(".chan-header");
		if (!nav || !header) return;
		if (typeof ResizeObserver !== "undefined") {
			observer.current ??= new ResizeObserver(() => measure());
			const ro = observer.current;
			ro.disconnect();
			ro.observe(header);
			if (measureRef.current) ro.observe(measureRef.current);
			const tray = header.querySelector(":scope > .chan-header__actions");
			if (tray) {
				ro.observe(tray);
				for (const child of Array.from(tray.children)) ro.observe(child);
			}
		}
		measure();
	});

	useEffect(() => () => observer.current?.disconnect(), []);
	// #endregion

	const found = tabs.findIndex((t) => t.key === activeKey);
	const index = Math.max(0, found);
	const current = tabs[index];
	const prev = tabs[stepIndex(index, -1, tabs.length)];
	const next = tabs[stepIndex(index, 1, tabs.length)];
	const single = tabs.length < 2;

	// #region Swipe (pointer events cover touch, pen and a mouse drag alike)
	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLButtonElement>): void {
		if (e.button !== 0) return;
		swallowClick.current = false;
		swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
		// Capture so the release lands here even if the finger drifts off the label; it throws for a
		// pointer that is no longer active, which only costs the capture.
		try {
			e.currentTarget.setPointerCapture(e.pointerId);
		} catch { /* not capturable — the swipe still resolves if released over the label */ }
	}

	function onPointerUp(e: JSX.TargetedPointerEvent<HTMLButtonElement>): void {
		const start = swipe.current;
		swipe.current = null;
		if (!start || start.id !== e.pointerId) return;
		const step = swipeStep(e.clientX - start.x, e.clientY - start.y);
		if (step === 0) return;
		// The press ends in a click on this same button; it must not also open the picker.
		swallowClick.current = true;
		(step === 1 ? nextRef : prevRef).current?.click();
	}

	function onPointerCancel(): void {
		swipe.current = null;
	}
	// #endregion

	return (
		<nav
			ref={navRef}
			class={cx(
				"chan-header__tabs",
				compact.value && "chan-header__tabs--compact",
				single && "chan-header__tabs--single",
			)}
			aria-label={label}
			aria-hidden={single ? "true" : undefined}
		>
			{compact.value && current
				? (
					<>
						<a
							ref={prevRef}
							class="chan-tabstep"
							href={prev.href}
							aria-label={`Previous tab: ${prev.label}`}
						>
							<Icon name="chevron-left" />
						</a>

						<Popover
							open={pickerOpen}
							placement="bottom"
							label={label}
							class="chan-menu-pop"
							initialFocusRef={currentItemRef as RefObject<HTMLElement>}
							trigger={(api) => (
								<button
									type="button"
									ref={api.ref as RefObject<HTMLButtonElement>}
									class="chan-tab chan-tab--compact"
									data-tab-key={current.key}
									data-active={found >= 0 ? "true" : undefined}
									aria-haspopup="dialog"
									aria-expanded={api.expanded}
									aria-controls={api.panelId}
									aria-label={`${current.label}, switch view`}
									onPointerDown={onPointerDown}
									onPointerUp={onPointerUp}
									onPointerCancel={onPointerCancel}
									onClick={() => {
										if (swallowClick.current) {
											swallowClick.current = false;
											return;
										}
										api.toggle();
									}}
								>
									<span class="chan-tab__icon" aria-hidden="true">
										{cloneElement(current.icon)}
									</span>
									<span class="chan-tab__label">{current.label}</span>
								</button>
							)}
						>
							<ul class="chan-menu chan-menu--views">
								{tabs.map((tab) => {
									const active = tab.key === activeKey;
									return (
										<li key={tab.key}>
											<a
												ref={active ? currentItemRef : undefined}
												class="chan-menu__item"
												href={tab.href}
												aria-current={active ? "page" : undefined}
												onClick={() => (pickerOpen.value = false)}
											>
												<span class="chan-menu__icon" aria-hidden="true">
													{cloneElement(tab.icon)}
												</span>
												<span class="chan-menu__label">{tab.label}</span>
												{active && (
													<span class="chan-menu__check" aria-hidden="true">
														<Icon name="check" />
													</span>
												)}
											</a>
										</li>
									);
								})}
							</ul>
						</Popover>

						<a
							ref={nextRef}
							class="chan-tabstep"
							href={next.href}
							aria-label={`Next tab: ${next.label}`}
						>
							<Icon name="chevron-right" />
						</a>
					</>
				)
				: tabs.map((tab) => {
					const active = tab.key === activeKey;
					return (
						<a
							key={tab.key}
							class="chan-tab"
							href={tab.href}
							data-active={active ? "true" : undefined}
							aria-current={active ? "page" : undefined}
							data-tab-key={tab.key}
						>
							<span class="chan-tab__icon" aria-hidden="true">{cloneElement(tab.icon)}</span>
							<span class="chan-tab__label">{tab.label}</span>
						</a>
					);
				})}

			{
				/* The full strip's natural width, measured in either layout. Zero-size and clipped, so it
			    never adds scrollable overflow; no anchors, no data attributes, nothing to announce. */
			}
			<span class="chan-header__measure" aria-hidden="true">
				<span ref={measureRef} class="chan-header__measure-strip">
					{tabs.map((tab) => (
						<span key={tab.key} class="chan-tab">
							<span class="chan-tab__icon">{cloneElement(tab.icon)}</span>
							<span class="chan-tab__label">{tab.label}</span>
						</span>
					))}
				</span>
			</span>
		</nav>
	);
}

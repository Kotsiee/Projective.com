import type { JSX, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import { Popover } from "@projective/ui/feedback";
import "../styles/profile.css";
import { arrangeTabs, TAB_LABEL, tabHref } from "../core/profile-model.ts";
import { ProfileIcon, tabIcon } from "../components/profile-glyphs.tsx";
import type { ProfileTab, ProfileView } from "../types/profile-types.ts";

/**
 * ProfileTabs — the entity-driven tab bar (root CLAUDE.md Part 2/3). The tab set comes from
 * {@link tabsFor} on {@link ProfileView.kind}; each tab is a real anchor into its `/[handle]/<tab>`
 * sub-route (URL-driven active state, so deep-links + refresh land right). Underlined-text tabs, NOT
 * boxed pills (§B.4 / §D.4): a 2px `--primary` underline marks the active tab on the shared hairline.
 *
 * It is an island for a genuinely **width-aware** overflow (Part 3): a `ResizeObserver` on the strip
 * plus a one-time measurement of each tab's natural width let it fit **as many tabs as the current
 * container width allows** and collapse the rest into a portal **`More ▾`** dropdown — recomputed live
 * as the lane resizes. **Reviews stays pinned** as the last always-visible content tab, and the **More
 * trigger sits on the absolute far right** of the bar (both right-aligned via `margin-inline-start`).
 * Rendering all tabs inline is the SSR / no-JS fallback (nothing is hidden until JS measures).
 */
export interface ProfileTabsProps {
	profile: ProfileView;
	active: ProfileTab | null;
}

/** Natural width (px) reserved for the `More ▾` control before it has been measured for real. */
const MORE_ESTIMATE = 84;
/** A couple of pixels of slack so a tab that just barely fits is never clipped by rounding. */
const FIT_SLACK = 2;

export default function ProfileTabs({ profile, active }: ProfileTabsProps): JSX.Element {
	// Reviews is pinned to the right (Decision #40) and never enters the overflow menu; every other tab
	// is a "content" tab that may collapse into `More ▾` when the bar is too narrow.
	const { content, trailing } = arrangeTabs(profile.kind);

	const nav = useRef<HTMLElement>(null);
	const menuOpen = useSignal(false);

	// Measured geometry. `widths` is captured once (tab labels are static, so natural widths are stable);
	// `containerW` tracks the live strip width via the ResizeObserver. `ready` gates the collapse so the
	// SSR/first paint shows every tab inline until we have real measurements.
	const widths = useRef<Map<ProfileTab, number>>(new Map());
	const gap = useRef<number>(4);
	const moreW = useRef<number>(MORE_ESTIMATE);
	const reviewsW = useRef<number>(0);
	const containerW = useSignal(0);
	const ready = useSignal(false);
	// Bumped after a real `More ▾` width is measured, so the split recomputes with the true reserve.
	const revision = useSignal(0);

	// Refs for the measurement pass — every content tab, plus the trailing Reviews item.
	const itemRefs = useRef<Map<ProfileTab, HTMLLIElement>>(new Map());
	const moreRef = useRef<HTMLLIElement>(null);

	/**
	 * Measure natural widths whenever `ready` is false — the initial paint (all tabs inline) and after a
	 * label-breakpoint flip forces a fresh pass. Tab labels hide below 768px (a CSS media query), so a
	 * width cached on one side of that breakpoint is wrong on the other; re-measuring keeps the split
	 * honest. Runs against the all-inline render (every content tab + Reviews present with refs).
	 */
	useEffect(() => {
		if (ready.value) return;
		const el = nav.current;
		if (!el) return;
		const list = el.querySelector<HTMLElement>(".pf-tabs__list");
		if (list) {
			const g = parseFloat(getComputedStyle(list).columnGap || "");
			if (Number.isFinite(g)) gap.current = g;
		}
		for (const tab of content) {
			const node = itemRefs.current.get(tab);
			if (node) widths.current.set(tab, node.offsetWidth);
		}
		const reviewsNode = trailing[0] ? itemRefs.current.get(trailing[0]) : null;
		reviewsW.current = reviewsNode ? reviewsNode.offsetWidth : 0;

		containerW.value = el.clientWidth;
		ready.value = true;
	}, [ready.value]);

	/** Track the live strip width + the label breakpoint; a breakpoint flip forces a re-measure. */
	useEffect(() => {
		const el = nav.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) containerW.value = entry.contentRect.width;
		});
		ro.observe(el);
		const mq = globalThis.matchMedia?.("(min-width: 768px)");
		const remeasure = () => (ready.value = false);
		mq?.addEventListener?.("change", remeasure);
		return () => {
			ro.disconnect();
			mq?.removeEventListener?.("change", remeasure);
		};
	}, []);

	/** Once `More ▾` is actually shown, capture its real width and recompute with the true reserve. */
	useEffect(() => {
		if (!moreRef.current) return;
		const w = moreRef.current.offsetWidth;
		if (w > 0 && Math.abs(w - moreW.current) > 1) {
			moreW.current = w;
			revision.value++;
		}
	});

	/** Greedily fit content tabs into the live width, reserving Reviews + (if needed) the `More ▾` control. */
	const split = useComputed<{ visible: ProfileTab[]; overflow: ProfileTab[] }>(() => {
		// Depend on the measured revision so a refined `More ▾` width re-runs the split.
		revision.value;
		if (!ready.value || containerW.value <= 0) return { visible: content, overflow: [] };

		const g = gap.current;
		const rw = reviewsW.current;
		const baseAvail = containerW.value - (rw ? rw + g : 0) - FIT_SLACK;

		const fitInto = (avail: number): number => {
			let used = 0;
			let count = 0;
			for (const tab of content) {
				const w = widths.current.get(tab) ?? 0;
				const next = used + (count > 0 ? g : 0) + w;
				if (next > avail) break;
				used = next;
				count++;
			}
			return count;
		};

		// Everything fits without a More control → no overflow.
		if (fitInto(baseAvail) === content.length) {
			return { visible: content, overflow: [] };
		}
		// Otherwise reserve the More control and fit what remains.
		const withMore = baseAvail - (moreW.current + g);
		const count = fitInto(withMore);
		return { visible: content.slice(0, count), overflow: content.slice(count) };
	});

	const overflowActive = useComputed(() => active != null && split.value.overflow.includes(active));

	function setItemRef(tab: ProfileTab): (node: HTMLLIElement | null) => void {
		return (node) => {
			if (node) itemRefs.current.set(tab, node);
			else itemRefs.current.delete(tab);
		};
	}

	function tabLink(tab: ProfileTab): JSX.Element {
		const isActive = active === tab;
		return (
			<li class="pf-tabs__item" key={tab} ref={setItemRef(tab)}>
				<a
					class="pf-tab"
					href={tabHref(profile.handle, tab)}
					data-active={isActive ? "true" : undefined}
					aria-current={isActive ? "page" : undefined}
				>
					<span class="pf-tab__icon" aria-hidden="true">{tabIcon(tab)}</span>
					<span class="pf-tab__label">{TAB_LABEL[tab]}</span>
				</a>
			</li>
		);
	}

	return (
		<nav class="pf-tabs" aria-label="Profile sections" ref={nav}>
			<ul class="pf-tabs__list" role="list">
				{split.value.visible.map(tabLink)}

				{trailing.map((tab) => (
					<li class="pf-tabs__item pf-tabs__item--trailing" key={tab} ref={setItemRef(tab)}>
						<a
							class="pf-tab"
							href={tabHref(profile.handle, tab)}
							data-active={active === tab ? "true" : undefined}
							aria-current={active === tab ? "page" : undefined}
						>
							<span class="pf-tab__icon" aria-hidden="true">{tabIcon(tab)}</span>
							<span class="pf-tab__label">{TAB_LABEL[tab]}</span>
						</a>
					</li>
				))}

				{split.value.overflow.length
					? (
						<li class="pf-tabs__item pf-tabs__item--more" key="__more" ref={moreRef}>
							<Popover
								open={menuOpen}
								placement="bottom-end"
								class="pf-menu"
								trigger={(api) => (
									<button
										type="button"
										ref={api.ref as RefObject<HTMLButtonElement>}
										class="pf-tab pf-tab--more"
										data-active={overflowActive.value ? "true" : undefined}
										data-open={api.expanded ? "true" : undefined}
										aria-haspopup="menu"
										aria-expanded={api.expanded}
										aria-controls={api.panelId}
										onClick={api.toggle}
									>
										<span class="pf-tab__label">More</span>
										<ProfileIcon name="chevron" class="pf-tab__more-caret" />
									</button>
								)}
							>
								{split.value.overflow.map((tab) => (
									<a
										key={tab}
										role="menuitem"
										class="pf-tabs__menu-item"
										href={tabHref(profile.handle, tab)}
										data-active={active === tab ? "true" : undefined}
										aria-current={active === tab ? "page" : undefined}
										onClick={() => (menuOpen.value = false)}
									>
										<span class="pf-tabs__menu-icon" aria-hidden="true">{tabIcon(tab)}</span>
										<span>{TAB_LABEL[tab]}</span>
									</a>
								))}
							</Popover>
						</li>
					)
					: null}
			</ul>
		</nav>
	);
}

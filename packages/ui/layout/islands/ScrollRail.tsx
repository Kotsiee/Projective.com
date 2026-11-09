import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import "../styles/scrollrail.css";
import { cx } from "../../core/cx.ts";
import { prefersJumpToFinal } from "../../core/motion.ts";
import { Icon } from "../../icons/mod.ts";
import { Tooltip } from "../../feedback/islands/Tooltip.tsx";
import { type RailEdges, railEdges, railPage, railWheelDelta } from "../core/scroll-rail.ts";

// #region Types
/** Props for {@link ScrollRail}. */
export interface ScrollRailProps {
	/** Accessible name of the list. */
	label: string;
	/** The rail's items, each an `<li>`. */
	children: ComponentChildren;
	/** Name of the arrow toward the start (default `"Scroll back"`). */
	backLabel?: string;
	/** Name of the arrow toward the end (default `"Scroll forward"`). */
	forwardLabel?: string;
	class?: string;
	/** Extra class(es) on the `<ul>` track. */
	trackClass?: string;
}
// #endregion

const FLAT: RailEdges = { back: false, forward: false };

const FOCUSABLE = "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

function pitchOf(track: HTMLElement): number {
	const [first, second] = Array.from(track.children) as HTMLElement[];
	if (!first) return 0;
	if (!second) return first.getBoundingClientRect().width;
	return Math.abs(second.getBoundingClientRect().left - first.getBoundingClientRect().left);
}

function isRtl(el: Element): boolean {
	return getComputedStyle(el).direction === "rtl";
}

/**
 * ScrollRail — a single row of items that scrolls along its inline axis when it outgrows its box.
 *
 * Nothing changes while everything fits. Once it overflows, the rail reserves a gutter at each end
 * and shows an arrow in a gutter only while items are hidden on that side (a control that renders
 * must act). An arrow pages by the whole items that fit, less one, with smooth scrolling that jumps
 * under either reduced-motion channel. The gutters stay reserved for as long as the rail overflows,
 * so scrolling never moves the track's edges, and reserving them can only add overflow, so the
 * decision cannot oscillate.
 *
 * A vertical wheel turn over the rail scrolls it sideways until it reaches that end, then the page
 * takes the wheel again; touch swipes natively and snaps to items on coarse pointers. Items stay in
 * the tab order and scroll into view on focus, so the arrows are a pointer convenience: an arrow that
 * disappears while it holds focus hands focus to the item at that end. Direction-aware throughout.
 */
export function ScrollRail(props: ScrollRailProps): JSX.Element {
	const {
		label,
		children,
		backLabel = "Scroll back",
		forwardLabel = "Scroll forward",
		class: className,
		trackClass,
	} = props;

	const trackRef = useRef<HTMLUListElement>(null);
	const backRef = useRef<HTMLDivElement>(null);
	const forwardRef = useRef<HTMLDivElement>(null);
	const observer = useRef<ResizeObserver | null>(null);

	const edges = useSignal<RailEdges>(FLAT);
	const overflow = useSignal(false);

	// #region Measurement
	function handOff(end: "start" | "end"): void {
		const track = trackRef.current;
		const item = end === "end" ? track?.lastElementChild : track?.firstElementChild;
		item?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
	}

	function measure(): void {
		const track = trackRef.current;
		if (!track) return;
		const next = railEdges({
			scrollLeft: track.scrollLeft,
			clientWidth: track.clientWidth,
			scrollWidth: track.scrollWidth,
		});
		const focused = typeof document === "undefined" ? null : document.activeElement;
		if (!next.forward && focused && forwardRef.current?.contains(focused)) handOff("end");
		if (!next.back && focused && backRef.current?.contains(focused)) handOff("start");
		const prev = edges.peek();
		if (prev.back !== next.back || prev.forward !== next.forward) edges.value = next;
		const overflowing = next.back || next.forward;
		if (overflowing !== overflow.peek()) overflow.value = overflowing;
	}

	useLayoutEffect(() => {
		const track = trackRef.current;
		if (!track) return;
		if (typeof ResizeObserver !== "undefined") {
			observer.current ??= new ResizeObserver(() => measure());
			const ro = observer.current;
			ro.disconnect();
			ro.observe(track);
			for (const child of Array.from(track.children)) ro.observe(child);
		}
		measure();
	});

	useEffect(() => {
		const track = trackRef.current;
		if (!track) return;
		const onScroll = () => measure();
		const onWheel = (e: WheelEvent) => {
			const delta = railWheelDelta(e, edges.peek(), isRtl(track), track.clientWidth);
			if (delta === 0) return;
			e.preventDefault();
			track.scrollBy({ left: delta, behavior: "auto" });
		};
		track.addEventListener("scroll", onScroll, { passive: true });
		track.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			track.removeEventListener("scroll", onScroll);
			track.removeEventListener("wheel", onWheel);
			observer.current?.disconnect();
		};
	}, []);
	// #endregion

	function step(dir: -1 | 1): void {
		const track = trackRef.current;
		if (!track) return;
		const distance = railPage(track.clientWidth, pitchOf(track));
		track.scrollBy({
			left: dir * (isRtl(track) ? -1 : 1) * distance,
			behavior: prefersJumpToFinal() ? "auto" : "smooth",
		});
	}

	function arrow(dir: -1 | 1): JSX.Element {
		const words = dir === 1 ? forwardLabel : backLabel;
		return (
			<div
				ref={dir === 1 ? forwardRef : backRef}
				class={cx(
					"ui-scrollrail__edge",
					dir === 1 ? "ui-scrollrail__edge--forward" : "ui-scrollrail__edge--back",
				)}
			>
				<Tooltip content={words}>
					<button
						type="button"
						class="ui-scrollrail__step"
						aria-label={words}
						onClick={() => step(dir)}
					>
						<Icon name={dir === 1 ? "chevron-right" : "chevron-left"} size="sm" />
					</button>
				</Tooltip>
			</div>
		);
	}

	const { back, forward } = edges.value;
	return (
		<div
			class={cx("ui-scrollrail", className)}
			data-overflow={overflow.value ? "true" : undefined}
		>
			{back ? arrow(-1) : null}
			<ul ref={trackRef} class={cx("ui-scrollrail__track", trackClass)} aria-label={label}>
				{children}
			</ul>
			{forward ? arrow(1) : null}
		</div>
	);
}

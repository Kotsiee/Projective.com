/**
 * @projective/ui/calendar — the calendar's overlay scrollbar (a depth gauge that a press turns into a
 * joystick lever). Renders the track + handle for {@link useOverlayScrollbar} over a natively-scrolling
 * container, replacing the global native-styled bar for THIS surface only (`calendar.css` opts
 * `.cal-tg__scroll` out at class specificity, which the global rule's `:not(html):not(body)` cannot
 * beat).
 *
 * It is an overlay, so it reserves no layout width — which also closes the long-standing
 * header↔column misalignment, where the day-of-week header row sat outside the scroller and was
 * offset from its columns by the native scrollbar's reserved gutter.
 *
 * EVERY GEOMETRIC VALUE IS WRITTEN HERE AS A RESOLVED NUMBER. The handle's offset and length are
 * measurements; the ball's morph is a spring value the hook has already integrated; the ball's throw is
 * read off the pointer event itself. None of the four is a CSS transition, because rAF, transitions and
 * keyframes are all frozen in a hidden or background tab and a control stranded between two shapes is a
 * control the reader cannot read. `styles/chrome.css` spends them on `transform`/`opacity` alone.
 *
 * ACCESSIBILITY. The track is `aria-hidden` and the handle is not focusable, matching `ScrollPanel`:
 * a scrollbar is a pointer affordance, and duplicating it in the accessibility tree would announce a
 * control that adds nothing over the container's own keyboard scrolling. The container therefore has
 * to stay reachable — its owner gives it `tabindex` + an accessible name.
 */
import type { JSX, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { forwardWheel, useOverlayScrollbar } from "../hooks/useOverlayScrollbar.ts";

export interface OverlayScrollbarProps {
	/** The natively-scrolling container this bar mirrors and drives. */
	scrollRef: RefObject<HTMLElement>;
	/**
	 * Read inside a signal effect: touch any signal whose change should re-measure the bar — typically
	 * the viewport's `scrollTop` + `contentHeight`, so a zoom or a programmatic scroll updates it even
	 * where the async `scroll` event is deferred.
	 */
	revalidate?: () => unknown;
	/**
	 * One PERIOD's height in content pixels — `pxPerHour * 24` for a day, a week's block for the Week
	 * grid. It is what makes the handle's LENGTH a live reflection of viewport scale; omit it and the
	 * handle keeps its depth-encoded length instead of claiming a scale nobody has established.
	 */
	periodPx?: number;
	/** Idle delay (ms) before the bar fades out. */
	idleMs?: number;
	/**
	 * Pointer-downs the bar declines (middle button, Ctrl/Meta) are handed back here, so the container's
	 * own pan gesture still fires when the pointer happens to be over the overlay strip.
	 */
	onPassthroughPointerDown?: (e: PointerEvent) => void;
	class?: string;
}

export function OverlayScrollbar(props: OverlayScrollbarProps): JSX.Element {
	const trackRef = useRef<HTMLDivElement>(null);
	const bar = useOverlayScrollbar({
		scrollRef: props.scrollRef,
		trackRef,
		revalidate: props.revalidate,
		periodPx: props.periodPx,
		idleMs: props.idleMs,
	});

	// A wheel over the handle must scroll the container beneath it, not chain to the page. The listener
	// sits on the track (wheel bubbles from the handle) and is non-passive so it can preventDefault.
	useEffect(() => {
		const track = trackRef.current;
		if (!track) return;
		const onWheel = (e: WheelEvent) => {
			const el = props.scrollRef.current;
			if (!el) return;
			forwardWheel(el, e);
			bar.measure();
			bar.reveal();
		};
		track.addEventListener("wheel", onWheel, { passive: false });
		return () => track.removeEventListener("wheel", onWheel);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div
			ref={trackRef}
			class={cx(
				"cal-bar",
				(bar.visible.value || bar.dragging.value) && "cal-bar--on",
				bar.dragging.value && "cal-bar--dragging",
				props.class,
			)}
			aria-hidden="true"
		>
			{bar.needed.value
				? (
					<div
						class="cal-bar__handle"
						style={styleVars({
							"--cal-bar-top": `${bar.offset.value}px`,
							"--cal-bar-h": `${bar.length.value}px`,
							// Unitless, because the sheet spends it as BOTH a `scale()` factor and an
							// `opacity` — `styles/shell.css` documents this property as written from here as
							// a resolved number, and this is the write that makes that true.
							"--cal-bar-morph": `${bar.morph.value}`,
							"--cal-bar-throw": `${bar.throwPx.value}px`,
						})}
						onPointerDown={(e) => {
							const ev = e as unknown as PointerEvent;
							if (ev.button !== 0 || ev.ctrlKey || ev.metaKey) {
								props.onPassthroughPointerDown?.(ev);
								return;
							}
							bar.onHandlePointerDown(ev);
						}}
						onPointerEnter={bar.onHandlePointerEnter}
						onPointerLeave={bar.onHandlePointerLeave}
					/>
				)
				: null}
		</div>
	);
}

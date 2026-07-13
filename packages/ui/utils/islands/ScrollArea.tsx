import type { ComponentChildren, JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import "../styles/scroll-area.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";

// #region Props
/** Which axes the custom scrollbars are shown for. */
export type ScrollOrientation = "vertical" | "horizontal" | "both";

/** Scrollbar visibility policy. */
export type ScrollAreaType = "hover" | "always" | "auto";

/** Props for {@link ScrollArea}. */
export interface ScrollAreaProps {
	/** Axes to virtualise the scrollbar for (default `vertical`). */
	orientation?: ScrollOrientation;
	/**
	 * `hover` shows the bars on hover/scroll then auto-hides; `auto` shows them while scrolling and
	 * hides when idle; `always` keeps them while content overflows (default `hover`).
	 */
	type?: ScrollAreaType;
	/** Accessible label for the scroll region. */
	"aria-label"?: string;
	/** Scrollable content. */
	children?: ComponentChildren;
	class?: string;
}

interface Metrics {
	vThumb: number;
	vTop: number;
	hThumb: number;
	hLeft: number;
	vOverflow: boolean;
	hOverflow: boolean;
}
// #endregion

const IDLE_MS = 900;

/**
 * ScrollArea — a container that replaces the native scrollbars with thin, token-styled, draggable
 * thumbs on either axis. The viewport scrolls natively (wheel, keyboard arrows/Page/Home/End all work
 * because it is a focusable `region`), while overlay thumbs mirror the scroll position and can be
 * dragged to scroll. Bars auto-hide per `type`. The viewport is exposed as a labelled scroll
 * `region`; the decorative thumbs are `aria-hidden`. SSR renders the content; thumbs appear on
 * hydration.
 */
export function ScrollArea(props: ScrollAreaProps): JSX.Element {
	const {
		orientation = "vertical",
		type = "hover",
		"aria-label": ariaLabel,
		children,
		class: className,
	} = props;

	const viewportRef = useRef<HTMLDivElement>(null);
	const [m, setM] = useState<Metrics>({
		vThumb: 0,
		vTop: 0,
		hThumb: 0,
		hLeft: 0,
		vOverflow: false,
		hOverflow: false,
	});
	const [active, setActive] = useState(false);
	const idleTimer = useRef<number | undefined>(undefined);

	const showV = orientation !== "horizontal";
	const showH = orientation !== "vertical";

	// #region Measurement
	const measure = useCallback(() => {
		const el = viewportRef.current;
		if (!el) return;
		const { scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth } = el;
		const vOverflow = scrollHeight > clientHeight + 1;
		const hOverflow = scrollWidth > clientWidth + 1;
		setM({
			vThumb: vOverflow ? Math.max((clientHeight / scrollHeight) * clientHeight, 24) : 0,
			vTop: vOverflow ? (scrollTop / scrollHeight) * clientHeight : 0,
			hThumb: hOverflow ? Math.max((clientWidth / scrollWidth) * clientWidth, 24) : 0,
			hLeft: hOverflow ? (scrollLeft / scrollWidth) * clientWidth : 0,
			vOverflow,
			hOverflow,
		});
	}, []);

	useEffect(() => {
		measure();
		const el = viewportRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		for (const child of Array.from(el.children)) ro.observe(child);
		return () => ro.disconnect();
	}, [measure]);
	// #endregion

	// #region Idle / activity
	const flash = useCallback(() => {
		if (type === "always") return;
		setActive(true);
		if (idleTimer.current) clearTimeout(idleTimer.current);
		idleTimer.current = setTimeout(() => setActive(false), IDLE_MS) as unknown as number;
	}, [type]);

	const onScroll = () => {
		measure();
		flash();
	};
	// #endregion

	// #region Thumb dragging
	const dragThumb = (axis: "v" | "h") => (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const el = viewportRef.current;
		if (!el) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const startPos = axis === "v" ? e.clientY : e.clientX;
		const startScroll = axis === "v" ? el.scrollTop : el.scrollLeft;
		const track = axis === "v" ? el.clientHeight : el.clientWidth;
		const content = axis === "v" ? el.scrollHeight : el.scrollWidth;
		const ratio = content / track;

		const onMove = (ev: PointerEvent) => {
			const delta = (axis === "v" ? ev.clientY : ev.clientX) - startPos;
			if (axis === "v") el.scrollTop = startScroll + delta * ratio;
			else el.scrollLeft = startScroll + delta * ratio;
		};
		const onUp = (ev: PointerEvent) => {
			(e.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
			globalThis.removeEventListener("pointermove", onMove);
			globalThis.removeEventListener("pointerup", onUp);
		};
		globalThis.addEventListener("pointermove", onMove);
		globalThis.addEventListener("pointerup", onUp);
	};
	// #endregion

	return (
		<div
			class={cx(
				"ui-scroll-area",
				`ui-scroll-area--${type}`,
				(active || type === "always") && "ui-scroll-area--active",
				className,
			)}
			onMouseEnter={type === "hover" ? () => setActive(true) : undefined}
			onMouseLeave={type === "hover" ? () => setActive(false) : undefined}
		>
			<div
				ref={viewportRef}
				class="ui-scroll-area__viewport"
				role="region"
				aria-label={ariaLabel}
				tabIndex={0}
				onScroll={onScroll}
			>
				{children}
			</div>

			{showV && m.vOverflow && (
				<div class="ui-scroll-area__bar ui-scroll-area__bar--v" aria-hidden="true">
					<div
						class="ui-scroll-area__thumb"
						style={styleVars({ "--thumb-size": `${m.vThumb}px`, "--thumb-pos": `${m.vTop}px` })}
						onPointerDown={dragThumb("v")}
					/>
				</div>
			)}
			{showH && m.hOverflow && (
				<div class="ui-scroll-area__bar ui-scroll-area__bar--h" aria-hidden="true">
					<div
						class="ui-scroll-area__thumb"
						style={styleVars({ "--thumb-size": `${m.hThumb}px`, "--thumb-pos": `${m.hLeft}px` })}
						onPointerDown={dragThumb("h")}
					/>
				</div>
			)}
		</div>
	);
}

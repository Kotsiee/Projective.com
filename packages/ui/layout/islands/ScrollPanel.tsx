import type { ComponentChildren, CSSProperties, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/scrollpanel.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";

// #region Types
interface ThumbMetrics {
	size: number;
	offset: number;
	needed: boolean;
}

const NONE: ThumbMetrics = { size: 0, offset: 0, needed: false };
const MIN_THUMB = 24;

export interface ScrollPanelProps {
	/** Viewport block size (any CSS length, e.g. `"320px"`, `"50vh"`). Required to bound scrolling. */
	scrollHeight?: string;
	/** Accessible name for the scrollable region. */
	"aria-label"?: string;
	id?: string;
	class?: string;
	style?: CSSProperties;
	children?: ComponentChildren;
}
// #endregion

/**
 * ScrollPanel — a scrolling viewport with token-styled custom scrollbars on both axes. The native
 * scrollbar is hidden but the region scrolls natively (`overflow: auto`), so wheel, touch, and
 * keyboard scrolling (the viewport is focusable) all work out of the box; draggable custom thumbs
 * mirror the native scroll position and write it back on drag. Falls back to plain native scrolling
 * if `ResizeObserver` is unavailable (SSR / older engines) by simply never showing custom thumbs.
 */
export function ScrollPanel(props: ScrollPanelProps): JSX.Element {
	const { scrollHeight, "aria-label": ariaLabel, id, class: className, style, children } = props;

	const viewportRef = useRef<HTMLDivElement>(null);
	const xThumb = useSignal<ThumbMetrics>(NONE);
	const yThumb = useSignal<ThumbMetrics>(NONE);
	const dragAxis = useRef<"x" | "y" | null>(null);
	const dragStart = useRef({ pointer: 0, scroll: 0 });

	// #region Measurement
	const measure = () => {
		const el = viewportRef.current;
		if (!el) return;
		const vw = el.clientWidth;
		const vh = el.clientHeight;
		const sw = el.scrollWidth;
		const sh = el.scrollHeight;

		xThumb.value = sw > vw + 1
			? {
				size: Math.max(MIN_THUMB, (vw / sw) * vw),
				offset: 0,
				needed: true,
			}
			: NONE;
		if (xThumb.value.needed) {
			const track = vw - xThumb.value.size;
			xThumb.value = {
				...xThumb.value,
				offset: track > 0 ? (el.scrollLeft / (sw - vw)) * track : 0,
			};
		}

		yThumb.value = sh > vh + 1
			? {
				size: Math.max(MIN_THUMB, (vh / sh) * vh),
				offset: 0,
				needed: true,
			}
			: NONE;
		if (yThumb.value.needed) {
			const track = vh - yThumb.value.size;
			yThumb.value = {
				...yThumb.value,
				offset: track > 0 ? (el.scrollTop / (sh - vh)) * track : 0,
			};
		}
	};

	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		if (el.firstElementChild) ro.observe(el.firstElementChild);
		return () => ro.disconnect();
	}, []);
	// #endregion

	// #region Drag
	const onXPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const el = viewportRef.current;
		if (!el) return;
		dragAxis.current = "x";
		dragStart.current = { pointer: e.clientX, scroll: el.scrollLeft };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};
	const onXPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (dragAxis.current !== "x") return;
		const el = viewportRef.current;
		if (!el) return;
		const track = el.clientWidth - xThumb.value.size;
		if (track <= 0) return;
		const deltaPx = e.clientX - dragStart.current.pointer;
		const deltaScroll = (deltaPx / track) * (el.scrollWidth - el.clientWidth);
		el.scrollLeft = dragStart.current.scroll + deltaScroll;
	};
	const onXPointerUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (dragAxis.current === "x") {
			(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
			dragAxis.current = null;
		}
	};

	const onYPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const el = viewportRef.current;
		if (!el) return;
		dragAxis.current = "y";
		dragStart.current = { pointer: e.clientY, scroll: el.scrollTop };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};
	const onYPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (dragAxis.current !== "y") return;
		const el = viewportRef.current;
		if (!el) return;
		const track = el.clientHeight - yThumb.value.size;
		if (track <= 0) return;
		const deltaPx = e.clientY - dragStart.current.pointer;
		const deltaScroll = (deltaPx / track) * (el.scrollHeight - el.clientHeight);
		el.scrollTop = dragStart.current.scroll + deltaScroll;
	};
	const onYPointerUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (dragAxis.current === "y") {
			(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
			dragAxis.current = null;
		}
	};
	// #endregion

	return (
		<div
			id={id}
			class={cx("ui-scrollpanel", className)}
			style={styleVars({ "--scrollpanel-height": scrollHeight }, style)}
		>
			<div
				ref={viewportRef}
				class="ui-scrollpanel__viewport"
				role="region"
				aria-label={ariaLabel ?? "Scrollable content"}
				tabIndex={0}
				onScroll={measure}
			>
				<div class="ui-scrollpanel__content">{children}</div>
			</div>

			{xThumb.value.needed && (
				<div class="ui-scrollpanel__track ui-scrollpanel__track--x" aria-hidden="true">
					<div
						class="ui-scrollpanel__thumb"
						style={styleVars({
							"--thumb-size": `${xThumb.value.size}px`,
							"--thumb-offset": `${xThumb.value.offset}px`,
						})}
						onPointerDown={onXPointerDown}
						onPointerMove={onXPointerMove}
						onPointerUp={onXPointerUp}
					/>
				</div>
			)}
			{yThumb.value.needed && (
				<div class="ui-scrollpanel__track ui-scrollpanel__track--y" aria-hidden="true">
					<div
						class="ui-scrollpanel__thumb"
						style={styleVars({
							"--thumb-size": `${yThumb.value.size}px`,
							"--thumb-offset": `${yThumb.value.offset}px`,
						})}
						onPointerDown={onYPointerDown}
						onPointerMove={onYPointerMove}
						onPointerUp={onYPointerUp}
					/>
				</div>
			)}
		</div>
	);
}

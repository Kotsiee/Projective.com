import type { JSX, VNode } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/carousel.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useMediaQuery } from "../../hooks/useMediaQuery.ts";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Types
/** A single breakpoint entry in {@link CarouselProps.responsiveOptions}. */
export interface CarouselResponsiveOption {
	/** Max-width (px, e.g. `"768px"`) at or below which this configuration applies. */
	breakpoint: string;
	/** Items shown at once at/under this breakpoint. */
	numVisible: number;
	/** Items advanced per Next/Previous step at/under this breakpoint. */
	numScroll: number;
}

/** Props for {@link Carousel}. */
export interface CarouselProps<T> {
	/** Items to render — one slide per entry (or per `numVisible` group, sliding by `numScroll`). */
	value: T[];
	/** Render a single item's content; receives the real (non-cloned) index into `value`. */
	itemTemplate: (item: T, index: number) => VNode;
	/** Items visible at once (default `1`). Overridden per-breakpoint by `responsiveOptions`. */
	numVisible?: number;
	/** Items advanced per Next/Previous step (default `1`). */
	numScroll?: number;
	/** Breakpoint → `{ numVisible, numScroll }` overrides, smallest matching breakpoint wins. */
	responsiveOptions?: CarouselResponsiveOption[];
	/** Infinite looping via cloned edge slides (seamless wrap on Next/Previous/autoplay). */
	circular?: boolean;
	/** Auto-advance interval in ms. Paused on hover/focus/drag; disabled under reduced-motion. */
	autoplayInterval?: number;
	/** Slide axis (default `horizontal`). */
	orientation?: "horizontal" | "vertical";
	/** Bound current page (group index) — raw (uncontrolled) or a `Signal` (controlled). */
	page?: Bindable<number>;
	/** Fired whenever the page changes (Next/Previous, indicator click, autoplay, or drag). */
	onPageChange?: (page: number) => void;
	/** Show the pagination dots (default `true`). */
	showIndicators?: boolean;
	/** Show the Previous/Next controls (default `true`). */
	showNavigators?: boolean;
	/** Content above the slide viewport. */
	headerTemplate?: () => VNode;
	/** Content below the slide viewport/indicators. */
	footerTemplate?: () => VNode;
	/** Accessible name for the carousel region (default `"Carousel"`). */
	"aria-label"?: string;
	class?: string;
}
// #endregion

// #region Responsive resolution
/** Parse a CSS length like `"768px"`/`"768"` down to its numeric px value. */
function parseBreakpoint(breakpoint: string): number {
	return parseInt(breakpoint, 10) || 0;
}

/** Resolve the effective `{ numVisible, numScroll }` for the current viewport width. */
function resolveEffective(
	responsiveOptions: CarouselResponsiveOption[] | undefined,
	viewportWidth: number,
	numVisible: number,
	numScroll: number,
): { numVisible: number; numScroll: number } {
	if (!responsiveOptions || responsiveOptions.length === 0 || viewportWidth === 0) {
		return { numVisible, numScroll };
	}
	const sorted = [...responsiveOptions].sort(
		(a, b) => parseBreakpoint(a.breakpoint) - parseBreakpoint(b.breakpoint),
	);
	for (const opt of sorted) {
		if (viewportWidth <= parseBreakpoint(opt.breakpoint)) {
			return { numVisible: opt.numVisible, numScroll: opt.numScroll };
		}
	}
	return { numVisible, numScroll };
}
// #endregion

/**
 * Carousel — a responsive, looping slide viewport (WAI-ARIA carousel pattern). Transform-based
 * sliding on a single flex track (token transition/spring); `circular` wraps seamlessly via cloned
 * edge slides that snap back invisibly once the transition settles. Supports pointer swipe/drag,
 * `responsiveOptions` breakpoints, autoplay (paused on hover/focus/drag, disabled under
 * reduced-motion, which also collapses the slide transition to an instant snap), pagination dots,
 * and Previous/Next controls. Keyboard: ArrowLeft/Right (or Up/Down when `orientation="vertical"`)
 * step a page, Home/End jump to the first/last page. `role="region"` +
 * `aria-roledescription="carousel"` on the root, each slide is a `role="group"` with
 * `aria-roledescription="slide"`, and a polite live region announces the visible range.
 */
export function Carousel<T>(props: CarouselProps<T>): JSX.Element {
	const {
		value,
		itemTemplate,
		numVisible: baseNumVisible = 1,
		numScroll: baseNumScroll = 1,
		responsiveOptions,
		circular = false,
		autoplayInterval,
		orientation = "horizontal",
		page,
		onPageChange,
		showIndicators = true,
		showNavigators = true,
		headerTemplate,
		footerTemplate,
		"aria-label": ariaLabel = "Carousel",
		class: className,
	} = props;

	const vertical = orientation === "vertical";
	const total = value.length;

	const pageCtrl = useControllable<number>(page, 0, onPageChange);
	const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

	// #region Viewport width tracking (drives responsiveOptions)
	const viewportWidth = useSignal(typeof window !== "undefined" ? globalThis.innerWidth : 0);
	useEffect(() => {
		if (typeof window === "undefined") return;
		const onResize = () => (viewportWidth.value = globalThis.innerWidth);
		globalThis.addEventListener("resize", onResize);
		return () => globalThis.removeEventListener("resize", onResize);
	}, []);

	const effective = useMemo(
		() => resolveEffective(responsiveOptions, viewportWidth.value, baseNumVisible, baseNumScroll),
		[responsiveOptions, viewportWidth.value, baseNumVisible, baseNumScroll],
	);
	const numVisible = Math.max(1, effective.numVisible);
	const numScroll = Math.max(1, effective.numScroll);
	// #endregion

	// #region Circular clone window
	const cloneCount = circular ? Math.min(total, Math.max(numVisible, numScroll)) : 0;
	const baseIndex = cloneCount;
	const renderItems = circular && total > 0
		? [...value.slice(total - cloneCount), ...value, ...value.slice(0, cloneCount)]
		: value;
	const realIndex = (idx: number): number =>
		circular ? ((idx - baseIndex) % total + total) % total : idx;
	// #endregion

	const totalIndicators = total > 0 ? Math.max(1, Math.ceil(total / numScroll)) : 1;
	const maxScrollIndex = Math.max(0, total - numVisible);

	// The raw track offset, in item-index units (into `renderItems`). Circular mode lets this run past
	// the real range; `onTrackTransitionEnd` snaps it back by ±total once the clone slide has settled.
	const runningIndex = useSignal(baseIndex);
	const skipTransition = useSignal(false);
	const isDragging = useSignal(false);
	const dragDelta = useSignal(0);

	// Re-sync when the effective geometry changes (breakpoint flip, item-count change).
	useEffect(() => {
		const clamped = Math.min(pageCtrl.get(), totalIndicators - 1);
		if (clamped !== pageCtrl.get()) pageCtrl.set(Math.max(0, clamped));
		runningIndex.value = circular
			? baseIndex + Math.max(0, clamped) * numScroll
			: Math.min(Math.max(0, clamped) * numScroll, maxScrollIndex);
	}, [numVisible, numScroll, total, circular]);

	const translateItems = circular
		? runningIndex.value
		: Math.min(pageCtrl.signal.value * numScroll, maxScrollIndex);

	// #region Navigation
	const goToPage = (index: number) => {
		const clamped = Math.max(0, Math.min(index, totalIndicators - 1));
		pageCtrl.set(clamped);
		runningIndex.value = circular
			? baseIndex + clamped * numScroll
			: Math.min(clamped * numScroll, maxScrollIndex);
	};

	/** Advance by `dir` pages, wrapping unconditionally — used by autoplay and drag-fling. */
	const advance = (dir: 1 | -1) => {
		const current = pageCtrl.get();
		const nextLogical = (current + dir + totalIndicators) % totalIndicators;
		pageCtrl.set(nextLogical);
		if (circular) {
			runningIndex.value += dir * numScroll;
		} else {
			runningIndex.value = Math.min(nextLogical * numScroll, maxScrollIndex);
		}
	};

	const next = () => {
		if (!circular && pageCtrl.get() >= totalIndicators - 1) return;
		advance(1);
	};
	const prev = () => {
		if (!circular && pageCtrl.get() <= 0) return;
		advance(-1);
	};

	const onTrackTransitionEnd = () => {
		if (!circular) return;
		const idx = runningIndex.value;
		if (idx >= baseIndex + total) {
			skipTransition.value = true;
			runningIndex.value = idx - total;
		} else if (idx < baseIndex) {
			skipTransition.value = true;
			runningIndex.value = idx + total;
		}
	};

	useEffect(() => {
		if (!skipTransition.value) return;
		const raf = requestAnimationFrame(() => (skipTransition.value = false));
		return () => cancelAnimationFrame(raf);
	}, [skipTransition.value]);
	// #endregion

	// #region Autoplay
	const rootRef = useRef<HTMLDivElement>(null);
	const pausedRef = useRef(false);
	useEffect(() => {
		if (!autoplayInterval || reducedMotion || total <= numVisible) return;
		const id = globalThis.setInterval(() => {
			if (!pausedRef.current) advance(1);
		}, autoplayInterval);
		return () => globalThis.clearInterval(id);
	}, [autoplayInterval, reducedMotion, total, numVisible, numScroll, circular, totalIndicators]);

	const pause = () => (pausedRef.current = true);
	const resume = () => (pausedRef.current = false);
	// #endregion

	// #region Pointer swipe/drag
	const viewportRef = useRef<HTMLDivElement>(null);
	const dragStart = useRef<{ x: number; y: number } | null>(null);

	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		dragStart.current = { x: e.clientX, y: e.clientY };
		isDragging.value = true;
		pause();
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (!dragStart.current) return;
		const delta = vertical ? e.clientY - dragStart.current.y : e.clientX - dragStart.current.x;
		dragDelta.value = delta;
	};
	const endDrag = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (!dragStart.current) return;
		const size = viewportRef.current
			? (vertical ? viewportRef.current.clientHeight : viewportRef.current.clientWidth) / numVisible
			: 1;
		const delta = dragDelta.value;
		dragStart.current = null;
		isDragging.value = false;
		dragDelta.value = 0;
		resume();
		if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		const threshold = size * 0.2;
		if (delta <= -threshold) next();
		else if (delta >= threshold) prev();
	};
	// #endregion

	// #region Keyboard
	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const forwardKey = vertical ? "ArrowDown" : "ArrowRight";
		const backKey = vertical ? "ArrowUp" : "ArrowLeft";
		if (e.key === forwardKey) {
			e.preventDefault();
			next();
		} else if (e.key === backKey) {
			e.preventDefault();
			prev();
		} else if (e.key === "Home") {
			e.preventDefault();
			goToPage(0);
		} else if (e.key === "End") {
			e.preventDefault();
			goToPage(totalIndicators - 1);
		}
	};
	// #endregion

	const shiftPercent = -translateItems * (100 / numVisible);
	const visibleStart = translateItems;
	const visibleEnd = translateItems + numVisible;
	const currentPage = pageCtrl.signal.value;
	const firstShown = Math.min(currentPage * numScroll + 1, total);
	const lastShown = Math.min(currentPage * numScroll + numVisible, total);

	return (
		<div
			ref={rootRef}
			class={cx("ui-carousel", vertical && "ui-carousel--vertical", className)}
			role="region"
			aria-roledescription="carousel"
			aria-label={ariaLabel}
			onKeyDown={onKeyDown}
			onPointerEnter={pause}
			onPointerLeave={resume}
			onFocusIn={pause}
			onFocusOut={resume}
		>
			{headerTemplate && <div class="ui-carousel__header">{headerTemplate()}</div>}

			<div class="ui-carousel__content">
				{showNavigators && (
					<button
						type="button"
						class="ui-carousel__nav ui-carousel__nav--prev"
						aria-label="Previous"
						disabled={!circular && currentPage <= 0}
						onClick={prev}
					>
						{vertical ? "▲" : "‹"}
					</button>
				)}

				<div
					ref={viewportRef}
					class="ui-carousel__viewport"
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={endDrag}
					onPointerCancel={endDrag}
				>
					<div
						class={cx(
							"ui-carousel__track",
							(isDragging.value || skipTransition.value) && "ui-carousel__track--notransition",
						)}
						style={styleVars({
							"--carousel-shift": `${shiftPercent}%`,
							"--carousel-drag": `${dragDelta.value}px`,
							"--carousel-item-size": `${100 / numVisible}%`,
						})}
						onTransitionEnd={onTrackTransitionEnd}
					>
						{renderItems.map((item, idx) => {
							const hidden = idx < visibleStart || idx >= visibleEnd;
							const ri = realIndex(idx);
							return (
								<div
									key={circular ? `c-${idx}` : ri}
									class="ui-carousel__item"
									role="group"
									aria-roledescription="slide"
									aria-label={`${ri + 1} of ${total}`}
									aria-hidden={hidden || undefined}
								>
									{itemTemplate(item, ri)}
								</div>
							);
						})}
					</div>
				</div>

				{showNavigators && (
					<button
						type="button"
						class="ui-carousel__nav ui-carousel__nav--next"
						aria-label="Next"
						disabled={!circular && currentPage >= totalIndicators - 1}
						onClick={next}
					>
						{vertical ? "▼" : "›"}
					</button>
				)}
			</div>

			{showIndicators && totalIndicators > 1 && (
				<div class="ui-carousel__indicators" role="tablist" aria-label="Slides">
					{Array.from({ length: totalIndicators }).map((_, i) => (
						<button
							key={i}
							type="button"
							role="tab"
							aria-selected={i === currentPage}
							aria-label={`Slide ${i + 1} of ${totalIndicators}`}
							class={cx(
								"ui-carousel__indicator",
								i === currentPage && "ui-carousel__indicator--active",
							)}
							onClick={() => goToPage(i)}
						/>
					))}
				</div>
			)}

			{footerTemplate && <div class="ui-carousel__footer">{footerTemplate()}</div>}

			<span class="ui-carousel__live" aria-live="polite" aria-atomic="true">
				{total > 0 ? `Item ${firstShown} to ${lastShown} of ${total}` : ""}
			</span>
		</div>
	);
}

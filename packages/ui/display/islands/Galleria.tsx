import type { JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/galleria.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useId } from "../../hooks/useId.ts";
import { useMediaQuery } from "../../hooks/useMediaQuery.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { AspectRatio } from "../../layout/components/AspectRatio.tsx";
import type { Bindable } from "../../fields/types/mod.ts";

// #region Types
/** A single Galleria slide: a full-resolution image, its thumbnail, and optional caption content. */
export interface GalleriaItem {
	/** Full-resolution stage image URL. */
	itemImageSrc: string;
	/** Thumbnail-strip image URL (falls back to `itemImageSrc` when omitted). */
	thumbnailImageSrc?: string;
	/** Shared `alt` text for both the stage image and its thumbnail. */
	alt?: string;
	/** Caption title (default caption template). */
	title?: string;
	/** Caption body text (default caption template). */
	content?: string;
}

/** Where the thumbnail strip docks relative to the main stage. */
export type GalleriaThumbnailsPosition = "top" | "bottom" | "left" | "right";
/** Where the pagination dots overlay the main stage. */
export type GalleriaIndicatorsPosition = "top" | "bottom";

/** Props for {@link Galleria}. */
export interface GalleriaProps {
	/** Slides to render. */
	value: GalleriaItem[];
	/** Bound active slide index — raw (uncontrolled) or a `Signal` (controlled). */
	activeIndex?: Bindable<number>;
	/** Fired whenever the active slide changes. */
	onActiveIndexChange?: (index: number) => void;
	/** Render the thumbnail strip (default `true`). */
	showThumbnails?: boolean;
	/** Thumbnail-strip dock side (default `"bottom"`). */
	thumbnailsPosition?: GalleriaThumbnailsPosition;
	/** Thumbnails visible at once before the strip scrolls (default `5`). */
	numVisible?: number;
	/** Render pagination dots over the stage (default `false` — thumbnails already give position). */
	showIndicators?: boolean;
	/** Indicator dock position over the stage (default `"bottom"`). */
	indicatorsPosition?: GalleriaIndicatorsPosition;
	/** Show the Previous/Next stage controls (default `true`). */
	showItemNavigators?: boolean;
	/** Wrap seamlessly at the first/last slide (default `false`). */
	circular?: boolean;
	/** Auto-advance the stage. Paused on hover/focus; disabled under reduced-motion (default `false`). */
	autoPlay?: boolean;
	/** Auto-advance interval in ms (default `4000`). */
	transitionInterval?: number;
	/** Override the default caption block. */
	captionTemplate?: (item: GalleriaItem, index: number) => VNode;
	/** Override the default stage image rendering. */
	itemTemplate?: (item: GalleriaItem, index: number) => VNode;
	/** Override the default thumbnail rendering. */
	thumbnailTemplate?: (item: GalleriaItem, index: number) => VNode;
	/** Bound full-screen state — raw (uncontrolled) or a `Signal` (controlled). */
	fullScreen?: Bindable<boolean>;
	/** Fired whenever full-screen is toggled. */
	onFullScreenChange?: (value: boolean) => void;
	/** Accessible name for the gallery region (default `"Media gallery"`). */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/**
 * Galleria — a responsive media gallery: a main stage, optional thumbnail strip (any of the four
 * edges), optional pagination dots, and a focus-trapped full-screen mode. The stage swaps its single
 * active image on a token crossfade (collapses to an instant swap under reduced-motion), so offscreen
 * full-resolution images are never mounted — the thumbnail strip alone carries the low-res previews,
 * which lazy-load natively and `scrollIntoView` to stay synced with the active slide. Keyboard:
 * ArrowLeft/Right step a slide, Home/End jump to the first/last, Escape exits full-screen. Full-screen
 * is a `role="dialog"` overlay at `--z-overlay` with a focus trap; the inline mode is a plain
 * `role="group"` region. A polite live region announces the active slide.
 */
export function Galleria(props: GalleriaProps): JSX.Element {
	const {
		value,
		activeIndex,
		onActiveIndexChange,
		showThumbnails = true,
		thumbnailsPosition = "bottom",
		numVisible = 5,
		showIndicators = false,
		indicatorsPosition = "bottom",
		showItemNavigators = true,
		circular = false,
		autoPlay = false,
		transitionInterval = 4000,
		captionTemplate,
		itemTemplate,
		thumbnailTemplate,
		fullScreen,
		onFullScreenChange,
		"aria-label": ariaLabel = "Media gallery",
		class: className,
	} = props;

	const total = value.length;
	const activeCtrl = useControllable<number>(activeIndex, 0, onActiveIndexChange);
	const fullscreenCtrl = useControllable<boolean>(fullScreen, false, onFullScreenChange);
	const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	const rootId = useId(undefined, "galleria");

	const active = activeCtrl.signal.value;
	const isFullscreen = fullscreenCtrl.signal.value;
	const item = value[active];

	// #region Navigation
	const goTo = (index: number) => {
		if (total === 0) return;
		const clamped = circular ? ((index % total) + total) % total : Math.max(0, Math.min(index, total - 1));
		activeCtrl.set(clamped);
	};
	const next = () => {
		if (!circular && active >= total - 1) return;
		goTo(active + 1);
	};
	const prev = () => {
		if (!circular && active <= 0) return;
		goTo(active - 1);
	};
	// #endregion

	// #region Autoplay
	const pausedRef = useRef(false);
	useEffect(() => {
		if (!autoPlay || reducedMotion || total <= 1) return;
		const id = window.setInterval(() => {
			if (!pausedRef.current) goTo((activeCtrl.get() + 1 + total) % total);
		}, transitionInterval);
		return () => window.clearInterval(id);
	}, [autoPlay, reducedMotion, total, transitionInterval, circular]);
	const pause = () => (pausedRef.current = true);
	const resume = () => (pausedRef.current = false);
	// #endregion

	// #region Full-screen overlay (focus trap + Escape close + scroll lock)
	const rootRef = useRef<HTMLDivElement>(null);
	const overlay = useOverlayStack({ active: isFullscreen, lockScroll: true });
	useFocusTrap({ active: isFullscreen, containerRef: rootRef });
	useDismiss({
		open: isFullscreen,
		onDismiss: () => fullscreenCtrl.set(false),
		panelRef: rootRef,
		closeOnOutside: false,
	});
	// #endregion

	// #region Thumbnail scroll sync
	const thumbStripRef = useRef<HTMLDivElement>(null);
	const activeThumbRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		activeThumbRef.current?.scrollIntoView({
			behavior: reducedMotion ? "auto" : "smooth",
			block: "nearest",
			inline: "nearest",
		});
	}, [active]);

	const thumbAxis = thumbnailsPosition === "left" || thumbnailsPosition === "right" ? "vertical" : "horizontal";
	const scrollThumbs = (dir: 1 | -1) => {
		const el = thumbStripRef.current;
		if (!el) return;
		const step = (thumbAxis === "vertical" ? el.clientHeight : el.clientWidth) / numVisible;
		el.scrollBy(
			thumbAxis === "vertical" ? { top: dir * step, behavior: reducedMotion ? "auto" : "smooth" } : {
				left: dir * step,
				behavior: reducedMotion ? "auto" : "smooth",
			},
		);
	};
	// #endregion

	// #region Keyboard
	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (e.key === "ArrowRight") {
			e.preventDefault();
			next();
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			prev();
		} else if (e.key === "Home") {
			e.preventDefault();
			goTo(0);
		} else if (e.key === "End") {
			e.preventDefault();
			goTo(total - 1);
		} else if (e.key === "Escape" && isFullscreen) {
			e.preventDefault();
			fullscreenCtrl.set(false);
		}
	};
	// #endregion

	if (total === 0 || !item) {
		return (
			<div class={cx("ui-galleria", "ui-galleria--empty", className)} role="group" aria-label={ariaLabel}>
				No media
			</div>
		);
	}

	const stage = (
		<div class="ui-galleria__stage">
			{showItemNavigators && total > 1 && (
				<button
					type="button"
					class="ui-galleria__nav ui-galleria__nav--prev"
					aria-label="Previous"
					disabled={!circular && active <= 0}
					onClick={prev}
				>
					‹
				</button>
			)}

			<div class="ui-galleria__frame" key={active}>
				{itemTemplate
					? itemTemplate(item, active)
					: (
						<AspectRatio ratio="16 / 9" class="ui-galleria__ratio">
							<img
								class="ui-galleria__image"
								src={item.itemImageSrc}
								alt={item.alt ?? ""}
								loading="eager"
							/>
						</AspectRatio>
					)}
			</div>

			{showItemNavigators && total > 1 && (
				<button
					type="button"
					class="ui-galleria__nav ui-galleria__nav--next"
					aria-label="Next"
					disabled={!circular && active >= total - 1}
					onClick={next}
				>
					›
				</button>
			)}

			<button
				type="button"
				class="ui-galleria__fullscreen-toggle"
				aria-label={isFullscreen ? "Exit full screen" : "View full screen"}
				aria-pressed={isFullscreen}
				onClick={() => fullscreenCtrl.set(!isFullscreen)}
			>
				{isFullscreen ? "⤡" : "⤢"}
			</button>

			{showIndicators && total > 1 && (
				<div
					class={cx(
						"ui-galleria__indicators",
						`ui-galleria__indicators--${indicatorsPosition}`,
					)}
					role="tablist"
					aria-label="Slides"
				>
					{value.map((_, i) => (
						<button
							key={i}
							type="button"
							role="tab"
							aria-selected={i === active}
							aria-label={`Slide ${i + 1} of ${total}`}
							class={cx("ui-galleria__indicator", i === active && "ui-galleria__indicator--active")}
							onClick={() => goTo(i)}
						/>
					))}
				</div>
			)}

			{(item.title || item.content || captionTemplate) && (
				<div class="ui-galleria__caption">
					{captionTemplate
						? captionTemplate(item, active)
						: (
							<>
								{item.title && <div class="ui-galleria__caption-title">{item.title}</div>}
								{item.content && <div class="ui-galleria__caption-content">{item.content}</div>}
							</>
						)}
				</div>
			)}
		</div>
	);

	const thumbnails = showThumbnails && total > 1 && (
		<div
			class={cx("ui-galleria__thumbnails", `ui-galleria__thumbnails--${thumbnailsPosition}`)}
		>
			<button
				type="button"
				class="ui-galleria__thumb-nav ui-galleria__thumb-nav--prev"
				aria-label={thumbAxis === "vertical" ? "Scroll thumbnails up" : "Scroll thumbnails left"}
				onClick={() => scrollThumbs(-1)}
			>
				{thumbAxis === "vertical" ? "▲" : "‹"}
			</button>

			<div
				ref={thumbStripRef}
				class="ui-galleria__thumb-strip"
				style={styleVars({ "--galleria-thumb-size": `${100 / numVisible}%` })}
				role="listbox"
				aria-label="Thumbnails"
			>
				{value.map((it, i) => (
					<button
						key={i}
						ref={i === active ? activeThumbRef : undefined}
						type="button"
						role="option"
						aria-selected={i === active}
						aria-label={it.alt ?? `Slide ${i + 1}`}
						class={cx("ui-galleria__thumb", i === active && "ui-galleria__thumb--active")}
						onClick={() => goTo(i)}
					>
						{thumbnailTemplate
							? thumbnailTemplate(it, i)
							: (
								<img
									class="ui-galleria__thumb-image"
									src={it.thumbnailImageSrc ?? it.itemImageSrc}
									alt=""
									loading="lazy"
								/>
							)}
					</button>
				))}
			</div>

			<button
				type="button"
				class="ui-galleria__thumb-nav ui-galleria__thumb-nav--next"
				aria-label={thumbAxis === "vertical" ? "Scroll thumbnails down" : "Scroll thumbnails right"}
				onClick={() => scrollThumbs(1)}
			>
				{thumbAxis === "vertical" ? "▼" : "›"}
			</button>
		</div>
	);

	return (
		<div
			ref={rootRef}
			id={rootId}
			class={cx(
				"ui-galleria",
				`ui-galleria--thumbs-${thumbnailsPosition}`,
				isFullscreen && "ui-galleria--fullscreen",
				className,
			)}
			role={isFullscreen ? "dialog" : "group"}
			aria-modal={isFullscreen || undefined}
			aria-roledescription={isFullscreen ? undefined : "media gallery"}
			aria-label={ariaLabel}
			tabIndex={isFullscreen ? -1 : undefined}
			style={isFullscreen ? styleVars({ "--galleria-z": String(overlay.zIndex) }) : undefined}
			onKeyDown={onKeyDown}
			onPointerEnter={pause}
			onPointerLeave={resume}
			onFocusIn={pause}
			onFocusOut={resume}
		>
			{stage}
			{thumbnails}
			<span class="ui-galleria__live" aria-live="polite" aria-atomic="true">
				{`${item.alt ?? "Slide"}, ${active + 1} of ${total}`}
			</span>
		</div>
	);
}

import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { AudioVisualizer, ProgressiveImage, VideoPlayer } from "@projective/ui/display";
import "../styles/entity-view.css";
import type { EntityMedia, ProductPreview } from "@projective/types/explore";
import { MediaLightbox } from "../components/MediaLightbox.tsx";
import { railSlots, visibleRail } from "../core/media-rail.ts";
import { attachDragScroll } from "@features/marketing/core/drag-scroll.ts";

/**
 * EntityCanvas — the media column of the Entity View frame (`DESIGN_SYSTEM.md` §D.8.0).
 *
 * A large featured display fills the column, with the thumbnail rail anchored BENEATH it — never
 * floating over it, because an overlay strip covers the part of the image a reader is trying to
 * evaluate, which is the one thing the display exists for.
 *
 * # The rail never shows a partial card
 *
 * That is a layout property, not a measurement that has to come out right. The rail is a grid of
 * exactly N equal `1fr` columns, so whatever N is, the cards divide the available width exactly and
 * a fractional card is unrepresentable. Measurement only decides WHAT N is; it cannot produce a
 * clipped card, which is why a slow or absent ResizeObserver degrades to a different count rather
 * than to a broken rail.
 *
 * When the gallery has more images than slots, the FINAL visible slot becomes a `+N` card that opens
 * the shared {@link MediaLightbox}. It counts everything it stands in front of, including its own
 * image, so the reader is told exactly how much they are not being shown — a rail that silently
 * drops images is indistinguishable from a gallery that never had them.
 *
 * # The box is the layout contract; the artefact is what fills it
 *
 * An image, an `AudioVisualizer`, the shared `VideoPlayer` and a code excerpt all render inside
 * the same display box, so switching product format causes no reflow. The display is the FLEXIBLE
 * child and the rail is fixed, because `aspect-ratio` supplies only a PREFERRED size and loses to a
 * sibling growing into the same space (the `/explore` fold defect, Decision #76).
 *
 * A video preview is the platform's one video surface in its `full` variant — the same transport
 * the profile hero's showreel carries — rather than the browser's own `controls`, which was the one
 * default-styled control set on the page. It sits absolutely in the stage so it fills the 4:3 box
 * and letterboxes the artefact (`contain`, like the still) instead of cropping what is being sold.
 * A preview whose source is the stub `#` renders its poster and NO controls: the player refuses to
 * draw a control that could reach nothing.
 *
 * # The stage is a track
 *
 * Every gallery item sits side by side in the stage, one per snap point, so a mouse drag (or a
 * trackpad / touch swipe) scrubs through them and the thumbnails follow (`attachDragScroll`: past 5px
 * a press is a drag and the click after it is swallowed, so letting go never opens the lightbox).
 * A click on a still slide still opens it; a live preview slide keeps its own pointer gestures.
 *
 * # The rail is a `group`, not a `tablist`
 *
 * It was written as one, which was wrong three ways: `role="tab"` carries an implicit
 * `aria-selected="false"`, so exposing selection through `aria-current` left EVERY thumbnail
 * announced as unselected while one was visibly active; the tabs controlled nothing, because the
 * display is a plain element with no `role="tabpanel"` and no id; and the pattern owes a
 * roving-tabindex keyboard model that was never implemented. A labelled group of ordinary buttons
 * owes none of that and announces honestly.
 */

/** The rail's slot count before the first measurement — SSR and the first client paint. */
const SSR_SLOTS = 4;
/** How long the track must be still before the slide it rests on becomes the shown one (ms). */
const SCROLL_SETTLE_MS = 120;

function prefersReducedMotion(): boolean {
	if (document.documentElement.dataset.motion === "reduced") return true;
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export interface EntityCanvasProps {
	gallery: EntityMedia[];
	title: string;
	/**
	 * A digital product's live preview artefact. When present it REPLACES the first gallery image in
	 * the display — a product is bought sight-unseen, so the canvas shows the thing itself rather
	 * than a photograph of it.
	 */
	preview?: ProductPreview;
}

export default function EntityCanvas(
	{ gallery, title, preview }: EntityCanvasProps,
): JSX.Element | null {
	const active = useSignal(0);
	const open = useSignal(false);
	/** The measured slot count. `null` until the rail has been measured at least once. */
	const slots = useSignal<number | null>(null);
	const railRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const fromScroll = useRef(false);
	const settleTimer = useRef<number | null>(null);

	const hasGallery = gallery.length > 0;

	/*
	 * Measure the rail and recompute the slot count on every resize.
	 *
	 * The card floor and the gap are read from the RENDERED element rather than restated as JS
	 * constants, so the stylesheet stays the single authority on both (root CLAUDE.md §3 —
	 * token-only). A `ResizeObserver` on the rail itself, not the window: this column's width is a
	 * function of the frame's grid and the lane's width, neither of which the viewport predicts.
	 */
	useEffect(() => {
		const el = railRef.current;
		if (!el) return;
		const measure = () => {
			slots.value = railSlots(el.getBoundingClientRect().width, readRailMetrics(el));
		};
		measure();
		let ro: ResizeObserver | undefined;
		try {
			ro = new ResizeObserver(measure);
			ro.observe(el);
		} catch { /* no ResizeObserver — the SSR default stands, and the rail still fits exactly */ }
		return () => ro?.disconnect();
	}, [gallery.length]);

	const slideCount = hasGallery ? gallery.length : preview ? 1 : 0;
	const draggable = slideCount > 1;

	useEffect(() => {
		const el = trackRef.current;
		if (!el || !draggable) return;
		const detach = attachDragScroll(el);
		return () => {
			detach();
			if (settleTimer.current !== null) clearTimeout(settleTimer.current);
		};
	}, [draggable]);

	useEffect(() => {
		const el = trackRef.current;
		if (!el || slideCount < 2) return;
		if (fromScroll.current) {
			fromScroll.current = false;
			return;
		}
		const rtl = getComputedStyle(el).direction === "rtl";
		const left = (rtl ? -1 : 1) * Math.min(active.value, slideCount - 1) * el.clientWidth;
		if (Math.abs(el.scrollLeft - left) < 2) return;
		el.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
	}, [active.value, slideCount]);

	if (!hasGallery && !preview) return null;

	const previewFirst = !!preview && preview.kind !== "image";
	const idx = hasGallery ? Math.min(active.value, gallery.length - 1) : 0;
	const rail = visibleRail(gallery.length, slots.value ?? SSR_SLOTS);

	function openLightbox(at: number): void {
		if (!hasGallery) return;
		active.value = Math.min(Math.max(0, at), gallery.length - 1);
		open.value = true;
	}

	/** Settle the shown slide from where the track came to rest, once the scroll stops. */
	function onTrackScroll(e: JSX.TargetedEvent<HTMLDivElement>): void {
		settleSoon(e.currentTarget);
	}

	function settleSoon(el: HTMLDivElement): void {
		if (settleTimer.current !== null) clearTimeout(settleTimer.current);
		settleTimer.current = setTimeout(() => {
			settleTimer.current = null;
			if (el.classList.contains("is-dragging") || el.classList.contains("is-gliding")) {
				settleSoon(el);
				return;
			}
			const at = Math.round(Math.abs(el.scrollLeft) / Math.max(1, el.clientWidth));
			const next = Math.min(Math.max(0, at), slideCount - 1);
			if (next !== active.value) {
				fromScroll.current = true;
				active.value = next;
			}
		}, SCROLL_SETTLE_MS) as unknown as number;
	}

	const slides = hasGallery
		? gallery.map((media, i) =>
			i === 0 && previewFirst
				? (
					<div
						key="preview"
						class="evp-canvas__slide"
						onPointerDown={(e) => e.stopPropagation()}
					>
						{renderPreview(preview!, title)}
					</div>
				)
				: (
					<button
						key={media.src}
						type="button"
						class="evp-canvas__slide evp-canvas__slide--open"
						aria-label={gallery.length > 1
							? `Open image ${i + 1} of ${gallery.length} at full size`
							: `Open ${title} at full size`}
						tabIndex={i === idx ? 0 : -1}
						onClick={() => openLightbox(i)}
					>
						<ProgressiveImage
							imgClass="evp-canvas__img"
							src={media.src}
							placeholder={media.placeholder}
							alt={media.alt || title}
							fit="contain"
							loading={i === 0 ? "eager" : "lazy"}
						/>
					</button>
				)
		)
		: [
			<div key="preview" class="evp-canvas__slide">
				{renderPreview(preview!, title)}
			</div>,
		];

	return (
		<div class="evp-canvas">
			<div
				class="evp-canvas__stage evp-canvas__track"
				ref={trackRef}
				role="group"
				aria-roledescription={draggable ? "carousel" : undefined}
				aria-label={`${title} gallery`}
				data-draggable={draggable ? "true" : undefined}
				onScroll={draggable ? onTrackScroll : undefined}
			>
				{slides}
			</div>

			{gallery.length > 1 && (
				<div
					class="evp-canvas__strip"
					ref={railRef}
					role="group"
					aria-label={`${title} media`}
					style={`--evp-rail-n:${rail.slots}`}
				>
					{gallery.slice(0, rail.realCount).map((media, i) => (
						<button
							type="button"
							class="evp-canvas__thumb"
							key={media.thumb}
							aria-current={idx === i ? "true" : "false"}
							aria-label={media.alt || `Show image ${i + 1} of ${gallery.length}`}
							onClick={() => (active.value = i)}
						>
							<ProgressiveImage
								imgClass="evp-canvas__thumbimg"
								src={media.thumb}
								placeholder={media.thumbPlaceholder}
								loading="lazy"
							/>
						</button>
					))}
					{rail.overflow > 0 && (
						<button
							type="button"
							class="evp-canvas__thumb evp-canvas__thumb--more"
							aria-label={`View all ${gallery.length} images`}
							onClick={() => openLightbox(rail.realCount)}
						>
							<ProgressiveImage
								imgClass="evp-canvas__thumbimg"
								src={gallery[rail.realCount].thumb}
								placeholder={gallery[rail.realCount].thumbPlaceholder}
								loading="lazy"
							/>
							<span class="evp-canvas__more" aria-hidden="true">+{rail.overflow}</span>
						</button>
					)}
				</div>
			)}

			{hasGallery && (
				<MediaLightbox
					open={open}
					active={active}
					gallery={gallery}
					title={title}
					onClose={() => (open.value = false)}
				/>
			)}
		</div>
	);
}

/**
 * The rail's own geometry, read from the element so the stylesheet stays authoritative.
 *
 * `column-gap` comes back already resolved to pixels. `--evp-rail-min` comes back as AUTHORED — a
 * custom property is substituted, not computed — so a `rem` value is resolved once through a
 * throwaway probe rather than by hardcoding the root font size, which a user's browser zoom or a
 * `data-density` overlay is free to change.
 */
function readRailMetrics(el: HTMLElement): { min: number; gap: number } {
	const cs = getComputedStyle(el);
	return {
		min: pxOf(cs.getPropertyValue("--evp-rail-min"), el),
		gap: pxOf(cs.columnGap, el),
	};
}

/** A CSS length in pixels, or `NaN` when unresolvable — which `railSlots` treats as absent. */
function pxOf(value: string, el: HTMLElement): number {
	const raw = value.trim();
	if (!raw) return NaN;
	const direct = Number.parseFloat(raw);
	if (raw.endsWith("px") && Number.isFinite(direct)) return direct;
	try {
		const probe = document.createElement("div");
		probe.style.position = "absolute";
		probe.style.visibility = "hidden";
		probe.style.inlineSize = raw;
		el.appendChild(probe);
		const w = probe.getBoundingClientRect().width;
		probe.remove();
		return w > 0 ? w : NaN;
	} catch {
		return NaN;
	}
}

/** Render the live artefact for a product preview, inside the same display box. */
function renderPreview(preview: ProductPreview, title: string): JSX.Element {
	switch (preview.kind) {
		case "audio":
			return (
				<div class="evp-canvas__player">
					<AudioVisualizer
						peaks={preview.peaks ?? []}
						durationMs={preview.durationMs ?? 0}
						durationLabel={preview.durationLabel}
						src={preview.src}
						showSpeed
						aria-label={`Preview of ${title}`}
					/>
				</div>
			);
		case "video":
			return (
				<VideoPlayer
					variant="full"
					class="evp-canvas__video"
					src={preview.src}
					poster={preview.poster}
					label={`Preview of ${title}`}
					fit="contain"
					preload="none"
				/>
			);
		case "code":
			return (
				<pre
					class="evp-canvas__code"
					aria-label={`Code excerpt from ${title}`}
				><code>{preview.code}</code></pre>
			);
		default:
			return (
				<img
					class="evp-canvas__img"
					src={preview.poster ?? preview.src}
					alt={title}
					loading="eager"
					decoding="async"
				/>
			);
	}
}

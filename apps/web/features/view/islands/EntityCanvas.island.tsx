import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { AudioVisualizer } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import "../styles/entity-view.css";
import type { EntityMedia, ProductPreview } from "@projective/types/explore";
import { MediaLightbox } from "../components/MediaLightbox.tsx";
import { railSlots, visibleRail } from "../core/media-rail.ts";

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
 * An image, an `AudioVisualizer`, a video player and a code excerpt all render inside the same
 * display box, so switching product format causes no reflow. The display is the FLEXIBLE child and
 * the rail is fixed, because `aspect-ratio` supplies only a PREFERRED size and loses to a sibling
 * growing into the same space (the `/explore` fold defect, Decision #76).
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

	if (!hasGallery && !preview) return null;

	// The live artefact wins the display only while the reader is on the first slot; picking a
	// thumbnail is an explicit request to see that image instead.
	const showPreview = !!preview && preview.kind !== "image" && active.value === 0;
	const idx = hasGallery ? Math.min(active.value, gallery.length - 1) : 0;
	const current = hasGallery ? gallery[idx] : null;
	const rail = visibleRail(gallery.length, slots.value ?? SSR_SLOTS);

	function openLightbox(at: number): void {
		if (!hasGallery) return;
		active.value = Math.min(Math.max(0, at), gallery.length - 1);
		open.value = true;
	}

	const display = showPreview ? renderPreview(preview!, title) : current
		? (
			<img
				class="evp-canvas__img"
				src={current.src}
				alt={current.alt || title}
				loading="eager"
				decoding="async"
			/>
		)
		: null;

	return (
		<div class="evp-canvas">
			{
				/*
			  A still image is a BUTTON, because clicking it opens the modal. A live artefact is not:
			  a `<video>` or an audio player nested inside a `<button>` is two interactive elements in
			  one, where the outer control takes the accessible role and the inner one takes the
			  interaction.
			*/
			}
			{showPreview || !current ? <div class="evp-canvas__stage">{display}</div> : (
				<button
					type="button"
					class="evp-canvas__stage evp-canvas__stage--open"
					aria-label={`Open ${title} at full size`}
					onClick={() => openLightbox(idx)}
				>
					{display}
					<span class="evp-canvas__zoom" aria-hidden="true">
						<Icon name="expand" size="sm" />
					</span>
				</button>
			)}

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
							<img
								class="evp-canvas__thumbimg"
								src={media.thumb}
								alt=""
								loading="lazy"
								decoding="async"
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
							<img
								class="evp-canvas__thumbimg"
								src={gallery[rail.realCount].thumb}
								alt=""
								loading="lazy"
								decoding="async"
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
				<video
					class="evp-canvas__img"
					controls
					preload="none"
					poster={preview.poster}
					aria-label={`Preview of ${title}`}
				>
					<source src={preview.src} />
				</video>
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

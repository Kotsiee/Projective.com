import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import type { EntityMedia } from "@projective/types/explore";
import { ViewIcon } from "../components/view-glyphs.tsx";

/**
 * MediaGallery — the Amazon-style hero showcase (Part 1.1). A vertical thumbnail strip sits on the left
 * edge; HOVERING (or focusing) any thumbnail instantly swaps the large main image beside it. When the
 * gallery overflows the strip a trailing "+N" button opens the full lightbox. Clicking the main image
 * opens an expanded inspection modal (modelled on `fx-modal__panel`, mounted via {@link BodyPortal} to
 * beat the glass-blur fixed-overlay trap) with high-res click-to-zoom, carousel navigation, and
 * keyboard shortcuts (Esc closes; ←/→ step the gallery).
 */

/** How many real thumbnails the vertical strip shows before collapsing the rest into a "+N" button. */
const MAX_THUMBS = 5;

export interface MediaGalleryProps {
	gallery: EntityMedia[];
	title: string;
}

export default function MediaGallery({ gallery, title }: MediaGalleryProps): JSX.Element {
	const active = useSignal(0);
	const open = useSignal(false);
	const zoomed = useSignal(false);
	const originX = useSignal(50);
	const originY = useSignal(50);

	const safe = gallery.length > 0 ? gallery : [];
	const idx = Math.min(active.value, Math.max(0, safe.length - 1));

	function openAt(i: number): void {
		active.value = Math.min(Math.max(0, i), safe.length - 1);
		zoomed.value = false;
		open.value = true;
	}

	if (safe.length === 0) {
		return (
			<div class="vw-gallery vw-gallery--empty" aria-hidden="true">
				<div class="vw-gallery__main vw-gallery__main--placeholder" />
			</div>
		);
	}

	const overflow = safe.length - MAX_THUMBS;
	const strip = overflow > 0 ? safe.slice(0, MAX_THUMBS) : safe;
	const current = safe[idx];

	return (
		<div class="vw-gallery">
			<div class="vw-gallery__strip" role="tablist" aria-label={`${title} media`}>
				{strip.map((m, i) => (
					<button
						key={m.thumb}
						type="button"
						class="vw-thumb"
						role="tab"
						aria-selected={i === idx}
						aria-label={`Show image ${i + 1} of ${safe.length}`}
						data-active={i === idx ? "true" : undefined}
						onMouseEnter={() => (active.value = i)}
						onFocus={() => (active.value = i)}
						onClick={() => openAt(i)}
					>
						<img src={m.thumb} alt="" loading="lazy" decoding="async" draggable={false} />
					</button>
				))}
				{overflow > 0
					? (
						<button
							type="button"
							class="vw-thumb vw-thumb--more"
							aria-label={`View all ${safe.length} images`}
							onClick={() => openAt(MAX_THUMBS)}
						>
							<img
								src={safe[MAX_THUMBS].thumb}
								alt=""
								loading="lazy"
								decoding="async"
								draggable={false}
							/>
							<span class="vw-thumb__count">+{overflow}</span>
						</button>
					)
					: null}
			</div>

			<button
				type="button"
				class="vw-gallery__main"
				aria-label="Open full-size image"
				onClick={() => openAt(idx)}
			>
				<img src={current.src} alt={current.alt} decoding="async" draggable={false} />
				<span class="vw-gallery__zoomhint" aria-hidden="true">
					<ViewIcon name="expand" size={18} />
					<span>Click to zoom</span>
				</span>
			</button>

			<Lightbox
				open={open}
				active={active}
				zoomed={zoomed}
				originX={originX}
				originY={originY}
				gallery={safe}
				title={title}
				onClose={() => (open.value = false)}
			/>
		</div>
	);
}

// #region Lightbox
interface LightboxProps {
	open: Signal<boolean>;
	active: Signal<number>;
	zoomed: Signal<boolean>;
	originX: Signal<number>;
	originY: Signal<number>;
	gallery: EntityMedia[];
	title: string;
	onClose: () => void;
}

function Lightbox(
	{ open, active, zoomed, originX, originY, gallery, title, onClose }: LightboxProps,
): JSX.Element | null {
	const { mounted, state } = usePresence(open.value);
	const stack = useOverlayStack({ active: mounted, lockScroll: true });
	const panelRef = useRef<HTMLDivElement>(null);
	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({ open: mounted, onDismiss: onClose, panelRef, closeOnOutside: false });

	// Step the gallery — reads `active.value` LIVE (signal) so the handler is never a stale closure.
	function step(delta: number): void {
		const len = gallery.length;
		if (len === 0) return;
		active.value = (active.value + delta + len) % len;
		zoomed.value = false;
	}

	// Keyboard shortcuts: Esc closes; ←/→ step the gallery (guarded to when the modal is mounted).
	useEffect(() => {
		if (!mounted) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
			else if (e.key === "ArrowLeft") step(-1);
			else if (e.key === "ArrowRight") step(1);
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, [mounted]);

	if (!mounted || gallery.length === 0) return null;

	const idx = Math.min(active.value, gallery.length - 1);
	const current = gallery[idx];
	const multi = gallery.length > 1;

	function toggleZoom(e: MouseEvent): void {
		const el = e.currentTarget as HTMLElement;
		const rect = el.getBoundingClientRect();
		originX.value = ((e.clientX - rect.left) / rect.width) * 100;
		originY.value = ((e.clientY - rect.top) / rect.height) * 100;
		zoomed.value = !zoomed.value;
	}

	return (
		<BodyPortal>
			<div class="fx-modal vw-lightbox" data-state={state} style={`z-index:${stack.zIndex}`}>
				<Backdrop visible={state === "open"} blur onClick={onClose} />
				<div
					ref={panelRef}
					class="fx-modal__panel vw-lightbox__panel"
					data-state={state}
					role="dialog"
					aria-modal="true"
					aria-label={`${title} — image ${idx + 1} of ${gallery.length}`}
					tabIndex={-1}
				>
					<header class="fx-modal__head vw-lightbox__head">
						<span class="vw-lightbox__counter">{idx + 1} / {gallery.length}</span>
						<div class="fx-modal__actions">
							<a class="fx-modal__act" href={current.src} download aria-label="Download image">
								<ViewIcon name="expand" size={17} />
							</a>
							<button
								type="button"
								class="fx-modal__act fx-modal__act--close"
								aria-label="Close preview"
								onClick={onClose}
							>
								<ViewIcon name="close" size={18} />
							</button>
						</div>
					</header>

					<div class="vw-lightbox__stage">
						{multi
							? (
								<button
									type="button"
									class="vw-lightbox__nav vw-lightbox__nav--prev"
									aria-label="Previous image"
									onClick={() => step(-1)}
								>
									<ViewIcon name="chevron-left" size={26} />
								</button>
							)
							: null}
						<div class="vw-lightbox__frame" data-zoomed={zoomed.value ? "true" : undefined}>
							<img
								class="vw-lightbox__img"
								src={current.src}
								alt={current.alt}
								draggable={false}
								data-zoomed={zoomed.value ? "true" : undefined}
								style={zoomed.value
									? `transform-origin:${originX.value}% ${originY.value}%`
									: undefined}
								onClick={toggleZoom}
							/>
						</div>
						{multi
							? (
								<button
									type="button"
									class="vw-lightbox__nav vw-lightbox__nav--next"
									aria-label="Next image"
									onClick={() => step(1)}
								>
									<ViewIcon name="chevron-right" size={26} />
								</button>
							)
							: null}
					</div>

					{multi
						? (
							<div class="vw-lightbox__tray" role="tablist" aria-label="Gallery thumbnails">
								{gallery.map((m, i) => (
									<button
										key={m.thumb}
										type="button"
										class="vw-lightbox__traythumb"
										role="tab"
										aria-selected={i === idx}
										aria-label={`Image ${i + 1}`}
										data-active={i === idx ? "true" : undefined}
										onClick={() => {
											active.value = i;
											zoomed.value = false;
										}}
									>
										<img src={m.thumb} alt="" loading="lazy" draggable={false} />
									</button>
								))}
							</div>
						)
						: null}
				</div>
			</div>
		</BodyPortal>
	);
}
// #endregion

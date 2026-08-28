import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import type { EntityMedia } from "@projective/types/explore";
import { ViewIcon } from "./view-glyphs.tsx";

/**
 * MediaLightbox — the ONE full-screen media modal on the Entity View surface.
 *
 * It was previously a private component inside `MediaGallery.island.tsx`, which meant the rebuilt
 * media column had nothing to import and would have grown a second copy. Two implementations of a
 * gallery modal drift in exactly the ways a reader notices: one gets the keyboard shortcuts, the
 * other gets the download control, and neither gets both. Extracted here so the media column and the
 * legacy gallery mount the same dialog with the same `vw-lightbox` rules (`view.css`, delivered by
 * `ViewStyleAnchor`).
 *
 * It is a plain component rather than an island: it is only ever rendered BY an island, and its
 * panel leaves the page through {@link BodyPortal} so no ancestor's `backdrop-filter` or `clip` can
 * re-base or trap it (the glass-blur fixed-overlay trap).
 *
 * `open` and `active` are Signals owned by the caller, so the trigger and the modal address the same
 * slot — a lightbox opened from the fourth thumbnail must show the fourth image, and a `useState`
 * copy is how that comes to be off by one after a resize re-renders the strip.
 */
export interface MediaLightboxProps {
	/** Whether the dialog is mounted. Owned by the caller so any trigger can open it. */
	open: Signal<boolean>;
	/** The active gallery index, shared with the caller's strip so the two never disagree. */
	active: Signal<number>;
	gallery: readonly EntityMedia[];
	title: string;
	onClose: () => void;
}

export function MediaLightbox(
	{ open, active, gallery, title, onClose }: MediaLightboxProps,
): JSX.Element | null {
	const zoomed = useSignal(false);
	const originX = useSignal(50);
	const originY = useSignal(50);
	const { mounted, state } = usePresence(open.value);
	const stack = useOverlayStack({ active: mounted, lockScroll: true });
	const panelRef = useRef<HTMLDivElement>(null);
	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({ open: mounted, onDismiss: onClose, panelRef, closeOnOutside: false });

	/** Step the gallery — reads `active.value` LIVE (signal) so the handler is never a stale closure. */
	function step(delta: number): void {
		const len = gallery.length;
		if (len === 0) return;
		active.value = (active.value + delta + len) % len;
		zoomed.value = false;
	}

	// Esc closes; ←/→ step the gallery. Bound only while mounted, so a closed lightbox never
	// swallows an arrow key from the page beneath it.
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

	const idx = Math.min(Math.max(0, active.value), gallery.length - 1);
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
				<Backdrop visible={state === "open"} onClick={onClose} />
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

import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import type { EntityMedia } from "@projective/types/explore";
import { ViewIcon } from "../components/view-glyphs.tsx";
import { MediaLightbox } from "../components/MediaLightbox.tsx";

/**
 * MediaGallery — the legacy hero showcase: a vertical thumbnail strip whose HOVER (or focus) swaps
 * the large main image beside it, over the shared {@link MediaLightbox}.
 *
 * Its modal used to live inside this file. It is now the shared component, because the rebuilt
 * `EntityCanvas` media column needs the same dialog and a second copy would have drifted — the
 * keyboard shortcuts on one, the download control on the other.
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

	const safe = gallery.length > 0 ? gallery : [];
	const idx = Math.min(active.value, Math.max(0, safe.length - 1));

	function openAt(i: number): void {
		active.value = Math.min(Math.max(0, i), safe.length - 1);
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

			<MediaLightbox
				open={open}
				active={active}
				gallery={safe}
				title={title}
				onClose={() => (open.value = false)}
			/>
		</div>
	);
}

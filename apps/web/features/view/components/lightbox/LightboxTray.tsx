import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import type { LightboxMedia } from "../../types/lightbox-types.ts";
import { thumbOf } from "../../core/lightbox-model.ts";

/** Props for {@link LightboxTray}. */
export interface LightboxTrayProps {
	gallery: readonly LightboxMedia[];
	/** The clamped active index. */
	active: number;
	onSelect: (index: number) => void;
	onStep: (delta: -1 | 1) => void;
}

function prefersReducedMotion(): boolean {
	return document.documentElement.dataset.motion === "reduced" ||
		globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * The lightbox's bottom carousel: Previous, a scrolling strip of thumbnails whose active one is
 * marked and kept in view, Next, and the position readout. Rendered only for a gallery of two or
 * more, since a carousel of one is a control that does nothing.
 */
export function LightboxTray(
	{ gallery, active, onSelect, onStep }: LightboxTrayProps,
): JSX.Element {
	const stripRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const current = stripRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
		current?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});
	}, [active]);

	return (
		<div class="vw-lightbox__tray">
			<button
				type="button"
				class="vw-lightbox__step"
				aria-label="Previous image"
				onClick={() => onStep(-1)}
			>
				<Icon name="chevron-left" size="sm" optical="left" />
			</button>
			<div ref={stripRef} class="vw-lightbox__strip" role="group" aria-label="Gallery thumbnails">
				{gallery.map((m, i) => {
					const thumb = thumbOf(m);
					return (
						<button
							key={`${i}:${m.src}`}
							type="button"
							class="vw-lightbox__thumb"
							aria-label={`Show item ${i + 1} of ${gallery.length}`}
							aria-current={i === active ? "true" : undefined}
							onClick={() => onSelect(i)}
						>
							{thumb
								? <img src={thumb} alt="" loading="lazy" decoding="async" draggable={false} />
								: <Icon name="play" size="sm" />}
						</button>
					);
				})}
			</div>
			<button
				type="button"
				class="vw-lightbox__step"
				aria-label="Next image"
				onClick={() => onStep(1)}
			>
				<Icon name="chevron-right" size="sm" optical="right" />
			</button>
			<span class="vw-lightbox__counter" aria-live="polite">
				{active + 1} / {gallery.length}
			</span>
		</div>
	);
}

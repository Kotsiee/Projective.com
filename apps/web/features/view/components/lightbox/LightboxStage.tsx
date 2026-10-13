import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { LightboxMedia } from "../../types/lightbox-types.ts";
import type { LightboxViewport } from "../../hooks/useLightboxViewport.ts";

/** Props for {@link LightboxStage}. */
export interface LightboxStageProps {
	media: LightboxMedia;
	/** The gallery's name, the fallback accessible name of a picture without its own. */
	title: string;
	viewport: LightboxViewport;
	onClose: () => void;
}

/**
 * The lightbox's canvas: an embed-style container filling everything above the tray, the active
 * picture drawn against it by {@link LightboxViewport}, and the one floating Close control. A video
 * plays in place under its native controls and is never zoomed.
 */
export function LightboxStage(
	{ media, title, viewport, onClose }: LightboxStageProps,
): JSX.Element {
	const video = media.kind === "video";
	return (
		<div
			ref={viewport.stageRef}
			class="vw-lightbox__stage"
			data-kind={video ? "video" : "image"}
			data-zoomed={viewport.zoomed.value ? "true" : undefined}
			data-drawn={viewport.drawn.value ? "true" : undefined}
			{...viewport.stageHandlers}
		>
			{video
				? (
					<video
						key={media.src}
						class="vw-lightbox__video"
						src={media.src}
						poster={media.poster}
						aria-label={media.alt || title}
						controls
						playsInline
						preload="metadata"
					/>
				)
				: (
					<img
						key={media.src}
						ref={viewport.imgRef}
						class="vw-lightbox__img"
						src={media.src}
						alt={media.alt || title}
						draggable={false}
						decoding="async"
						onLoad={viewport.onLoad}
					/>
				)}
			<button
				type="button"
				class="vw-lightbox__close"
				aria-label="Close preview"
				onClick={onClose}
			>
				<Icon name="close" size="sm" />
			</button>
		</div>
	);
}

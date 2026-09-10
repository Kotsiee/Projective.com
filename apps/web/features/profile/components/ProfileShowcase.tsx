import type { JSX, Ref } from "preact";
import type { ProfileShowcase as ProfileShowcaseMedia } from "../types/profile-types.ts";

/**
 * ProfileShowcase — the hero's media frame: a muted, looping showreel or a high-resolution cover,
 * cropped to 16:10 at `--radius-xs`. A pure presentational component; the hero island owns the
 * reduced-motion decision and passes it down as `autoplay`, so SSR paints a playing reel for the
 * common viewer and the island withdraws it only when the preference says so.
 */
export interface ProfileShowcaseProps {
	showcase: ProfileShowcaseMedia;
	/** Whether a video may start on its own (default `true`). `false` leaves the poster in place. */
	autoplay?: boolean;
	/** The `<video>` element, so the owning island can pause it after hydration. */
	mediaRef?: Ref<HTMLVideoElement>;
}

export function ProfileShowcase(
	{ showcase, autoplay = true, mediaRef }: ProfileShowcaseProps,
): JSX.Element {
	if (showcase.kind === "video") {
		return (
			<div class="pf-showcase" data-kind="video">
				<video
					ref={mediaRef}
					class="pf-showcase__media"
					src={showcase.src}
					poster={showcase.poster}
					autoplay={autoplay}
					muted
					loop
					playsInline
					preload="metadata"
					aria-label={showcase.alt}
				/>
			</div>
		);
	}
	return (
		<div class="pf-showcase" data-kind="image">
			<img
				class="pf-showcase__media"
				src={showcase.src}
				alt={showcase.alt}
				loading="eager"
				decoding="async"
			/>
		</div>
	);
}

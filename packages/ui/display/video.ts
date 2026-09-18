/**
 * `@projective/ui/display/video` — the video player slice of `display`, as its own sub-path.
 *
 * The same reasoning as `./display/image`: a portfolio tile is a small island that renders one
 * video, and reaching the player through the `display` barrel would drag Table, Tree, Galleria,
 * Carousel and GMap into that bundle to draw two buttons. This door carries the player and the pure
 * rules it is built on — nothing that imports a stylesheet beyond the player's own.
 *
 * `./display` still re-exports everything here, so a surface already importing the barrel needs no
 * change.
 */

export { VideoPlayer } from "./islands/VideoPlayer.tsx";
export type {
	VideoPlayerCorner,
	VideoPlayerProps,
	VideoPlayerVariant,
} from "./islands/VideoPlayer.tsx";
export {
	clockLabel,
	controlsVisible,
	isPlayableSource,
	progressRatio,
	seekValueText,
} from "./core/video.ts";
export type { ControlsVisibilityInput } from "./core/video.ts";

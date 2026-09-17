/**
 * `@projective/ui/display/image` — the progressive-image slice of `display`, as its own sub-path.
 *
 * The same reasoning as `./display/money`: the page's image watcher is mounted on every route, and
 * reaching it through the `display` barrel would drag Table, Tree, Galleria, Carousel and GMap into
 * every client bundle to attach two event listeners. This door carries the frame component, the
 * watcher, and the pure decoder — nothing that imports a stylesheet beyond the frame's own.
 *
 * `./display` still re-exports everything here, so a surface already importing the barrel needs no
 * change.
 */

export { ProgressiveImage } from "./components/ProgressiveImage.tsx";
export type { ImagePlaceholder, ProgressiveImageProps } from "./components/ProgressiveImage.tsx";
export {
	PIMG_ATTR,
	settleProgressiveImage,
	settleProgressiveImages,
	watchProgressiveImages,
} from "./core/progressive-image.ts";
export type { ProgressiveImageState } from "./core/progressive-image.ts";
export { blurHashAverage, decodeBlurHash, isBlurHash } from "./core/blurhash.ts";

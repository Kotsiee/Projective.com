import type { ContentImage } from "@projective/types/content";

/**
 * The covers Projective's articles use until commissioned artwork replaces them: static assets under
 * `apps/web/static/test_images/` (served at `/test_images/…`), with their intrinsic sizes so every
 * reader reserves the box before the picture arrives. `banner_3.jpg` (3840×2160, 3.4 MB) is left out
 * on purpose — too heavy for a page's largest paint.
 */

/** A lone tree against a red moon. */
export const COVER_RED_MOON: ContentImage = {
	src: "/test_images/banner_1.jpg",
	alt: "A lone tree silhouetted against a red moon, reflected in still water",
	w: 643,
	h: 360,
};

/** A car photographed in motion. */
export const COVER_IN_MOTION: ContentImage = {
	src: "/test_images/banner_2.jpg",
	alt: "A silver sports car photographed in motion, the street behind it blurred",
	w: 1280,
	h: 720,
};

/** A person and a cat watching a mountain at dusk. */
export const COVER_MOUNTAIN_WATCH: ContentImage = {
	src: "/test_images/banner_4.jpg",
	alt:
		"Illustration of a person and a cat sitting on a hillside, watching a snow-capped mountain under a starry dusk sky",
	w: 710,
	h: 488,
};

/** A peak against an orange sun. */
export const COVER_ORANGE_SUN: ContentImage = {
	src: "/test_images/banner_5.jpg",
	alt: "A black-and-white mountain peak against a large orange sun, reflected in dark water",
	w: 1920,
	h: 1080,
};

/** An inline figure with no artwork yet: a labelled 1200×675 placeholder. */
export function placeholderFigure(label: string): string {
	return `https://placehold.co/1200x675?text=${encodeURIComponent(label).replace(/%20/g, "+")}`;
}

import type { ContentImage } from "@projective/types/content";

/**
 * The covers Projective's articles use until commissioned artwork replaces them: static assets under
 * `apps/web/static/test_images/` (served at `/test_images/…`), with their intrinsic sizes so every
 * reader reserves the box before the picture arrives. One cover per article, so no two articles are
 * told apart only by their titles. `banner_3.jpg` (3840×2160, 3.4 MB) and `banner_9.webp` (2.7 MB)
 * are left out on purpose — too heavy for a page's largest paint — and `banner_6.webp` (320×320) is
 * too small and square to fill the reader's column.
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

/** A sports car under palm trees at dusk. */
export const COVER_PALM_DUSK: ContentImage = {
	src: "/test_images/banner_7.jpg",
	alt:
		"Illustration of a teal sports car parked beneath tall palm trees silhouetted against a pink and violet dusk sky",
	w: 768,
	h: 432,
};

/** Fried eggs drifting like planets. */
export const COVER_EGG_ORBITS: ContentImage = {
	src: "/test_images/banner_8.webp",
	alt:
		"Illustration of fried eggs drifting like planets across a deep-blue starry sky, each ringed by thin orbit lines",
	w: 1536,
	h: 1152,
};

/** An inline figure with no artwork yet: a labelled 1200×675 placeholder. */
export function placeholderFigure(label: string): string {
	return `https://placehold.co/1200x675?text=${encodeURIComponent(label).replace(/%20/g, "+")}`;
}

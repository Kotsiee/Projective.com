import type { ChangelogRelease } from "@projective/types/editorial";
import type { ChangelogGallery } from "../types/gallery.ts";
import { releaseAnchorId } from "./changelog-url.ts";
import { releaseLabel } from "./changelog-meta.ts";

/**
 * The lightbox's galleries for the releases on a page — one per release that has pictures, keyed by
 * the release's anchor id, so `?image=v0-12-0:2` resolves to the second picture of 0.12.0. Plain
 * data: it crosses into the island as props.
 */
export function galleriesFor(releases: readonly ChangelogRelease[]): ChangelogGallery[] {
	return releases
		.filter((release) => release.images.length > 0)
		.map((release) => ({
			entry: releaseAnchorId(release.version),
			title: releaseLabel(release),
			images: release.images.map((image) => ({
				src: image.src,
				alt: image.alt,
				caption: image.caption,
			})),
		}));
}

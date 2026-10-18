import type { JSX } from "preact";
import type { ChangelogImage } from "@projective/types/editorial";
import { formatImageParam } from "../core/image-param.ts";

/** Props for {@link ReleaseGallery}. */
export interface ReleaseGalleryProps {
	/** The release's anchor id — the gallery's `?image=` entry id and the prefix of its ids. */
	entry: string;
	/** The release's version, for the gallery's accessible name. */
	version: string;
	images: readonly ChangelogImage[];
}

/**
 * ReleaseGallery — a release's pictures in a responsive grid of 16:10 tiles, each a real link to
 * the picture (`href` = the image itself, so it works with no JavaScript) that the changelog
 * lightbox island intercepts by its `data-chl-image` address (`?image=<entry>:<n>`). Every `<img>`
 * carries its intrinsic width and height, so nothing shifts while it loads, and loads lazily — a
 * gallery always follows its release's whole body, below the fold. Every picture has a caption,
 * under its tile, which also describes the link.
 *
 * Server-rendered and stylesheet-free (the changelog sheet arrives with the lightbox island).
 */
export function ReleaseGallery(
	{ entry, version, images }: ReleaseGalleryProps,
): JSX.Element | null {
	if (images.length === 0) return null;
	return (
		<ul
			class="chl-gallery"
			role="list"
			aria-label={`Pictures from v${version}`}
			data-count={images.length}
		>
			{images.map((image, i) => {
				const captionId = `${entry}-pic-${i + 1}`;
				return (
					<li key={image.src} class="chl-gallery__item">
						<figure class="chl-shot">
							<a
								class="chl-shot__link"
								href={image.src}
								data-chl-image={formatImageParam(entry, i + 1)}
								aria-describedby={captionId}
							>
								<img
									class="chl-shot__img"
									src={image.src}
									alt={image.alt}
									width={image.w}
									height={image.h}
									loading="lazy"
									decoding="async"
								/>
								<span class="ui-visually-hidden">, view larger</span>
							</a>
							<figcaption id={captionId} class="chl-shot__caption">{image.caption}</figcaption>
						</figure>
					</li>
				);
			})}
		</ul>
	);
}

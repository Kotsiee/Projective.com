import type { JSX } from "preact";
import { Carousel } from "@projective/ui/display";
import "../styles/article-view.css";
import { type ViewGlyph, ViewIcon } from "../components/view-glyphs.tsx";
import type { ArticleAsset } from "@projective/types/explore";

/**
 * ArticleMediaGallery — the "media used in this article" strip below the body: a responsive,
 * drag-swipeable, looping {@link Carousel} of rounded-square cards, one per media asset (image · video
 * thumbnail with a play badge · audio clip). Reuses the `@projective/ui` Carousel wholesale (the library
 * owns the interaction); this island just maps assets to their card template.
 */
export interface ArticleMediaGalleryProps {
	assets: ArticleAsset[];
}

const KIND_ICON: Record<ArticleAsset["kind"], ViewGlyph> = {
	image: "image",
	video: "video",
	audio: "audio",
};

function MediaCard(asset: ArticleAsset): JSX.Element {
	return (
		<div class="art-mediacard" data-kind={asset.kind}>
			<div class="art-mediacard__frame">
				{asset.kind === "audio"
					? (
						<div class="art-mediacard__audio" aria-hidden="true">
							<ViewIcon name="audio" size={30} />
						</div>
					)
					: (
						<img
							class="art-mediacard__img"
							src={asset.thumb}
							alt={asset.label}
							loading="lazy"
						/>
					)}
				{asset.kind === "video"
					? (
						<span class="art-mediacard__play" aria-hidden="true">
							<ViewIcon name="play" size={22} />
						</span>
					)
					: null}
				{asset.durationLabel ? <span class="art-mediacard__dur">{asset.durationLabel}</span> : null}
			</div>
			<span class="art-mediacard__label">
				<ViewIcon name={KIND_ICON[asset.kind]} size={13} />
				<span>{asset.label}</span>
			</span>
		</div>
	);
}

export default function ArticleMediaGallery(
	{ assets }: ArticleMediaGalleryProps,
): JSX.Element | null {
	if (assets.length === 0) return null;
	return (
		<Carousel
			class="art-gallery"
			aria-label="Media used in this article"
			value={assets}
			itemTemplate={(asset) => <div class="art-gallery__slide">{MediaCard(asset)}</div>}
			numVisible={4}
			numScroll={1}
			circular={assets.length > 4}
			responsiveOptions={[
				{ breakpoint: "1200px", numVisible: 3, numScroll: 1 },
				{ breakpoint: "820px", numVisible: 2, numScroll: 1 },
				{ breakpoint: "520px", numVisible: 1, numScroll: 1 },
			]}
		/>
	);
}

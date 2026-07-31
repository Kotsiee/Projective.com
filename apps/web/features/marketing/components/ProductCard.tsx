import type { JSX } from "preact";
import { OwnerBadge } from "@features/explore/components/OwnerBadge.tsx";
import { ownerForHandle } from "../core/showcase-owner.ts";
import { type ProductShowcase } from "../core/landing-data.ts";

/**
 * ProductCard — a ready-to-buy digital product in the landing masonry.
 *
 * Renders the CANONICAL discovery card contract (`.ex-card--product`, defined once in
 * `features/explore/styles/explore.css` and `@import`ed by `landing.css`) rather than a parallel
 * `.lp-product` block, so the landing masonry and the search masonry are the same object. Media-forward:
 * the image's own intrinsic ratio drives the tile height, which is what makes the masonry interlock,
 * and the price rides the media as an overlay chip instead of taking a foot.
 *
 * Two fixes come with the merge. The price chip was a 60%-translucent veil over an arbitrary product
 * photograph — measured 3.75:1 against a light image in dark theme, below WCAG AA — and now takes the
 * family's solid `--ex-chip-on-media` label surface. And the card carried a `--lp-span` custom property
 * for its supposed masonry weight that no stylesheet has ever read; the staggering has always come from
 * the intrinsic image ratio, so the dead plumbing is gone rather than left as a false claim.
 *
 * Zero client JS.
 */
export function ProductCard({ product }: { product: ProductShowcase }): JSX.Element {
	return (
		<article class="ex-card ex-card--product">
			<a
				class="ex-card__link"
				href={`/view/${product.slug}?type=products`}
				aria-label={`${product.title} by ${product.maker} — ${product.price}`}
			/>
			<div class="ex-media">
				<img src={product.thumb} alt="" loading="lazy" decoding="async" />
				<span class="ex-flags">
					<span class="ex-media__price">{product.price}</span>
				</span>
			</div>
			<div class="ex-card__body">
				<span class="ex-eyebrow">{product.category}</span>
				<h3 class="ex-card__title ex-card__title--sm">{product.title}</h3>
				<div class="ex-card__byline">
					<OwnerBadge owner={ownerForHandle(product.makerHandle)} variant="mini" />
				</div>
			</div>
		</article>
	);
}

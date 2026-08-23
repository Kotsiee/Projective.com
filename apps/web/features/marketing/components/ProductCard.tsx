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
 * the image's own intrinsic ratio drives the tile height within a bounded frame, which is what makes
 * the masonry interlock.
 *
 * The price moved off the image and into the foot with the rest of the family: it was the only price
 * whose legibility depended on the photograph a seller uploaded (the overlay chip measured 3.75:1
 * against a light image in dark theme). The card also carried a `--lp-span` custom property for its
 * supposed masonry weight that no stylesheet has ever read; the staggering has always come from the
 * intrinsic image ratio, so the dead plumbing is gone rather than left as a false claim.
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
			<div class="ex-media ex-media--free">
				<img src={product.thumb} alt="" loading="lazy" decoding="async" />
			</div>
			<div class="ex-card__body">
				<OwnerBadge owner={ownerForHandle(product.makerHandle)} variant="creator" />
				<h3 class="ex-card__title ex-card__title--sm">{product.title}</h3>
				<div class="ex-card__kindrow">
					<span class="ex-kind">{product.category}</span>
				</div>
				<div class="ex-card__foot">
					<span />
					<span class="ex-pricebadge">{product.price}</span>
				</div>
			</div>
		</article>
	);
}

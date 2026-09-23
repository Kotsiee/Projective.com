import type { JSX } from "preact";
import { ProgressiveImage } from "@projective/ui/display";
import { productMediaAspect } from "@projective/types/explore";
import { profileHref } from "@features/explore/core/routing.ts";
import { vars } from "../core/style.ts";
import { type ProductShowcase } from "../core/landing-data.ts";

/** The synthetic geometry the image attributes reserve before its bytes arrive (the work-tile rule). */
const GEOMETRY_WIDTH = 1000;

/**
 * ProductCard — a ready-to-buy digital product in the landing masonry.
 *
 * Renders the CANONICAL discovery card contract (`.ex-card--product` + `.ex-prod`, defined once in
 * `features/explore/styles/explore.css` and `@import`ed by `landing.css`) rather than a parallel
 * `.lp-product` block, so the landing masonry and the search masonry are the same object: a prominent
 * picture with a compact, muted title · owner · category · price beneath it.
 *
 * The tile's ratio comes from the SAME `productMediaAspect` the discovery card calls — the cover's
 * measured dimensions when the upload recorded them, the `span`-derived crop otherwise — clamped into
 * the same showcase band.
 *
 * Zero client JS.
 */
export function ProductCard({ product }: { product: ProductShowcase }): JSX.Element {
	const aspect = productMediaAspect({ span: product.span, mediaMeta: product.mediaMeta });
	const height = Math.max(1, Math.round(GEOMETRY_WIDTH / aspect.ratio));
	return (
		<article
			class="ex-card ex-card--product"
			data-layout="masonry"
			data-fit={aspect.fit}
			style={vars({ "--ex-prod-ratio": aspect.ratio })}
		>
			<a
				class="ex-card__link"
				href={`/view/${product.slug}?type=products`}
				aria-label={`${product.title} by ${product.owner.name} — ${product.price}`}
			/>
			<div class="ex-media ex-media--product">
				<ProgressiveImage
					src={product.thumb}
					placeholder={product.thumbPlaceholder}
					alt=""
					width={GEOMETRY_WIDTH}
					height={height}
					loading="lazy"
				/>
			</div>
			<div class="ex-prod">
				<h3 class="ex-prod__title">{product.title}</h3>
				<p class="ex-prod__meta">
					<a class="ex-prod__owner" href={profileHref(product.owner.handle)}>
						{product.owner.name}
					</a>
					<span class="ex-prod__sep" aria-hidden="true">·</span>
					<span class="ex-prod__kind">{product.category}</span>
				</p>
				<div class="ex-prod__foot">
					<span />
					<span class="ex-pricebadge ex-pricebadge--compact">
						<span class="ex-pricebadge__amount">{product.price}</span>
					</span>
				</div>
			</div>
		</article>
	);
}

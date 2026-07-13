import type { JSX } from "preact";
import { type ProductShowcase, routes } from "../core/landing-data.ts";
import { vars } from "../core/style.ts";

/**
 * ProductCard — a ready-to-buy digital product in the staggered masonry. The card is the route action
 * (anchor → product page). `span` drives its column weight so the masonry breathes with a natural,
 * non-uniform rhythm. Zero client JS.
 */
export function ProductCard({ product }: { product: ProductShowcase }): JSX.Element {
	return (
		<a
			class="lp-card lp-product"
			href={routes.product(product.slug)}
			style={vars({ "--lp-span": product.span })}
			aria-label={`${product.title} by ${product.maker} — ${product.price}`}
		>
			<div class="lp-product__media">
				<img class="lp-product__img" src={product.thumb} alt="" loading="lazy" decoding="async" />
				<span class="lp-product__price">{product.price}</span>
			</div>
			<div class="lp-product__body">
				<span class="lp-product__category">{product.category}</span>
				<h3 class="lp-product__title">{product.title}</h3>
				<span class="lp-product__maker">{product.maker}</span>
			</div>
		</a>
	);
}

import type { JSX } from "preact";
import { ProgressiveImage, RatingStars } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { productMediaAspect } from "@projective/types/explore";
import { vars } from "@features/marketing/core/style.ts";
import { CardLink } from "../CardLink.tsx";
import { PromotedBadge } from "../PromotedBadge.tsx";
import { StatusChip } from "../StatusChip.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { cardAccent } from "../../core/accent.ts";
import { ratingSignals } from "../../core/card-signals.ts";
import { itemHref, profileHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProductItem } from "../../types/explore-types.ts";

/**
 * The two ways a product tile is laid out.
 *
 * `masonry` — the tile's height follows the cover's own ratio (clamped to the showcase band), which is
 * what makes a CSS-column masonry interlock. `fixed` — the tile takes the family's 16:10 frame so it
 * sits in a uniform-height rail or grid beside services; the cover is cropped into it. The picture is
 * the same either way; only the box around it changes.
 */
export type ProductCardLayout = "masonry" | "fixed";

/** The synthetic geometry the image attributes reserve before its bytes arrive (the work-tile rule). */
const GEOMETRY_WIDTH = 1000;

/**
 * ProductCard — a ready-to-buy digital product, in the register of the profile's work tile: a
 * prominent picture with compact, muted metadata beneath it. Tighter padding and a smaller type
 * scale than a service card, because a product is scanned as an IMAGE first and read second, and a
 * masonry column holds four of them where a services grid holds one.
 *
 * ## The picture governs the tile, inside a band
 *
 * The tile's ratio is {@link productMediaAspect}: the measured `mediaMeta` (what the upload extractor
 * stored — `width` · `height` · `aspectRatio`) clamped into the showcase band (4:5 to 16:9,
 * `files/aspect.ts`), falling back to the `span`-derived ratio for a row that predates measurement.
 * A picture inside the band is drawn whole; one outside it is cropped into the nearer bound with
 * `object-fit: cover`, and the card says so (`data-fit="cover"`) rather than letting a tower or a
 * panorama run away with a column. The ratio reaches the stylesheet as ONE custom property, so the
 * masonry rule never branches on the picture.
 *
 * ## Owner and category are one muted line
 *
 * `Name · Category` in the meta register (§B.11 — non-actionable metadata is inline middot text,
 * never a chip). The name is still a real anchor to the profile, stacked above the stretched card
 * link so it stays independently clickable; the category is inert.
 *
 * A SERVER component: the ratio is computed at render, so the first byte already reserves every
 * tile's box and a column never reflows as pictures land.
 */
export function ProductCard(
	{ item, ctx = { scope: "explore" }, onSelect, authed = false, layout = "masonry" }: {
		item: ProductItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
		layout?: ProductCardLayout;
	},
): JSX.Element {
	const review = item.rating?.asHelper ?? item.rating?.asClient;
	const signals = ratingSignals(item.rating);
	const aspect = productMediaAspect(item);
	const height = Math.max(1, Math.round(GEOMETRY_WIDTH / aspect.ratio));

	return (
		<article
			class="ex-card ex-card--product"
			data-item-id={item.id}
			data-item-type={item.type}
			data-ambient-src={item.media}
			data-layout={layout}
			data-fit={aspect.fit}
			style={vars({
				"--ex-accent": cardAccent(item.id),
				"--ex-prod-ratio": aspect.ratio,
			})}
		>
			<CardLink
				item={item}
				ctx={ctx}
				onSelect={onSelect}
				label={`${item.title} by ${item.owner.name} — ${item.price}`}
			/>
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} />

			<div class="ex-media ex-media--product">
				<ProgressiveImage
					src={item.media}
					placeholder={item.mediaPlaceholder}
					alt=""
					width={GEOMETRY_WIDTH}
					height={height}
					loading="lazy"
				/>
				{signals.length > 0 && (
					<span class="ex-signals">
						{signals.map((s) => <StatusChip signal={s} key={s.id} />)}
					</span>
				)}
				{item.sponsored && <PromotedBadge />}
			</div>

			<div class="ex-prod">
				<h3 class="ex-prod__title">{item.title}</h3>

				<p class="ex-prod__meta">
					<a class="ex-prod__owner" href={profileHref(item.owner.handle)}>
						{item.owner.name}
					</a>
					<span class="ex-prod__sep" aria-hidden="true">·</span>
					<span class="ex-prod__kind">{item.category}</span>
				</p>

				<div class="ex-prod__foot">
					{review
						? (
							<span class="ex-ratingpill">
								<RatingStars value={review.value} count={review.count} size="sm" compact />
							</span>
						)
						: <span />}

					{
						/* One line, no unit: a product is a fixed purchase and has nothing to be priced PER.
						   `hideOrigin` keeps the conversion tail off the foot — `MoneyView` still names the
						   origin and the rate in its accessible label. */
					}
					<span class="ex-pricebadge ex-pricebadge--compact">
						<span class="ex-pricebadge__amount">
							{typeof item.priceMinor === "number"
								? (
									<MoneyView
										minor={item.priceMinor}
										currency={item.currency ?? "USD"}
										hideOrigin
									/>
								)
								: item.price}
						</span>
					</span>
				</div>
			</div>
		</article>
	);
}

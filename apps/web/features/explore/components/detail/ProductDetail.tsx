import type { JSX } from "preact";
import { OwnerBadge } from "../OwnerBadge.tsx";
import {
	DetailHead,
	DetailMedia,
	DetailPrice,
	DetailSkills,
	DetailSummary,
	Fact,
	FactGrid,
	RatingFact,
} from "./DetailParts.tsx";
import { subjectRating } from "../../core/card-signals.ts";
import { facetValueLabel } from "../../core/filter-config.ts";
import type { ProductItem } from "../../types/explore-types.ts";

/** ProductDetail — a digital product at a glance: cover, category and title, creator, price, rating. */
export function ProductDetail(
	{ item, titleId }: { item: ProductItem; titleId: string },
): JSX.Element {
	const category = item.category ? facetValueLabel("products", "cat", item.category) : null;
	const amount = typeof item.priceMinor === "number"
		? { minor: item.priceMinor, currency: item.currency ?? "USD" }
		: null;

	return (
		<>
			{item.media && <DetailMedia src={item.media} placeholder={item.mediaPlaceholder} />}
			<DetailHead
				eyebrow={category ? ["Product", category] : ["Product"]}
				title={item.title}
				titleId={titleId}
			>
				<OwnerBadge owner={item.owner} size="md" />
			</DetailHead>
			<FactGrid>
				<Fact label="Price">
					<DetailPrice amount={amount} fallback={item.price} />
				</Fact>
				<RatingFact label="Product rating" rating={subjectRating(item)} />
			</FactGrid>
			<DetailSummary text={item.summary} />
			<DetailSkills skills={item.skills} />
		</>
	);
}

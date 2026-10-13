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
import { serviceTypeLabel, subjectRating } from "../../core/card-signals.ts";
import { facetValueLabel } from "../../core/filter-config.ts";
import { serviceStartingPrice } from "../../core/pricing.ts";
import type { ServiceItem } from "../../types/explore-types.ts";

/**
 * ServiceDetail — a service at a glance: cover, category and title, the provider, then price ·
 * delivery · delivery model · the SERVICE's own rating, and the description excerpt.
 */
export function ServiceDetail(
	{ item, titleId }: { item: ServiceItem; titleId: string },
): JSX.Element {
	const price = serviceStartingPrice(item);
	const category = item.category ? facetValueLabel("services", "cat", item.category) : null;

	return (
		<>
			{item.media && <DetailMedia src={item.media} placeholder={item.mediaPlaceholder} />}
			<DetailHead
				eyebrow={category ? ["Service", category] : ["Service"]}
				title={item.title}
				titleId={titleId}
			>
				<OwnerBadge owner={item.owner} size="md" />
			</DetailHead>
			<FactGrid>
				<Fact label="Price">
					<DetailPrice {...price} />
				</Fact>
				{item.delivery && <Fact label="Delivery">{item.delivery}</Fact>}
				<Fact label="Type">{serviceTypeLabel(item.serviceType)}</Fact>
				<RatingFact label="Service rating" rating={subjectRating(item)} />
			</FactGrid>
			{price.isFloor && (
				<p class="ex-detail__note">
					The Low-intensity rate. Each ticket's intensity sets its price, up to twice the standard
					rate.
				</p>
			)}
			<DetailSummary text={item.summary} />
			<DetailSkills skills={item.skills} />
		</>
	);
}

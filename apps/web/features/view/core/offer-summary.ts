import type { EntityView, ExploreItem } from "@projective/types/explore";
import type { ImagePlaceholder } from "@projective/types/files";
import { headlinePriceFor } from "./view-pricing.ts";
import type { LedgerPrice } from "./conversion-ledger.ts";

/**
 * The listing facts a `/view` conversion dialog's offer column renders beside the buyer's inputs
 * (Decision #424) — resolved once on the page from the SAME view the lane and the body read, so the
 * dialog names the thing, its seller and its price exactly as the page does. Plain data: it crosses
 * into the booking overlay layer as an island prop.
 */
export interface OfferSummary {
	title: string;
	cover: { src: string; alt: string; placeholder?: ImagePlaceholder } | null;
	owner: ExploreItem["owner"];
	price: LedgerPrice;
	/** The listing's turnaround, as the page states it. */
	delivery: string | null;
	/** The listing's included revisions, as the page states them. */
	revisions: string | null;
}

/** Resolve a view's {@link OfferSummary}. A video leads with its poster frame. */
export function offerSummaryFor(view: EntityView): OfferSummary {
	const { item } = view;
	const media = view.gallery[0] ?? null;
	const price = headlinePriceFor(view);
	return {
		title: item.title,
		cover: media
			? media.kind === "image"
				? { src: media.src, alt: media.alt, placeholder: media.placeholder }
				: { src: media.thumb, alt: media.alt, placeholder: media.thumbPlaceholder }
			: null,
		owner: item.owner,
		price: {
			amount: price.amount,
			fallback: price.fallback,
			unit: price.unit,
			isFloor: price.isFloor,
		},
		delivery: item.type === "services" && item.delivery ? item.delivery : null,
		revisions: view.trust.find((t) => t.icon === "revisions")?.value ?? null,
	};
}

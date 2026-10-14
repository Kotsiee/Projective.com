import type { ListingMetrics, ListingPricing } from "../catalogue/catalogue.ts";
import { coverOf, type ListingMediaSlot } from "../catalogue/media.ts";
import { aspectRatioOf } from "../files/aspect.ts";
import { currencyExponent, toMajorUnits, toMinorUnits } from "../finance/wallet.ts";
import type { ExploreOwner, ProductItem, ServiceItem, ServiceType, SkillRef } from "./items.ts";

/**
 * explore.listing-card — the ONE mapping from a catalogue listing to the discovery card item.
 *
 * `/explore`, `/view`, the landing showcase and the seller workspace's live card all render a listing
 * through the real `ServiceCard` / `ProductCard`. They used to build that item twice: the explore
 * assembler from database rows, the workspace from the edited `ListingDetail`. Two mappings drift (a
 * pound listing previewed in dollars, a cover that was not slot 1), so both now call
 * {@link listingCardItem} with a {@link ListingCardSource}. `ListingDetail` satisfies the source as it
 * is; the explore assembler builds one from its rows.
 */

// #region Source
/** One showcase slot, as much of it as a card reads. */
export type ListingCardMedia = Pick<
	ListingMediaSlot,
	"position" | "kind" | "src" | "placeholder" | "width" | "height"
>;

/**
 * The minimal structural input a card is drawn from. Prices are MAJOR units in `currency`, as the
 * workspace edits them.
 */
export interface ListingCardSource {
	/** The listing's address: its subject's slug (`svc-…` / `prd-…`). */
	id: string;
	kind: "product" | "service";
	/** The delivery model; `null` for a product, or a service whose model is not chosen yet. */
	serviceType: ServiceType | null;
	title: string;
	owner: ExploreOwner;
	skills: SkillRef[];
	descriptionText: string;
	media: readonly ListingCardMedia[];
	category: string;
	delivery: string;
	currency: string;
	pricing: Pick<
		ListingPricing,
		"amount" | "ticketPrice" | "sessionPrice" | "freeRevisions" | "extraRevisionPrice"
	>;
	metrics: Pick<ListingMetrics, "avgRating" | "ratingCount">;
	/** Whether the card carries the sponsored mark. */
	promoted: boolean;
	updatedAt: string;
	/** When the listing first went live (else when it was created); the card's "Newest" key. */
	listedAt?: string;
	/** A product's masonry cell weight. */
	span?: 1 | 2 | 3;
}
// #endregion

// #region Money
/**
 * Minor units as the card's display string (`$4,800`, `$99.50`). Whole amounts drop the decimals and
 * fractional ones keep them, through the currency's own exponent, so a JPY `5000` is ¥5,000.
 */
export function displayPrice(minor: number, currency: string): string {
	const exponent = currencyExponent(currency);
	const whole = minor % 10 ** exponent === 0;
	const amount = toMajorUnits(minor, currency) ?? 0;
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency,
			minimumFractionDigits: whole ? 0 : exponent,
			maximumFractionDigits: whole ? 0 : exponent,
		}).format(amount);
	} catch {
		return `${amount.toFixed(whole ? 0 : exponent)} ${currency}`;
	}
}

/** The string a card shows when the listing has no fixed price yet. */
export const UNPRICED_LABEL = "Set a price";
// #endregion

// #region Adapter
/**
 * The discovery card item for a listing. Pure: the same source always yields the same item, which is
 * what lets the workspace promise its live card is the card buyers see.
 *
 * Never invents: an unpriced listing carries no `priceMinor`, a listing without reviews no rating,
 * and a listing without a slot-1 still no media.
 */
export function listingCardItem(source: ListingCardSource): ServiceItem | ProductItem {
	const currency = source.currency.toUpperCase();
	const amountMinor = source.pricing.amount > 0
		? toMinorUnits(source.pricing.amount, currency) ?? undefined
		: undefined;
	const cover = coverOf(source.media);
	const rating = source.metrics.ratingCount > 0
		? {
			asHelper: {
				value: Math.round(source.metrics.avgRating * 10) / 10,
				count: source.metrics.ratingCount,
			},
		}
		: undefined;
	const common = {
		id: source.id,
		owner: source.owner,
		skills: source.skills,
		summary: source.descriptionText,
		media: cover?.src || undefined,
		mediaPlaceholder: cover?.placeholder,
		sponsored: source.promoted,
		createdAt: source.listedAt ?? source.updatedAt,
		price: amountMinor === undefined ? UNPRICED_LABEL : displayPrice(amountMinor, currency),
		priceMinor: amountMinor,
		currency,
		rating,
	};

	if (source.kind === "service") {
		return {
			...common,
			type: "services",
			title: source.title || "Untitled service",
			delivery: source.delivery,
			category: source.category,
			serviceType: source.serviceType ?? "One-Off",
			ticketPrice: source.pricing.ticketPrice ?? undefined,
			sessionPrice: source.pricing.sessionPrice ?? undefined,
			freeRevisions: source.pricing.freeRevisions ?? undefined,
			extraRevisionPrice: source.pricing.extraRevisionPrice ?? undefined,
		};
	}
	const width = cover?.width;
	const height = cover?.height;
	return {
		...common,
		type: "products",
		title: source.title || "Untitled product",
		category: source.category,
		span: source.span ?? 1,
		mediaMeta: width && height
			? { width, height, aspectRatio: aspectRatioOf(width, height) }
			: undefined,
	};
}
// #endregion

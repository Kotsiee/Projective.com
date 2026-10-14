import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { statusMeta } from "../core/catalogue-model.ts";
import type { ListingSummary } from "../types/catalogue-types.ts";

/**
 * ListingLaneRow — one listing in the outline lane: a round cover thumbnail (or the kind glyph), the
 * title, and iconographic signals only — needs attention, promoted, live — whose words live in the
 * tooltip and the accessible name. Links to the workspace; the current listing is marked.
 */
export interface ListingLaneRowProps {
	listing: ListingSummary;
	href: string;
	active: boolean;
}

export function ListingLaneRow({ listing, href, active }: ListingLaneRowProps): JSX.Element {
	const meta = statusMeta(listing.status);
	const signals = [
		listing.needsAttention ? "needs attention" : null,
		listing.promoted ? "promoted" : null,
		meta.label.toLowerCase(),
	].filter(Boolean).join(", ");
	return (
		<a
			class={active ? "cat-lrow cat-lrow--active" : "cat-lrow"}
			href={href}
			aria-current={active ? "page" : undefined}
		>
			<span class="cat-lrow__icon" aria-hidden="true">
				{listing.cover
					? <img class="cat-lrow__thumb" src={listing.cover} alt="" loading="lazy" />
					: <Icon name={listing.kind === "service" ? "service" : "box"} />}
			</span>
			<span class="cat-lrow__title">
				{listing.title}
				<span class="ui-visually-hidden">, {signals}</span>
			</span>
			<span class="cat-lrow__signals" aria-hidden="true">
				{listing.needsAttention && (
					<Tooltip content="Needs attention" placement="top">
						<span class="cat-lrow__sig cat-lrow__sig--alert">
							<Icon name="warning" />
						</span>
					</Tooltip>
				)}
				{listing.promoted && (
					<Tooltip content="Promoted" placement="top">
						<span class="cat-lrow__sig cat-lrow__sig--promo">
							<Icon name="star" filled />
						</span>
					</Tooltip>
				)}
				{listing.status === "published" && (
					<Tooltip content={meta.label} placement="top">
						<span class="cat-lrow__dot" />
					</Tooltip>
				)}
			</span>
		</a>
	);
}

import type { JSX, RefObject } from "preact";
import { useRef } from "preact/hooks";
import { Tooltip } from "@projective/ui/feedback";
import { SelectionCheck } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { ActionMenu } from "@projective/ui/navigation";
import { statusMeta } from "../core/catalogue-model.ts";
import type { ListingAction } from "../core/console-actions.ts";
import { listingMenu } from "../core/listing-menu.ts";
import type { ListingSummary } from "../types/catalogue-types.ts";

/**
 * ListingCard — the owner card in the console grid: the cover (or kind glyph) carrying the lifecycle
 * chip and the promoted disclosure, the title as a stretched link to the workspace, the price, and
 * one line of middot meta. A circular selection check selects it for the batch bar — revealed on
 * hover or focus, and always while a selection exists; Shift extends from the last one toggled. The kebab opens the
 * lifecycle menu, adapted to the status: Archive for anything not archived, and Delete only for a
 * listing no buyer has engaged with (`deletable`). It is the table row's {@link listingMenu}, and
 * right-clicking the card opens it too (Decision #222). Dumb: selection and actions go to the island.
 */

export interface ListingCardProps {
	listing: ListingSummary;
	/** Where the title links; `null` draws the title unlinked (a reader with nowhere to go). */
	href: string | null;
	selected: boolean;
	/** A selection exists, so every card shows its checkbox. */
	selecting: boolean;
	onSelect: (listing: ListingSummary, range: boolean) => void;
	onAction: (action: ListingAction, listing: ListingSummary) => void;
	/**
	 * Draw the card without its selection checkbox and its actions menu — for a host that shows the
	 * listings but owns no selection and no listing writes (a team console's Catalogue module, Decision
	 * #308). Every control the card draws must work, so the ones the host cannot honour are absent.
	 */
	readOnly?: boolean;
}

/** The meta line: what it is, then how it has done. */
function metaParts(listing: ListingSummary): string[] {
	const parts = [listing.kind === "service" ? listing.serviceType ?? "Service" : "Product"];
	const { views, orders, avgRating, ratingCount } = listing.metrics;
	parts.push(`${views.toLocaleString("en-US")} ${views === 1 ? "view" : "views"}`);
	parts.push(`${orders.toLocaleString("en-US")} ${orders === 1 ? "order" : "orders"}`);
	if (avgRating > 0) parts.push(`Rated ${avgRating.toFixed(1)} (${ratingCount})`);
	return parts;
}

export function ListingCard(props: ListingCardProps): JSX.Element {
	const { listing, href, selected, selecting, onSelect, onAction } = props;
	const cardRef = useRef<HTMLElement>(null);
	const meta = statusMeta(listing.status);

	return (
		<article
			ref={cardRef}
			class="cat-card"
			data-status={listing.status}
			data-kind={listing.kind}
			data-selected={selected ? "true" : undefined}
			data-selecting={selecting ? "true" : undefined}
		>
			<div class="cat-card__media">
				{listing.cover
					? <img class="cat-card__img" src={listing.cover} alt="" loading="lazy" />
					: (
						<span class="cat-card__placeholder" aria-hidden="true">
							<Icon name={listing.kind === "service" ? "service" : "box"} size="xl" />
						</span>
					)}
				<div class="cat-card__flags">
					<span class="cat-card__status" data-tone={meta.tone}>{meta.label}</span>
					{listing.promoted && (
						<span class="cat-card__promo">
							<Icon name="star" filled /> Promoted
						</span>
					)}
					{listing.needsAttention && (
						<Tooltip content="Needs attention" placement="top">
							<span class="cat-card__alert" role="img" aria-label="Needs attention">
								<Icon name="warning" />
							</span>
						</Tooltip>
					)}
				</div>
			</div>

			{!props.readOnly && (
				<button
					type="button"
					role="checkbox"
					class="cat-card__select"
					aria-checked={selected}
					aria-label={`Select ${listing.title}`}
					onClick={(e) => onSelect(listing, e.shiftKey)}
				>
					<SelectionCheck checked={selected} />
				</button>
			)}

			<div class="cat-card__body">
				<h3 class="cat-card__title">
					{href ? <a class="cat-card__link" href={href}>{listing.title}</a> : listing.title}
				</h3>
				<span class="cat-card__price">{listing.price.display}</span>
				<p class="cat-card__meta">
					{metaParts(listing).map((part, i) => (
						<span key={part} class="cat-card__metapart">
							{i > 0 && <span class="cat-card__dot" aria-hidden="true">·</span>}
							{part}
						</span>
					))}
				</p>
			</div>

			{!props.readOnly && (
				<ActionMenu
					model={listingMenu(listing, onAction)}
					surface={cardRef}
					placement="bottom-end"
					aria-label={`Actions for ${listing.title}`}
					trigger={(api) => (
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class="cat-card__kebab"
							aria-haspopup="menu"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							aria-label={`Actions for ${listing.title}`}
							onClick={api.toggle}
						>
							<Icon name="kebab" />
						</button>
					)}
				/>
			)}
		</article>
	);
}

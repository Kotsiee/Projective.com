import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import { statusMeta } from "../core/catalogue-model.ts";
import type { ListingAction } from "../core/console-actions.ts";
import type { ListingSummary } from "../types/catalogue-types.ts";

/**
 * ListingCard — the owner card in the console grid: the cover (or kind glyph) carrying the lifecycle
 * chip and the promoted disclosure, the title as a stretched link to the workspace, the price, and
 * one line of middot meta. A checkbox selects it for the batch bar — revealed on hover or focus, and
 * always while a selection exists; Shift extends from the last one toggled. The kebab opens the
 * lifecycle menu, adapted to the status. Dumb: selection and actions go to the island.
 */

export interface ListingCardProps {
	listing: ListingSummary;
	href: string;
	selected: boolean;
	/** A selection exists, so every card shows its checkbox. */
	selecting: boolean;
	onSelect: (listing: ListingSummary, range: boolean) => void;
	onAction: (action: ListingAction, listing: ListingSummary) => void;
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
	const menuOpen = useSignal(false);
	const meta = statusMeta(listing.status);

	function dispatch(action: ListingAction): void {
		menuOpen.value = false;
		onAction(action, listing);
	}

	return (
		<article
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

			<label class="cat-card__select">
				<input
					type="checkbox"
					class="cat-card__check"
					checked={selected}
					aria-label={`Select ${listing.title}`}
					onClick={(e) => onSelect(listing, e.shiftKey)}
				/>
			</label>

			<div class="cat-card__body">
				<h3 class="cat-card__title">
					<a class="cat-card__link" href={href}>{listing.title}</a>
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

			<Popover
				open={menuOpen}
				placement="bottom-end"
				class="cat-kebab-pop"
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
			>
				<div class="cat-menu" role="menu" aria-label={`Actions for ${listing.title}`}>
					<MenuItem icon="edit" label="Edit" onClick={() => dispatch("edit")} />
					<MenuItem icon="copy" label="Duplicate" onClick={() => dispatch("duplicate")} />
					{listing.status === "published" && (
						<MenuItem
							icon="eye"
							label="View public page"
							onClick={() => dispatch("preview")}
						/>
					)}
					<div class="cat-menu__sep" role="separator" />
					{listing.status === "published"
						? <MenuItem icon="pause" label="Pause" onClick={() => dispatch("pause")} />
						: listing.status !== "archived"
						? <MenuItem icon="upload" label="Publish" onClick={() => dispatch("publish")} />
						: (
							<MenuItem
								icon="history"
								label="Restore to draft"
								onClick={() => dispatch("restore")}
							/>
						)}
					{listing.status !== "archived" && (
						<MenuItem
							icon="archive-box"
							label="Archive"
							danger
							onClick={() => dispatch("archive")}
						/>
					)}
				</div>
			</Popover>
		</article>
	);
}

interface MenuItemProps {
	icon: IconName;
	label: string;
	danger?: boolean;
	onClick: () => void;
}

function MenuItem({ icon, label, danger, onClick }: MenuItemProps): JSX.Element {
	return (
		<button
			type="button"
			role="menuitem"
			class={danger ? "cat-menu__item cat-menu__item--danger" : "cat-menu__item"}
			onClick={onClick}
		>
			<span class="cat-menu__icon" aria-hidden="true">
				<Icon name={icon} />
			</span>
			{label}
		</button>
	);
}

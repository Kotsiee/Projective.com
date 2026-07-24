import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { statusMeta } from "../core/catalogue-model.ts";
import {
	AlertIcon,
	ArchiveIcon,
	BoxIcon,
	DuplicateIcon,
	EditIcon,
	EyeIcon,
	KebabIcon,
	KindIcon,
	PauseIcon,
	PublishIcon,
	StarGlyph,
} from "./catalogue-glyphs.tsx";
import type { ListingSummary } from "../types/catalogue-types.ts";

/**
 * ListingCard — the owner card in the console grid. A cover (or kind-glyph placeholder) carrying the
 * status chip + promoted/attention flags, the title (a stretched link to the manage page), the resolved
 * price, and inline metrics (views · orders · rating). The kebab opens the lifecycle menu (Edit ·
 * Duplicate · Preview public · Pause/Publish · Archive/Restore), adapting to the current status. Dumb —
 * every action is dispatched to the island via {@link onAction}. Reuses `@projective/ui` overlays.
 */

/** A lifecycle/navigation action dispatched from a card. */
export type ListingAction =
	| "edit"
	| "duplicate"
	| "preview"
	| "publish"
	| "pause"
	| "archive"
	| "restore";

export interface ListingCardProps {
	listing: ListingSummary;
	href: string;
	onAction: (action: ListingAction, listing: ListingSummary) => void;
}

export function ListingCard({ listing, href, onAction }: ListingCardProps): JSX.Element {
	const menuOpen = useSignal(false);
	const meta = statusMeta(listing.status);
	const rating = listing.metrics.avgRating;

	return (
		<article class="cat-card" data-status={listing.status} data-kind={listing.kind}>
			<div class="cat-card__media">
				{listing.cover
					? <img class="cat-card__img" src={listing.cover} alt="" loading="lazy" />
					: (
						<span class="cat-card__placeholder" aria-hidden="true">
							<KindIcon kind={listing.kind} size={30} />
						</span>
					)}
				<div class="cat-card__flags">
					<span class="cat-card__status" data-tone={meta.tone}>{meta.label}</span>
					{listing.promoted && (
						<span class="cat-card__flag cat-card__flag--promo">
							<StarGlyph size={12} filled /> Promoted
						</span>
					)}
					{listing.needsAttention && (
						<Tooltip content="Needs attention" placement="top">
							<span
								class="cat-card__flag cat-card__flag--alert"
								role="status"
								aria-label="Needs attention"
							>
								<AlertIcon size={13} />
							</span>
						</Tooltip>
					)}
				</div>
			</div>

			<div class="cat-card__body">
				<h3 class="cat-card__title">
					<a class="cat-card__link" href={href}>{listing.title}</a>
				</h3>
				<div class="cat-card__meta">
					<span class="cat-card__kind">
						<KindIcon kind={listing.kind} size={13} />
						{listing.kind === "service" ? listing.serviceType ?? "Service" : "Product"}
					</span>
					<span class="cat-card__price">{listing.price.display}</span>
				</div>

				<div class="cat-card__metrics" aria-label="Listing metrics">
					<span class="cat-card__stat">
						<EyeIcon size={14} />
						{listing.metrics.views30d}
					</span>
					<span class="cat-card__stat">
						<BoxIcon size={13} />
						{listing.metrics.orders}
					</span>
					{rating > 0 && (
						<span class="cat-card__stat">
							<StarGlyph size={13} filled />
							{rating.toFixed(1)}
						</span>
					)}
				</div>
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
						<KebabIcon size={18} />
					</button>
				)}
			>
				<div class="cat-menu" role="menu">
					<MenuItem icon={<EditIcon />} label="Edit" onClick={() => dispatch("edit")} />
					<MenuItem
						icon={<DuplicateIcon />}
						label="Duplicate"
						onClick={() => dispatch("duplicate")}
					/>
					{listing.status === "published" && (
						<MenuItem
							icon={<EyeIcon />}
							label="Preview public"
							onClick={() => dispatch("preview")}
						/>
					)}
					<div class="cat-menu__sep" role="separator" />
					{listing.status === "published"
						? <MenuItem icon={<PauseIcon />} label="Pause" onClick={() => dispatch("pause")} />
						: listing.status !== "archived"
						? (
							<MenuItem
								icon={<PublishIcon />}
								label="Publish"
								onClick={() => dispatch("publish")}
							/>
						)
						: (
							<MenuItem
								icon={<PublishIcon />}
								label="Restore to draft"
								onClick={() => dispatch("restore")}
							/>
						)}
					{listing.status !== "archived" && (
						<MenuItem
							icon={<ArchiveIcon />}
							label="Archive"
							danger
							onClick={() => dispatch("archive")}
						/>
					)}
				</div>
			</Popover>
		</article>
	);

	function dispatch(action: ListingAction): void {
		menuOpen.value = false;
		onAction(action, listing);
	}
}

function MenuItem(
	{ icon, label, danger, onClick }: {
		icon: JSX.Element;
		label: string;
		danger?: boolean;
		onClick: () => void;
	},
): JSX.Element {
	return (
		<button
			type="button"
			role="menuitem"
			class="cat-menu__item"
			data-danger={danger ? "true" : undefined}
			onClick={onClick}
		>
			<span class="cat-menu__icon" aria-hidden="true">{icon}</span>
			{label}
		</button>
	);
}

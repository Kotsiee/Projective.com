import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Checkbox } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import { ParkAction, RemoveAction } from "./LineAction.tsx";
import { groupIconName } from "./checkout-glyphs.tsx";
import { sellerHref } from "../core/basket-model.ts";
import { conferencingLabel, localSlotLabel } from "../core/lists-model.ts";
import type { LineSignals } from "../core/basket-lines.ts";
import type { RenderGroup } from "../core/basket-view.ts";
import type { BasketItem, PurchasableItemGroup } from "../types/checkout-types.ts";

/**
 * BasketEngagement — a project or a service as **one item** in the basket, with the tickets or
 * sessions bought against it nested inside it.
 *
 * ## The structural rule this component exists to enforce
 *
 * A buyer does not have "four things in their basket" when they buy four tickets against one project.
 * They have **one engagement**, priced four times. The previous layout split every project and service
 * into its own titled section, which read as four separate purchases and made the page's outline
 * describe the seller's data model rather than the buyer's order.
 *
 * So: one header naming the engagement, one flat run of ticket/session rows beneath it, one footer
 * carrying the engagement's own subtotal. The server already models it this way — a `BasketGroup` IS
 * the engagement, carrying its own `label`, `caption`, `href` and `subtotal` — so this is a
 * presentation of the projection rather than a re-grouping of it. Nothing here sums anything.
 *
 * ## No boxes, and no lines inside
 *
 * The engagement carries **no background and no border** (§B.4 and the surface's own rule against
 * card-in-card). It is set apart from its neighbours by the single divider the category draws between
 * items, and its INTERNAL hierarchy — header, rows, footer — is carried by whitespace alone. A rule
 * between a header and the rows it introduces would say those two things are separate, which is the
 * opposite of what this component is for.
 *
 * ## The thumbnail rule is a fact about what exists
 *
 * A **service** has a cover image; it is the thing being sold and it is what a buyer recognises it by.
 * A **project** does not — it is the buyer's own engagement, and the corpus carries no artwork for it —
 * so the header shows the owner's identity instead. That is why the branch is on the group's family
 * rather than on whether a thumbnail happens to be non-null: a project that accidentally carried a
 * child line's artwork would show the ticket's picture as if it were the project's.
 */

// #region Props
/** Props for {@link BasketEngagement}. */
export interface BasketEngagementProps {
	/** The server group — one project or service, and every ticket or session bought against it. */
	section: RenderGroup;
	/**
	 * Bound select-every-line-here state.
	 *
	 * A `Signal`, never a raw boolean: the field primitives seed their internal signal from a raw value
	 * exactly once, so a bulk checkbox bound to a plain boolean freezes at whatever it first painted
	 * while the rows beneath it move.
	 */
	selection: Signal<boolean>;
	indeterminate: boolean;
	disabled?: boolean;
	onToggleAll: (next: boolean) => void;
	/**
	 * A line's controlled bindings, from the body's line store.
	 *
	 * A `Signal`-backed binding rather than a raw boolean for the same reason the bulk checkbox above
	 * takes one: the field primitives seed their internal signal once and never read the prop again, so
	 * a row bound to a plain value freezes at the state it first painted.
	 */
	signalsOf: (item: BasketItem) => LineSignals;
	/** Whether a write is in flight for a given line. */
	isBusy: (item: BasketItem) => boolean;
	/** Whether ANY line in the group has a write in flight — gates the engagement-level actions. */
	busy: boolean;
	onToggle: (item: BasketItem, next: boolean) => void;
	onPark: (item: BasketItem, parked: boolean) => void;
	onRemove: (item: BasketItem) => void;
	/** Park every line in the engagement — the header's own Save for later. */
	onParkAll: () => void;
	/** Remove every line in the engagement — the header's own Remove. */
	onRemoveAll: () => void;
	/** Open a ticket in the board's own ticket surface. */
	onOpenTicket: (item: BasketItem) => void;
	/** Open a session. A placeholder trigger until the booking surface lands. */
	onOpenSession: (item: BasketItem) => void;
}
// #endregion

/** The categorical mark an engagement carries, from the SSOT family rather than a second table. */
function familyTag(group: PurchasableItemGroup): string {
	switch (group) {
		case "project":
			return "Project";
		case "session":
			return "Session";
		case "product":
			return "Product";
		case "service":
		default:
			return "Service";
	}
}

export function BasketEngagement(props: BasketEngagementProps): JSX.Element {
	const { section } = props;
	const headId = `bsk-eng-${section.key}-head`;
	const lead = section.items[0];
	const seller = lead?.sellerName ?? null;
	const sellerLink = lead ? sellerHref(lead) : null;
	// A project has no artwork of its own; a service is recognised by its cover. See the class doc.
	const showsCover = section.group !== "project";
	const cover = showsCover ? section.items.find((i) => i.thumbnail !== null)?.thumbnail ?? null : null;
	const unavailable = section.items.filter((item) => !item.available);
	const hidden = Math.max(0, section.itemCount - section.items.length);
	const sessions = section.group === "session";

	return (
		<li class="bsk-eng" aria-labelledby={headId} data-family={section.group}>
			<header class="bsk-eng__head">
				<div class="bsk-eng__select">
					<Checkbox
						value={props.selection}
						indeterminate={props.indeterminate}
						disabled={props.disabled}
						aria-label={`Select everything in ${section.label}`}
						onValueChange={props.onToggleAll}
					/>
				</div>

				{
					/*
					 * Out of the accessibility tree and out of the tab order: the heading below is this
					 * engagement's one link, and a second route to the same place would announce it twice.
					 */
				}
				{showsCover && (
					<span class="bsk-eng__media" aria-hidden="true">
						{cover
							? <img src={cover} alt="" loading="lazy" decoding="async" />
							: (
								<span class="bsk-eng__glyph">
									<Icon name={groupIconName(section.group)} size="md" />
								</span>
							)}
					</span>
				)}

				<div class="bsk-eng__ident">
					<h3 class="bsk-eng__title" id={headId}>
						{section.href
							? <a class="bsk-eng__link" href={section.href}>{section.label}</a>
							: section.label}
					</h3>

					<p class="bsk-eng__meta">
						{seller && (
							sellerLink
								? <a class="bsk-eng__seller" href={sellerLink}>{seller}</a>
								: <span class="bsk-eng__seller">{seller}</span>
						)}
						{section.caption && <span class="bsk-eng__caption">{section.caption}</span>}
					</p>

					{
						/*
						 * The engagement's alerts, stated once at the level the reader acts on. A line that
						 * cannot be bought still says so on its own row; this is the summary that makes the
						 * engagement worth opening.
						 */
					}
					{unavailable.length > 0 && (
						<p class="bsk-eng__alert" role="status">
							<Icon name="warning" size="xs" />
							<span>
								{unavailable.length === 1
									? "1 line here can no longer be bought."
									: `${unavailable.length} lines here can no longer be bought.`}
							</span>
						</p>
					)}
					{hidden > 0 && (
						<p class="bsk-eng__alert" data-tone="quiet">
							<span>The search is hiding {hidden} of {section.itemCount}.</span>
						</p>
					)}

					<div class="bsk-eng__actions">
						<RemoveAction
							subject={section.label}
							disabled={props.busy}
							onClick={props.onRemoveAll}
						/>
						<ParkAction
							subject={section.label}
							disabled={props.busy}
							onClick={props.onParkAll}
						/>
					</div>
				</div>

				<p class="bsk-eng__tags">
					<span class="bsk-row__tag">{familyTag(section.group)}</span>
				</p>
			</header>

			<ul class="bsk-eng__items">
				{section.items.map((item) => (
					<EngagementLine
						key={item.id}
						item={item}
						session={sessions}
						signals={props.signalsOf(item)}
						busy={props.isBusy(item)}
						onToggle={props.onToggle}
						onPark={props.onPark}
						onRemove={props.onRemove}
						onOpen={sessions ? props.onOpenSession : props.onOpenTicket}
					/>
				))}
			</ul>

			{
				/*
				 * The engagement's own footer figure.
				 *
				 * `stacked` puts the viewer's converted amount on the reading line with the price the seller
				 * actually set beneath it. Both figures are the server's; the component prints them and
				 * states no arithmetic between them — a rate, a multiplication or a "×0.872" would be this
				 * surface showing its working on a number the buyer cannot check.
				 */
			}
			{section.subtotal && (
				<p class="bsk-eng__foot">
					<span class="bsk-eng__foot-label">Subtotal</span>
					<Amount value={section.subtotal} size="lead" stacked />
				</p>
			)}
		</li>
	);
}

// #region Child row
/** Props for {@link EngagementLine}. */
interface EngagementLineProps {
	item: BasketItem;
	/** Whether the row reads as a booking (date, timezone, platform) or as a ticket (stages). */
	session: boolean;
	signals: LineSignals;
	busy: boolean;
	onToggle: (item: BasketItem, next: boolean) => void;
	onPark: (item: BasketItem, parked: boolean) => void;
	onRemove: (item: BasketItem) => void;
	onOpen: (item: BasketItem) => void;
}

/**
 * One ticket or one booked session inside an engagement.
 *
 * Deliberately NOT `BasketRow`: that row is a standalone purchase and carries the seller, the cover,
 * the kind chip and the whole price block, every one of which the engagement header above has already
 * said. Repeating them per row is what made four tickets read as four purchases.
 *
 * The title is a **button, not a link**. It opens the board's ticket surface in place, and a reader
 * who lands there from the basket must be able to come back to a basket that still holds their
 * selection and their scroll position — which a navigation would throw away.
 */
function EngagementLine(props: EngagementLineProps): JSX.Element {
	const { item, session, signals, busy } = props;
	const slot = session ? localSlotLabel(item) : null;
	const platform = session ? conferencingLabel(item) : null;
	const reasonId = `bsk-reason-${item.id}`;

	return (
		<li
			class="bsk-sub"
			id={`bsk-line-${item.id}`}
			data-busy={busy ? "true" : undefined}
			data-available={item.available ? undefined : "false"}
		>
			<div class="bsk-sub__select">
				<Checkbox
					value={signals.selected}
					disabled={!item.available || busy}
					aria-label={`Include ${item.title} in this checkout`}
					aria-describedby={item.available ? undefined : reasonId}
					onValueChange={(next) => props.onToggle(item, next)}
				/>
			</div>

			<div class="bsk-sub__body">
				<button
					type="button"
					class="bsk-sub__title"
					disabled={busy}
					onClick={() => props.onOpen(item)}
				>
					{session ? (slot ?? item.scheduledLabel ?? "No time chosen yet") : item.title}
				</button>

				{
					/*
					 * What the reader is actually buying, in the vocabulary of the thing bought: a ticket
					 * says which stages it routes through and whether it is a re-purchase of delivered work;
					 * a booking says when it is, in whose clock, and where it happens.
					 */
				}
				<p class="bsk-sub__facts">
					{session
						? (
							<>
								{item.timezone && <span class="bsk-sub__fact">{item.timezone}</span>}
								{platform
									? (
										<span class="bsk-sub__fact">
											<Icon name="video" size="2xs" />
											{platform}
										</span>
									)
									: <span class="bsk-sub__fact" data-pending="true">No meeting link yet</span>}
								{item.seats !== null && (
									<span class="bsk-sub__fact">
										{item.seats} {item.seats === 1 ? "seat" : "seats"}
									</span>
								)}
							</>
						)
						: (
							<>
								<span
									class="bsk-sub__fact"
									data-pending={item.stageLabel === null ? "true" : undefined}
								>
									{item.stageLabel ?? "No stage chosen yet"}
								</span>
								{item.revisionId && (
									<span class="bsk-sub__fact" data-tone="revision">Revision</span>
								)}
								{
									/*
									 * The subtitle only when it says something the stage label has not. A ticket
									 * line's `subtitle` is frequently the SAME resolved string as its `stageLabel`
									 * ("Stage 2 · Concept routes"), and printing both rendered the stage twice on
									 * every row — measured, not hypothetical.
									 */
								}
								{item.subtitle && item.subtitle !== item.stageLabel && (
									<span class="bsk-sub__fact">{item.subtitle}</span>
								)}
							</>
						)}
				</p>

				{!item.available && (
					<p class="bsk-sub__flag" id={reasonId}>
						<Icon name="warning" size="2xs" />
						<span>{item.unavailableReason ?? "This line can no longer be bought."}</span>
					</p>
				)}

				<div class="bsk-sub__actions">
					<RemoveAction
						compact
						subject={item.title}
						disabled={busy}
						onClick={() => props.onRemove(item)}
					/>
					<ParkAction
						compact
						subject={item.title}
						disabled={busy}
						onClick={() => props.onPark(item, true)}
					/>
				</div>
			</div>

			<p class="bsk-sub__price">
				<Amount value={item.lineTotal} size="body" hideOrigin />
			</p>
		</li>
	);
}
// #endregion

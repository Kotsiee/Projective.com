import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { itemKindMeta } from "@projective/types/finance";
import { Checkbox, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { itemHref, scheduleHref, sellerHref, stageHref } from "../core/basket-model.ts";
import {
	emailValid,
	localSlotLabel,
	needsSlotConfirmation,
	sameZone,
	zoneAbbr,
} from "../core/checkout-model.ts";
import { groupIconName } from "./checkout-glyphs.tsx";
import { Amount } from "./Amount.tsx";
import type { BasketItem } from "../types/checkout-types.ts";

/**
 * CheckoutLine — one purchasable, rendered as what it actually is.
 *
 * A checkout row is not one shape. A digital product has to know where to be sent; a pipeline ticket
 * has to know which stage it buys; a booking has to be agreed in a timezone the buyer may not live
 * in. The row therefore branches on the SSOT's {@link itemKindMeta} — the one place the platform says
 * what a kind needs — rather than on a local switch that a newly added kind would silently miss.
 *
 * **Selecting is the body's job; acting is not.** Every control here either includes a line in this
 * payment or supplies a fact the line needs to be paid for. There is no Pay button, no remove, no
 * bulk action: those are the footer band's, and duplicating one here would give the surface two
 * answers to what is being bought.
 *
 * **The deep link opens in a new tab, deliberately.** Leaving a half-composed payment to look at what
 * you are buying — and losing the selection, the confirmed slot and the typed address on the way — is
 * a worse outcome than a second tab.
 */

// #region Props
/** Props for {@link CheckoutLine}. */
export interface CheckoutLineProps {
	item: BasketItem;
	/** Inclusion in THIS payment. Controlled, so a server refetch can correct it. */
	selected: Signal<boolean>;
	/** Whether a write for this line is in flight. */
	busy: boolean;
	/** 1-based position within a stage ladder; `null` when the line is not stage-routed. */
	step: number | null;
	/** The viewer's IANA zone, resolved after hydration. `null` during SSR — never guessed. */
	zone: string | null;
	/** The booking acknowledgement. `null` when the kind needs no slot. */
	slotConfirmed: Signal<boolean> | null;
	/** The delivery-address draft. `null` when the kind needs no address. */
	emailDraft: Signal<string> | null;
	/** Addresses already given on other lines of this checkout. */
	emailSuggestions: readonly string[];
	/** Notified with the next inclusion state. */
	onToggle: (next: boolean) => void;
	/** Notified when an address should be persisted (blur or Enter), with the value to save. */
	onEmailCommit: (value: string) => void;
}
// #endregion

/** The DOM id a line-scoped blocker links to. */
export const LINE_ID_PREFIX = "cko-line-";

// #region Sub-blocks
/** Where a digital deliverable is sent. Required before the line can be paid for. */
function Delivery(props: {
	item: BasketItem;
	draft: Signal<string>;
	suggestions: readonly string[];
	onCommit: (value: string) => void;
}): JSX.Element {
	const { item, draft, suggestions, onCommit } = props;
	const value = draft.value;
	const invalid = value.length > 0 && !emailValid(value);
	const fieldId = `cko-email-${item.id}`;
	const noteId = `${fieldId}-note`;

	return (
		<div class="cko-deliver">
			<label class="cko-deliver__label" for={fieldId}>Send the download to</label>

			{
				/*
				 * A real `<form>` so Enter commits natively, which is what a single text field in a row
				 * is expected to do. Blur commits too — an address typed and then abandoned is the one
				 * way a paid-for download silently goes nowhere.
				 */
			}
			<form
				class="cko-deliver__form"
				onSubmit={(event) => {
					event.preventDefault();
					onCommit(draft.peek());
				}}
			>
				<InputText
					id={fieldId}
					type="email"
					size="sm"
					block
					value={draft}
					autoComplete="email"
					placeholder="name@example.com"
					// `gate` (amber, not `aria-invalid`) while merely absent; `invalid` only once the buyer
					// has typed something that cannot work. A field announcing itself invalid before its
					// owner has had a turn is noise, not validation.
					status={invalid ? "invalid" : value.length === 0 ? "gate" : "default"}
					required
					aria-describedby={noteId}
					onBlur={() => onCommit(draft.peek())}
				/>
			</form>

			<p class="cko-deliver__note" id={noteId} data-invalid={invalid ? "true" : undefined}>
				{invalid
					? "That doesn't look like an email address."
					: value.length === 0
					? "This purchase is delivered by email, so it needs an address before you can pay."
					: "Saved when you leave the field."}
			</p>

			{
				/*
				 * Reuse, not an address book. Every address offered here is already visible on another
				 * line of this same checkout — the projection carries no stored list, and inventing one
				 * would put addresses on screen the buyer never gave this surface.
				 */
			}
			{suggestions.length > 0 && (
				<div class="cko-deliver__suggest">
					<span class="cko-deliver__suggest-label">Also used here:</span>
					{suggestions.map((address) => (
						<button
							key={address}
							type="button"
							class="cko-deliver__chip"
							onClick={() => {
								draft.value = address;
								onCommit(address);
							}}
						>
							{address}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** Which stage of a pipeline this line buys, and what happens to it if it is left out. */
function StageRouting(props: { item: BasketItem; included: boolean }): JSX.Element {
	const { item, included } = props;
	const href = stageHref(item);

	return (
		<div class="cko-stage" data-included={included ? "true" : "false"}>
			<span class="cko-stage__mark">
				<Icon name="stages" />
			</span>
			<div class="cko-stage__body">
				<p class="cko-stage__label">
					{item.stageLabel ?? "Stage not chosen yet"}
					{href && (
						<a
							class="cko-stage__link"
							href={href}
							target="_blank"
							rel="noopener noreferrer"
						>
							Review the stage
							<Icon name="external-link" />
							<span class="ui-visually-hidden">(opens in a new tab)</span>
						</a>
					)}
				</p>
				<p class="cko-stage__note">
					{!item.stageId
						? "This ticket has to be routed to a stage before it can be paid for."
						: included
						? "Paid now. Work on this stage can start as soon as the payment clears."
						: "Left out of this payment. It stays in your basket, so you can pay for it in a later checkout."}
				</p>
			</div>
		</div>
	);
}

/**
 * The booked slot, and the acknowledgement of the zone it is expressed in.
 *
 * A booking is agreed in the SELLER's timezone. "Tue 12 Aug · 14:00" is unambiguous only to someone
 * already in that zone, so the row prints the same instant in the viewer's own zone and asks them to
 * agree to it explicitly. The local rendering appears only after hydration: a server render would
 * resolve the SERVER's zone and state a time nobody is in, which is worse than showing nothing.
 */
function Booking(props: {
	item: BasketItem;
	confirmed: Signal<boolean>;
	zone: string | null;
	included: boolean;
}): JSX.Element {
	const { item, confirmed, zone, included } = props;
	const sellerZone = item.timezone;
	const local = zone && item.scheduledAt ? localSlotLabel(item.scheduledAt, zone) : null;
	const localAbbr = zone && item.scheduledAt ? zoneAbbr(item.scheduledAt, zone) : null;
	const differs = !sameZone(zone, sellerZone);
	const href = scheduleHref(item);

	return (
		<div class="cko-when" data-confirmed={confirmed.value ? "true" : "false"}>
			<span class="cko-when__mark">
				<Icon name="calendar" />
			</span>
			<div class="cko-when__body">
				<p class="cko-when__slot">
					{item.scheduledLabel ?? "No time booked yet"}
					{sellerZone && <span class="cko-when__zone">{sellerZone}</span>}
				</p>

				{local && differs && (
					<p class="cko-when__local">
						<Icon name="globe" />
						<span>
							That is <strong>{local}</strong>
							{localAbbr ? ` (${localAbbr})` : ""} where you are.
						</span>
					</p>
				)}

				{item.seats !== null && (
					<p class="cko-when__seats">
						{item.seats} {item.seats === 1 ? "seat" : "seats"} held
					</p>
				)}

				<Checkbox
					value={confirmed}
					size="sm"
					label={differs && local
						? `I've checked the time — ${local} my time`
						: "I've checked the time and timezone"}
					class="cko-when__confirm"
				/>

				{!confirmed.value && included && (
					<p class="cko-when__warn" role="status">
						Confirm the time before paying. Sessions are booked against the seller's calendar.
					</p>
				)}

				{href && (
					<a class="cko-when__link" href={href} target="_blank" rel="noopener noreferrer">
						Change the time
						<Icon name="external-link" />
						<span class="ui-visually-hidden">(opens in a new tab)</span>
					</a>
				)}
			</div>
		</div>
	);
}
// #endregion

// #region Line
/** Render one checkout line in the shape its kind demands. */
export function CheckoutLine(props: CheckoutLineProps): JSX.Element {
	const { item, selected, busy, step, zone, slotConfirmed, emailDraft, emailSuggestions } = props;
	const meta = itemKindMeta(item.itemType);
	const included = selected.value && item.available;
	const seller = sellerHref(item);
	const titleId = `cko-line-title-${item.id}`;

	return (
		<li
			class="cko-line"
			id={`${LINE_ID_PREFIX}${item.id}`}
			data-included={included ? "true" : "false"}
			data-available={item.available ? "true" : "false"}
			data-busy={busy ? "true" : undefined}
			data-group={meta.group}
		>
			<div class="cko-line__lead">
				<Checkbox
					value={selected}
					disabled={!item.available || busy}
					onValueChange={props.onToggle}
					aria-label={`Include ${item.title} in this payment`}
				/>
				{step !== null && <span class="cko-line__step" aria-hidden="true">{step}</span>}
			</div>

			<div class="cko-line__figure" aria-hidden="true">
				{item.thumbnail
					? <img class="cko-line__thumb" src={item.thumbnail} alt="" loading="lazy" />
					: (
						<span class="cko-line__glyph">
							<Icon name={groupIconName(meta.group)} />
						</span>
					)}
			</div>

			<div class="cko-line__body">
				<div class="cko-line__headrow">
					<a
						class="cko-line__title"
						id={titleId}
						href={itemHref(item)}
						target="_blank"
						rel="noopener noreferrer"
					>
						{item.title}
						<Icon name="external-link" class="cko-line__out" />
						<span class="ui-visually-hidden">(opens in a new tab)</span>
					</a>

					<span class="cko-line__price">
						<Amount value={item.lineTotal} />
						{item.originalPrice && (
							<span class="cko-line__was">
								<span class="ui-visually-hidden">Was</span>
								<Amount value={item.originalPrice} size="micro" tone="struck" />
							</span>
						)}
					</span>
				</div>

				<p class="cko-line__meta">
					<span class="cko-line__kind">{item.subtitle ?? meta.label}</span>
					{item.sellerName && seller && (
						<>
							<span class="cko-line__dot" aria-hidden="true">·</span>
							<a
								class="cko-line__seller"
								href={seller}
								target="_blank"
								rel="noopener noreferrer"
							>
								{item.sellerName}
							</a>
						</>
					)}
					{item.quantity > 1 && (
						<>
							<span class="cko-line__dot" aria-hidden="true">·</span>
							<span class="cko-line__qty">
								{item.quantity} × <Amount value={item.unitPrice} size="micro" tone="muted" /> each
							</span>
						</>
					)}
				</p>

				{
					/*
					 * Facts the row carries about WHAT is being bought, as tags rather than sentences: a
					 * licence, a delivery format, a discount already applied, and a paid revision — which
					 * is a re-purchase of work already delivered once and must never be mistaken for the
					 * original.
					 */
				}
				{(item.licence || item.format || item.revisionId || item.discountCode ||
					item.discountAmount.minor > 0) && (
					<p class="cko-tagrow">
						{item.revisionId && (
							<span class="cko-tag" data-tone="warning">
								<Icon name="refresh" />
								Revision fee
							</span>
						)}
						{item.licence && <span class="cko-tag">{item.licence}</span>}
						{item.format && <span class="cko-tag">{item.format}</span>}
						{item.discountAmount.minor > 0 && (
							<span class="cko-tag" data-tone="credit">
								<Icon name="tag" />
								Saving <Amount value={item.discountAmount} size="micro" tone="credit" />
							</span>
						)}
						{item.discountCode && <span class="cko-tag">{item.discountCode}</span>}
					</p>
				)}

				{!item.available && (
					<p class="cko-line__flag" role="status">
						<Icon name="warning" />
						{item.unavailableReason ??
							"This is no longer available and can't be paid for right now."}
					</p>
				)}

				{meta.needsEmail && emailDraft && (
					<Delivery
						item={item}
						draft={emailDraft}
						suggestions={emailSuggestions}
						onCommit={props.onEmailCommit}
					/>
				)}

				{meta.needsStage && <StageRouting item={item} included={included} />}

				{needsSlotConfirmation(item) && slotConfirmed && (
					<Booking
						item={item}
						confirmed={slotConfirmed}
						zone={zone}
						included={included}
					/>
				)}

				{!included && item.available && (
					<p class="cko-line__state">Not in this payment — it stays in your basket.</p>
				)}
			</div>
		</li>
	);
}
// #endregion

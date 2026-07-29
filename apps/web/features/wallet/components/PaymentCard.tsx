import type { JSX } from "preact";
import "../styles/wallet-card.css";
import { cx } from "@ui/core/cx.ts";
import { styleVars } from "@ui/core/style.ts";
import type { PaymentMethodView } from "../types/wallet-types.ts";

/**
 * PaymentCard — the physical-wallet motif (`wlt-card`), and the one object on this surface allowed to
 * look like an instrument rather than a band.
 *
 * **The honesty constraint is the card's thesis, not a gap to fill.** Projective stores a provider
 * token plus four display fragments — brand, last four, a user label, a status. Card numbers, expiry
 * dates, cardholder names and CVVs are collected by Stripe-hosted fields and never touch our
 * servers. So the classic card zones are re-purposed rather than faked: the PAN zone is
 * `•••• •••• •••• 4455` with the masked groups as `aria-hidden` ornament and the real `last4` in the
 * accessible name; the cardholder-name zone carries the user's OWN `label`; and the expiry zone
 * carries a custody seal reading `TOKENIZED · HELD BY STRIPE`.
 *
 * There is deliberately **no expiry element, no cardholder-name element, no CVV affordance and no
 * flip-to-reveal-back** in this markup or in the BEM inventory — an affordance implying we hold data
 * we do not is worse than an empty space (BUILD CONTRACT §12.6). A method with no `last4` degrades
 * to a bank-account face rather than inventing digits.
 *
 * Brand tint is **derived, never looked up** (§1.4): a graphite floor (`--wlt-base`) keeps every
 * anchor reading as one family, and the key hue comes from `--primary`/`--secondary`/`--tertiary`/
 * `--outline`. No money-semantic token may be a brand anchor — a Mastercard tinted `--warning` would
 * put an alarm colour on a payment instrument.
 */

// #region Props
/** Props for {@link PaymentCard}. */
export interface PaymentCardProps {
	/** The method projection. Every visible fragment on the face comes from exactly one of its fields. */
	method: PaymentMethodView;
	/** Face geometry: fanned in the hero deck, tiled on `/wallet/methods`, or hero'd in a drawer. */
	size?: "deck" | "grid" | "detail";
	/** Fan position, written to `--wlt-i` for the deck's transform ladder and stacking order. */
	index?: number;
	/** Render as a `<button>` (a manageable instrument) rather than a static `role="img"` face. */
	interactive?: boolean;
	/** Invoked with `method.id` when an interactive card is activated. */
	onOpen?: (id: string) => void;
	/**
	 * Roving-tabindex slot for a card list (the deck). Only the roving card is `0`; the rest are `-1`
	 * so a fanned stack costs one Tab stop, not one per instrument.
	 */
	tabIndex?: number;
	class?: string;
}
// #endregion

// #region Derivation
/**
 * Map a stored brand string onto a face modifier. The lookup recognises the three card networks that
 * have a distinct visual identity and folds everything else onto a bank face — a Monzo or Barclays
 * "brand" is an institution, not a network, and painting it in network livery would be a fiction.
 */
export function brandModifier(brand: string | null): string {
	const key = (brand ?? "").trim().toLowerCase();
	if (key === "") return "generic";
	if (key.includes("visa")) return "visa";
	if (key.includes("mastercard") || key.includes("master card")) return "mastercard";
	if (key.includes("amex") || key.includes("american express")) return "amex";
	return "bank";
}

/**
 * The card's single accessible name. It carries only facts we hold — network or institution, the
 * real last four, the user's label, which defaults it serves, its status — and closes on the custody
 * statement, so a screen-reader user learns the same thing a sighted user learns from the seal.
 */
function accessibleName(method: PaymentMethodView): string {
	const isBank = method.last4 === null;
	const parts: string[] = [
		isBank ? "Bank account" : `${method.brand ?? method.provider} ending ${method.last4}`,
	];
	if (method.label) parts.push(method.label);
	if (method.isDefaultFunding && method.isDefaultPayout) parts.push("default funding and payout");
	else if (method.isDefaultFunding) parts.push("default funding");
	else if (method.isDefaultPayout) parts.push("default payout");
	parts.push(method.status);
	parts.push(isBank ? "account details held by Stripe" : "card details held by Stripe");
	return parts.join(", ");
}

/**
 * The custody seal mark: a shield with a check — stewardship, not confinement. Deliberately **not** a
 * padlock: a padlock on a payment instrument says the holder is locked out of their own money, and
 * the only permitted lock on this surface marks a verification process step (§I.3 G1 / RULE C-1).
 *
 * Returned from a function rather than held as a module VNode constant so every card mounts its own
 * instance — a shared VNode cannot appear twice in one tree, and a deck renders several at once.
 */
function sealMark(): JSX.Element {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 14 14"
			fill="none"
			stroke="currentColor"
			stroke-width="1.3"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M7 1.2 2.4 3v3.6c0 2.7 1.9 5.1 4.6 5.9 2.7-.8 4.6-3.2 4.6-5.9V3z" />
			<path d="m5.2 6.9 1.3 1.3 2.4-2.5" stroke-linecap="round" />
		</svg>
	);
}
// #endregion

/** The face's interior — shared verbatim by the interactive and static shells. */
function CardFace(props: { method: PaymentMethodView; isBank: boolean }): JSX.Element {
	const { method, isBank } = props;
	const showFunding = method.methodRole === "funding" || method.methodRole === "both";
	const showPayout = method.methodRole === "payout" || method.methodRole === "both";

	return (
		<>
			{/* Sweeps once on entering `--size-detail`; inert (and `display: none`) everywhere else. */}
			<span class="wlt-card__gloss" aria-hidden="true" />

			<span class="wlt-card__chip" aria-hidden="true">
				<span class="wlt-card__chip-trace" />
			</span>

			{
				/*
				 * Exceptional status only. The card's own accessible name already carries every one of
				 * these facts, so the chips are `aria-hidden` ornament rather than a second announcement.
				 */
			}
			<span class="wlt-card__badges" aria-hidden="true">
				{method.isDefaultFunding && (
					<span class="wlt-card__badge wlt-card__badge--funding">Default funding</span>
				)}
				{method.isDefaultPayout && (
					<span class="wlt-card__badge wlt-card__badge--payout">Default payout</span>
				)}
				{method.status === "expired" && (
					<span class="wlt-card__badge wlt-card__badge--expired">Expired</span>
				)}
				{method.status === "inactive" && <span class="wlt-card__badge">Inactive</span>}
			</span>

			{
				/*
				 * The PAN zone. Only the live group is real; the three masked groups exist so the face
				 * reads as a card and are hidden from assistive tech so they can never be mistaken for
				 * digits we hold. A method with no `last4` renders no PAN at all rather than a mask of
				 * nothing.
				 */
			}
			{!isBank && (
				<p class="wlt-card__pan wlt-num">
					<span class="wlt-card__pan-group wlt-card__pan-group--masked" aria-hidden="true">
						••••
					</span>
					<span class="wlt-card__pan-group wlt-card__pan-group--masked" aria-hidden="true">
						••••
					</span>
					<span class="wlt-card__pan-group wlt-card__pan-group--masked" aria-hidden="true">
						••••
					</span>
					<span class="wlt-card__pan-group wlt-card__pan-group--live">{method.last4}</span>
				</p>
			)}

			<span class="wlt-card__custody">
				{/* The cardholder-name zone, carrying the only name we own: the user's own label. */}
				<span class="wlt-card__label">{method.label ?? method.provider}</span>

				<span class="wlt-card__roles">
					{showFunding && <span class="wlt-card__role wlt-card__role--funding">Funding</span>}
					{showPayout && <span class="wlt-card__role wlt-card__role--payout">Payout</span>}
				</span>

				{/* The expiry zone, carrying a custody statement instead of a date we never receive. */}
				<span class="wlt-card__seal">
					<span class="wlt-card__seal-glyph">{sealMark()}</span>
					<span class="wlt-card__seal-text">Tokenized · Held by Stripe</span>
				</span>

				{/* A wordmark is a logo, not text — it stays LTR in every locale (§11 RtL). */}
				<span class="wlt-card__brand">{method.brand ?? method.provider}</span>
			</span>
		</>
	);
}

/**
 * Render one payment method as a card face. See the module doc for the custody contract that governs
 * what may and may not appear on it.
 */
export function PaymentCard(props: PaymentCardProps): JSX.Element {
	const { method, size = "deck", index = 0, interactive = false, onOpen, tabIndex } = props;

	// A method with no last four is a bank instrument regardless of the stored brand string, so the
	// face degrades rather than wearing network livery it cannot justify (§12.6).
	const isBank = method.last4 === null;
	const face = isBank ? "bank" : brandModifier(method.brand);
	const name = accessibleName(method);

	const className = cx(
		"wlt-card",
		`wlt-card--brand-${face}`,
		`wlt-card--size-${size}`,
		`wlt-card--role-${method.methodRole}`,
		method.status === "expired" && "wlt-card--expired",
		method.status === "inactive" && "wlt-card--inactive",
		props.class,
	);
	const vars = styleVars({ "--wlt-i": index });

	if (interactive) {
		return (
			<button
				type="button"
				class={className}
				style={vars}
				aria-label={name}
				tabIndex={tabIndex}
				onClick={() => onOpen?.(method.id)}
			>
				<CardFace method={method} isBank={isBank} />
			</button>
		);
	}

	// A static face is one composite graphic: the truthful name is the whole of its accessible
	// content, so the decorative interior is not announced fragment by fragment.
	return (
		<div class={className} style={vars} role="img" aria-label={name}>
			<CardFace method={method} isBank={isBank} />
		</div>
	);
}

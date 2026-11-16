import type { JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/payment-card.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Icon } from "../../icons/mod.ts";
import {
	cardExpiryOf,
	cardMaskGroupsFor,
	cardProgrammeOf,
	cardWordmarkOf,
	describeCardBack,
	describeCardFront,
	type PaymentCardArt,
	paymentCardArt,
	type PaymentCardData,
	type PaymentCardSize,
	type PaymentCardVariant,
	type PaymentCardWalletFace,
} from "../core/payment-card.ts";

export {
	type PaymentCardArt,
	paymentCardArt,
	type PaymentCardData,
	type PaymentCardSize,
	type PaymentCardVariant,
	type PaymentCardWalletFace,
};

// #region Props
/** Props for {@link PaymentCard}. */
export interface PaymentCardProps {
	/** The stored fragments to print. */
	card: PaymentCardData;
	/** Pre-resolved art (`resolveCardArt(...)`); omitted, {@link paymentCardArt} derives it locally. */
	art?: PaymentCardArt;
	/** `card` (default) prints a saved card; `wallet` prints the platform's balance plate. */
	variant?: PaymentCardVariant;
	/** Wallet only: the account scope printed at the top inline-end ("Team vault"). */
	scopeLabel?: string | null;
	/** Wallet only: the ISO 4217 code printed at the bottom inline-end. */
	currency?: string | null;
	/** Width ceiling (default `md`). */
	size?: PaymentCardSize;
	/** Controlled flip state, paired with `onFlipChange`. */
	flipped?: boolean;
	/** Render the flip control. Ignored on a `wallet` face, which has no reverse. */
	flippable?: boolean;
	/** Notified with the next flip state whenever the control is activated. */
	onFlipChange?: (flipped: boolean) => void;
	/** Accessible label for the flip control (default "Show card back"/"Show card front"). */
	flipLabel?: string;
	/** Label above the expiry date (default "Valid thru"). */
	expiryLabel?: string;
	/** One short line on the back face — a custody statement, an issuer note. */
	backNote?: string;
	/** Track the pointer into `--pc-px`/`--pc-py` for a cursor-following glare. Off by default. */
	parallax?: boolean;
	/**
	 * Render both faces as pure ornament (`aria-hidden`) when an ancestor carries the accessible name,
	 * as {@link PaymentCardOption} does. Forces `flippable` off.
	 */
	decorative?: boolean;
	/** Overrides the composed accessible name of the front face. */
	label?: string;
	class?: string;
	id?: string;
}

/** Props for {@link PaymentCardOption}. */
export interface PaymentCardOptionProps {
	/** The stored fragments to print. */
	card: PaymentCardData;
	/** Pre-resolved art, as {@link PaymentCardProps.art}. */
	art?: PaymentCardArt;
	/** As {@link PaymentCardProps.variant}. */
	variant?: PaymentCardVariant;
	/** As {@link PaymentCardProps.scopeLabel}. */
	scopeLabel?: string | null;
	/** As {@link PaymentCardProps.currency}. */
	currency?: string | null;
	/** Width ceiling (default `sm`). */
	size?: PaymentCardSize;
	/** Whether this option is the selected one — rendered as `aria-checked`. */
	checked: boolean;
	/** Activated by click, Space or Enter. */
	onSelect?: () => void;
	/** Greys the option out and removes it from the tab order. */
	disabled?: boolean;
	/** Roving-tabindex slot, owned by the consumer's `role="radiogroup"`. */
	tabIndex?: number;
	/** Id of the element that explains the option — a refusal reason, bound as `aria-describedby`. */
	describedBy?: string;
	/** Overrides the composed accessible name. */
	label?: string;
	class?: string;
	id?: string;
}
// #endregion

// #region Artwork
function chipPlate(): VNode {
	return (
		<span class="ui-paycard__chip" aria-hidden="true">
			<svg
				class="ui-paycard__chip-art"
				viewBox="0 0 33 25"
				fill="none"
				stroke="currentColor"
				stroke-linecap="round"
				stroke-linejoin="round"
				preserveAspectRatio="none"
				focusable="false"
			>
				<rect x="11.5" y="6" width="10" height="13" rx="2.5" />
				<path d="M0 8.5h11.5M0 16.5h11.5M21.5 8.5H33M21.5 16.5H33M16.5 0v6M16.5 19v6M11.5 0v6M21.5 0v6M11.5 19v6M21.5 19v6" />
			</svg>
		</span>
	);
}

function contactlessMark(): VNode {
	return (
		<svg
			class="ui-paycard__wave"
			viewBox="0 0 16 20"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M3 6.5a7 7 0 0 1 0 7" />
			<path d="M7 4a11 11 0 0 1 0 12" />
			<path d="M11 1.5a15 15 0 0 1 0 17" />
		</svg>
	);
}
// #endregion

// #region Faces
interface FrontFaceProps {
	card: PaymentCardData;
	art: PaymentCardArt;
	variant: PaymentCardVariant;
	wallet: PaymentCardWalletFace;
	expiryLabel: string;
	parallax: boolean;
	holographic: boolean;
	hidden: boolean;
	name: string;
}

function CardMarks(props: { card: PaymentCardData }): VNode {
	const { card } = props;
	return (
		<span class="ui-paycard__marks" aria-hidden="true">
			{card.isDefault && (
				<span class="ui-paycard__mark ui-paycard__mark--default">
					<Icon name="check" />
					<span class="ui-paycard__mark-text">Default</span>
				</span>
			)}
			{card.isExpired && (
				<span class="ui-paycard__mark ui-paycard__mark--expired">
					<Icon name="warning" />
					<span class="ui-paycard__mark-text">Expired</span>
				</span>
			)}
		</span>
	);
}

function CardNetwork(props: { art: PaymentCardArt }): VNode | null {
	const wordmark = cardWordmarkOf(props.art);
	if (!wordmark) return null;
	const programme = cardProgrammeOf(props.art);
	return (
		<span class="ui-paycard__network" aria-hidden="true">
			<span class="ui-paycard__network-name">{wordmark}</span>
			{programme && <span class="ui-paycard__network-hint">{programme}</span>}
		</span>
	);
}

function CardPan(props: { card: PaymentCardData; art: PaymentCardArt }): VNode | null {
	const { card, art } = props;
	if (!card.last4) return null;
	return (
		<p class="ui-paycard__pan">
			{cardMaskGroupsFor(art.network).map((group, i) => (
				<span
					key={`mask-${i}`}
					class="ui-paycard__pan-group ui-paycard__pan-group--masked"
					aria-hidden="true"
				>
					{group}
				</span>
			))}
			<span class="ui-paycard__pan-group ui-paycard__pan-group--live">{card.last4}</span>
		</p>
	);
}

function FrontFace(props: FrontFaceProps): VNode {
	const { card, art, variant, wallet, parallax, holographic, hidden, name } = props;
	const expiry = variant === "card" ? cardExpiryOf(card) : null;
	const isWallet = variant === "wallet";

	return (
		<div
			class="ui-paycard__face ui-paycard__face--front"
			role={hidden ? undefined : "img"}
			aria-label={hidden ? undefined : name}
			aria-hidden={hidden ? "true" : undefined}
			inert={hidden || undefined}
		>
			<span class="ui-paycard__sheen" aria-hidden="true" />
			{holographic && <span class="ui-paycard__foil" aria-hidden="true" />}
			{parallax && <span class="ui-paycard__glare" aria-hidden="true" />}
			{card.isExpired && <span class="ui-paycard__veil" aria-hidden="true" />}

			<div class="ui-paycard__row ui-paycard__row--top" aria-hidden="true">
				{isWallet
					? <span class="ui-paycard__wordmark">{art.networkLabel}</span>
					: <CardMarks card={card} />}
				{isWallet
					? wallet.scopeLabel && <span class="ui-paycard__scope">{wallet.scopeLabel}</span>
					: <CardNetwork art={art} />}
			</div>

			<span class="ui-paycard__emv" aria-hidden="true">
				{chipPlate()}
				{contactlessMark()}
			</span>

			<div class="ui-paycard__lower" aria-hidden="true">
				{!isWallet && <CardPan card={card} art={art} />}
				{expiry && (
					<p class="ui-paycard__expiry">
						<span class="ui-paycard__expiry-label">{props.expiryLabel}</span>
						<span class="ui-paycard__expiry-value">{expiry}</span>
					</p>
				)}
				<div class="ui-paycard__row ui-paycard__row--bottom">
					{card.cardholderName && <span class="ui-paycard__holder">{card.cardholderName}</span>}
					{isWallet && wallet.currency && (
						<span class="ui-paycard__currency">{wallet.currency}</span>
					)}
				</div>
			</div>
		</div>
	);
}

function BackFace(props: { art: PaymentCardArt; note?: string; hidden: boolean }): VNode {
	const { art, note, hidden } = props;
	const wordmark = cardWordmarkOf(art);

	return (
		<div
			class="ui-paycard__face ui-paycard__face--back"
			role={hidden ? undefined : "img"}
			aria-label={hidden ? undefined : describeCardBack(art)}
			aria-hidden={hidden ? "true" : undefined}
			inert={hidden || undefined}
		>
			<span class="ui-paycard__sheen" aria-hidden="true" />
			<span class="ui-paycard__stripe" aria-hidden="true" />

			<div class="ui-paycard__sigrow" aria-hidden="true">
				<span class="ui-paycard__signature" />
				<span class="ui-paycard__cvv">
					<span class="ui-paycard__cvv-dots">•••</span>
				</span>
			</div>

			<div class="ui-paycard__backfoot" aria-hidden="true">
				{note && <span class="ui-paycard__note">{note}</span>}
				{wordmark && <span class="ui-paycard__network-name">{wordmark}</span>}
			</div>
		</div>
	);
}
// #endregion

// #region PaymentCard
/**
 * One payment instrument as an ISO-7810 ID-1 (CR80, 1.586:1) face with a real 3D flip.
 *
 * **Honesty line.** A `card` face prints only what Stripe returns and we store: three (two on Amex)
 * `aria-hidden` mask groups plus the real `last4`, the real expiry, the billing name. The back's
 * security-code box is a `•••` ornament — never an input, never a value, never revealable — and its
 * accessible name says no code is held. Every field degrades to absence (no `--/--`). A `wallet` face
 * prints no number at all: the platform wordmark, the account scope, the currency and the holder.
 *
 * **Token-only art.** Colours arrive as token expressions through `--pc-gradient`/`--pc-chip`/
 * `--pc-sheen`/`--pc-fg`; there is no hex, no remote asset and no network logo artwork.
 *
 * @example
 * ```tsx
 * <PaymentCard card={saved} art={resolveCardArt(saved)} size="lg" flippable />
 * <PaymentCard variant="wallet" card={{ cardholderName: "Ines Duarte" }} art={art}
 *   scopeLabel="Personal wallet" currency="GBP" />
 * ```
 */
export function PaymentCard(props: PaymentCardProps): JSX.Element {
	const {
		card,
		variant = "card",
		size = "md",
		flipped,
		flippable = false,
		onFlipChange,
		flipLabel,
		expiryLabel = "Valid thru",
		backNote,
		parallax = false,
		decorative = false,
		label,
		class: className,
		id,
	} = props;

	const internal = useSignal(false);
	const root = useRef<HTMLDivElement | null>(null);

	const art = props.art ?? paymentCardArt(card);
	const wallet: PaymentCardWalletFace = {
		scopeLabel: variant === "wallet" ? props.scopeLabel ?? null : null,
		currency: variant === "wallet" ? props.currency ?? null : null,
	};
	const canFlip = flippable && !decorative && variant === "card";
	const isFlipped = canFlip && (flipped ?? internal.value);
	const holographic = art.holographic ?? (card.isBusinessCard === true);
	const name = label ?? describeCardFront(card, art, variant, wallet);

	function toggle() {
		const next = !isFlipped;
		if (flipped === undefined) internal.value = next;
		onFlipChange?.(next);
	}

	function track(ev: JSX.TargetedPointerEvent<HTMLDivElement>) {
		const el = root.current;
		if (!el) return;
		const box = el.getBoundingClientRect();
		if (box.width === 0 || box.height === 0) return;
		el.style.setProperty("--pc-px", `${((ev.clientX - box.left) / box.width) * 100}%`);
		el.style.setProperty("--pc-py", `${((ev.clientY - box.top) / box.height) * 100}%`);
	}

	function untrack() {
		const el = root.current;
		if (!el) return;
		el.style.removeProperty("--pc-px");
		el.style.removeProperty("--pc-py");
	}

	return (
		<div
			ref={root}
			id={id}
			class={cx(
				"ui-paycard",
				`ui-paycard--${size}`,
				`ui-paycard--${variant}`,
				`ui-paycard--net-${art.network}`,
				holographic && "ui-paycard--holo",
				card.isExpired === true && "ui-paycard--expired",
				canFlip && "ui-paycard--flippable",
				isFlipped && "ui-paycard--flipped",
				className,
			)}
			style={styleVars({
				"--pc-gradient": art.gradient,
				"--pc-chip": art.chipTone,
				"--pc-sheen": art.sheenTone,
				"--pc-fg": art.foreground,
			})}
			onPointerMove={parallax ? track : undefined}
			onPointerLeave={parallax ? untrack : undefined}
		>
			<div class="ui-paycard__flipper">
				<FrontFace
					card={card}
					art={art}
					variant={variant}
					wallet={wallet}
					expiryLabel={expiryLabel}
					parallax={parallax}
					holographic={holographic}
					hidden={decorative || isFlipped}
					name={name}
				/>
				{variant === "card" && (
					<BackFace art={art} note={backNote} hidden={decorative || !isFlipped} />
				)}
			</div>

			{canFlip && (
				<button
					type="button"
					class="ui-paycard__flip"
					aria-pressed={isFlipped ? "true" : "false"}
					aria-label={flipLabel ?? (isFlipped ? "Show card front" : "Show card back")}
					onClick={toggle}
				>
					<Icon name="refresh" size="sm" />
				</button>
			)}
		</div>
	);
}
// #endregion

// #region PaymentCardOption
/**
 * One selectable instrument in a picker — a `role="radio"` button wrapping a decorative
 * {@link PaymentCard}.
 *
 * A sibling component rather than a prop because `PaymentCard` can render its own flip `<button>`,
 * and a button nested in a `role="radio"` button is invalid HTML. The consumer supplies the
 * `role="radiogroup"` wrapper, its label and the roving `tabIndex`.
 *
 * @example
 * ```tsx
 * <div role="radiogroup" aria-label="Pay with">
 *   {cards.map((c) => (
 *     <PaymentCardOption key={c.id} card={c} art={resolveCardArt(c)}
 *       checked={c.id === selected.value} tabIndex={c.id === selected.value ? 0 : -1}
 *       onSelect={() => (selected.value = c.id)} />
 *   ))}
 * </div>
 * ```
 */
export function PaymentCardOption(props: PaymentCardOptionProps): JSX.Element {
	const {
		card,
		variant = "card",
		size = "sm",
		checked,
		onSelect,
		disabled = false,
		tabIndex,
		describedBy,
		label,
		class: className,
		id,
	} = props;

	const art = props.art ?? paymentCardArt(card);
	const name = label ?? describeCardFront(card, art, variant, {
		scopeLabel: variant === "wallet" ? props.scopeLabel ?? null : null,
		currency: variant === "wallet" ? props.currency ?? null : null,
	});

	return (
		<button
			type="button"
			id={id}
			role="radio"
			aria-checked={checked ? "true" : "false"}
			aria-label={name}
			aria-describedby={describedBy}
			disabled={disabled}
			tabIndex={tabIndex}
			class={cx(
				"ui-paycard-option",
				`ui-paycard-option--${size}`,
				checked && "ui-paycard-option--checked",
				className,
			)}
			onClick={disabled ? undefined : onSelect}
		>
			<PaymentCard
				card={card}
				art={art}
				variant={variant}
				scopeLabel={props.scopeLabel}
				currency={props.currency}
				size={size}
				decorative
			/>
			<span class="ui-paycard-option__mark" aria-hidden="true">
				<Icon name="check" size="xs" />
			</span>
		</button>
	);
}
// #endregion

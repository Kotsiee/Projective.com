import type { JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/payment-card.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Icon } from "../../icons/mod.ts";

/**
 * PaymentCard — a realistic saved-payment-card face with a real 3D flip.
 *
 * **The honesty contract this component inherits.** The app's existing wallet card
 * (`apps/web/features/wallet/components/PaymentCard.tsx`) renders no expiry, no cardholder name and
 * no back face, arguing that "an affordance implying we hold data we do not is worse than an empty
 * space". That component is not wrong and is not superseded — it renders a *payment method*
 * projection which genuinely has no expiry and no holder name.
 *
 * This component renders a *saved card*, and a saved card is a different record. Stripe returns
 * `brand`, `last4`, `exp_month`, `exp_year` and a billing name, and those five fragments are stored;
 * printing them is therefore reporting, not fabrication. The line falls in exactly one place:
 *
 * - The **PAN** is three (or two, on Amex) `aria-hidden` masked groups plus the REAL `last4`. The
 *   masked groups are the shape of a card number, never digits, and they are hidden from assistive
 *   tech so they can never be mistaken for a number we hold.
 * - The **security code** is never received and never stored, so the back's CVV box is a `•••`
 *   **ornament**: `aria-hidden`, never an `<input>`, never a value, and with no reveal affordance
 *   anywhere in the markup or in the BEM inventory. The back face's accessible name says so out
 *   loud rather than leaving the box to be interpreted.
 * - Every field **degrades to absence**. A null `expMonth`/`expYear` renders no expiry block at all
 *   rather than `--/--`; a null `cardholderName` renders nothing; a null `last4` renders no PAN.
 *
 * **Portability.** `packages/ui` may not import `@projective/types` (verified: `packages/ui/deno.json`
 * declares only `preact`, `@preact/signals` and `@material/material-color-utilities`), so
 * {@link PaymentCardData} and {@link PaymentCardArt} are LOCAL structural interfaces that the SSOT's
 * `SavedCard` and `CardArtConfig` satisfy by shape. An app should resolve `art` once with
 * `resolveCardArt()` from `@projective/types/finance` and pass it in; {@link paymentCardArt} is the
 * self-contained fallback for a consumer that has no SSOT (see its own note on the mirror).
 *
 * **Token-only.** Every colour on the face arrives as a design-token *expression* through a
 * `--pc-*` custom property. There is no hex, no remote asset and no network logo artwork in this
 * component: a published surface runs under a strict CSP with no third-party origins, so card art is
 * computed, and a network is named by its wordmark rather than reproduced as a trademarked mark.
 */

// #region Types
/** Face geometry step. All three are fluid — the card fills its column up to the step's ceiling. */
export type PaymentCardSize = "sm" | "md" | "lg";

/**
 * The resolved visual identity of one card, structurally identical to the SSOT's `CardArtConfig`.
 *
 * Every colour field is a **design-token expression** (`var(--primary)`, a `color-mix()` over
 * tokens, a `linear-gradient()` of those) that this component drops straight into a custom property,
 * so the face resolves against whichever theme, contrast overlay or colour-vision overlay is active.
 */
export interface PaymentCardArt {
	/** Network key, used only as a face modifier and a mask-shape hint (Amex groups 4-6-5). */
	network: string;
	/** Display name of the network ("Visa", "Mastercard", "Card"). */
	networkLabel: string;
	/** The programme we can honestly derive ("Visa Business"). `null` when unknown — never a bank. */
	issuerHint: string | null;
	/** The card body fill. */
	gradient: string;
	/** The EMV chip plate tone. */
	chipTone: string;
	/** The diagonal highlight tone (translucent). */
	sheenTone: string;
	/** Ink for everything printed on the face. */
	foreground: string;
	/**
	 * Whether the face carries the foil layer. Optional so a minimal caller can omit it; when absent
	 * it falls back to `card.isBusinessCard`, which is what the SSOT derives it from — a card that
	 * spends an entity's money is distinguishable from a personal one at a glance, which is a
	 * functional distinction rather than decoration.
	 */
	holographic?: boolean;
}

/**
 * The card fragments this component will print, structurally satisfied by the SSOT's `SavedCard`.
 *
 * There is deliberately no `pan` and no `cvv` field: they are not received, not stored, and adding
 * a slot for them is how a component starts implying otherwise.
 */
export interface PaymentCardData {
	/** Stripe brand string ("visa", "mastercard", "amex"…), or `null` on a card saved without one. */
	brand?: string | null;
	/** The last four digits — the only real digits on the face. */
	last4?: string | null;
	/** 1–12, or `null`. A null month renders no expiry block. */
	expMonth?: number | null;
	/** Four-digit year, or `null`. A null year renders no expiry block. */
	expYear?: number | null;
	/** Billing name as stored. `null` renders nothing. */
	cardholderName?: string | null;
	/** Leading issuer-identification digits (6–8). Usually `null`, so art degrades to `brand`. */
	binNumber?: string | null;
	/** Whether this card spends an entity's money — drives the heavier, foil-marked face. */
	isBusinessCard?: boolean;
	/** Marked as the owner's default instrument. */
	isDefault?: boolean;
	/** Past its expiry. */
	isExpired?: boolean;
}

/** Props for {@link PaymentCard}. */
export interface PaymentCardProps {
	/** The stored fragments to print. */
	card: PaymentCardData;
	/**
	 * Pre-resolved art. Pass `resolveCardArt(...)` output from the app so the face matches the
	 * server's projection exactly; omitted, {@link paymentCardArt} derives an equivalent locally.
	 */
	art?: PaymentCardArt;
	/** Geometry step (default `md`). */
	size?: PaymentCardSize;
	/**
	 * Controlled flip state. Supply it together with `onFlipChange` for a parent-driven flip; omit it
	 * and set `flippable` for a card that owns its own state.
	 */
	flipped?: boolean;
	/** Render the flip control, so the card can turn itself over. */
	flippable?: boolean;
	/** Notified with the next flip state whenever the control is activated. */
	onFlipChange?: (flipped: boolean) => void;
	/** Accessible label for the flip control (default "Show card back"/"Show card front"). */
	flipLabel?: string;
	/** Label above the expiry date (default "Expires"; "Valid thru" is the other common wording). */
	expiryLabel?: string;
	/** One short line on the back face — a custody statement, an issuer note. Omitted by default. */
	backNote?: string;
	/**
	 * Track the pointer and write `--pc-px`/`--pc-py`, so a highlight follows the cursor.
	 *
	 * **Off by default**, and it only ever sets custom properties — the CSS that consumes them is
	 * switched off entirely under `prefers-reduced-motion: reduce`, so the decision to move lives in
	 * the stylesheet rather than in a JS media query that can disagree with it.
	 */
	parallax?: boolean;
	/**
	 * Render both faces as pure ornament (`aria-hidden`), for when an ancestor already carries the
	 * accessible name — this is what {@link PaymentCardOption} uses. Forces `flippable` off: a
	 * control inside an `aria-hidden` subtree is a keyboard trap with no name.
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
	/** Geometry step (default `md`). */
	size?: PaymentCardSize;
	/** Whether this option is the selected one — rendered as `aria-checked`. */
	checked: boolean;
	/** Activated by click, Space or Enter. */
	onSelect?: () => void;
	/** Greys the option out and removes it from the tab order. */
	disabled?: boolean;
	/**
	 * Roving-tabindex slot. In a radio group only the checked (or first) option is `0` and the rest
	 * are `-1`, so a wallet of eight cards costs one Tab stop rather than eight.
	 */
	tabIndex?: number;
	/** Overrides the composed accessible name. */
	label?: string;
	class?: string;
	id?: string;
}
// #endregion

// #region Local art fallback
/**
 * The per-network recipe: which brand accent anchors the face, at what angle and mix strengths.
 *
 * These values MIRROR `@projective/types/finance/card-art` deliberately and are documented as a
 * mirror rather than pretending to be independent: `packages/ui` cannot import the SSOT without
 * breaking the portability contract, and a component that cannot render without an app-supplied
 * prop is not portable either. An app should still pass `art` — that is the canonical path, and it
 * is the one that stays correct if the SSOT's palette moves.
 */
const NETWORK_RECIPE: Record<string, { accent: string; angle: number; from: number; to: number }> =
	{
		visa: { accent: "--primary", angle: 135, from: 46, to: 18 },
		mastercard: { accent: "--secondary", angle: 120, from: 52, to: 20 },
		amex: { accent: "--tertiary", angle: 160, from: 44, to: 16 },
		discover: { accent: "--primary", angle: 100, from: 24, to: 50 },
		unionpay: { accent: "--secondary", angle: 200, from: 28, to: 48 },
		vault: { accent: "--primary", angle: 145, from: 74, to: 40 },
		unknown: { accent: "--on-surface", angle: 140, from: 12, to: 4 },
	};

/** Human label for a network key. */
function labelOf(network: string): string {
	switch (network) {
		case "visa":
			return "Visa";
		case "mastercard":
			return "Mastercard";
		case "amex":
			return "American Express";
		case "discover":
			return "Discover";
		case "unionpay":
			return "UnionPay";
		case "vault":
			return "Vault Card";
		default:
			return "Card";
	}
}

/**
 * Resolve a network from a BIN prefix, then from the brand string.
 *
 * A wallet wrapper (`apple_pay`/`google_pay`) resolves to `unknown` rather than to a guess: the
 * wrapper hides the card underneath, and naming a network we cannot see is a confident fabrication
 * on an instrument someone is about to be charged on.
 */
function networkOf(brand: string | null | undefined, bin: string | null | undefined): string {
	const digits = (bin ?? "").replace(/\D+/g, "");
	if (digits.length >= 4) {
		const four = Number.parseInt(digits.slice(0, 4), 10);
		if (four >= 2221 && four <= 2720) return "mastercard";
		if (four === 6011) return "discover";
	}
	if (digits.length >= 2) {
		const two = Number.parseInt(digits.slice(0, 2), 10);
		if (two >= 51 && two <= 55) return "mastercard";
		if (two === 34 || two === 37) return "amex";
		if (two === 65) return "discover";
		if (two === 62) return "unionpay";
	}
	if (digits.startsWith("4")) return "visa";

	const b = (brand ?? "").toLowerCase().replace(/[^a-z]/g, "");
	if (b.includes("visa")) return "visa";
	if (b.includes("mastercard") || b === "mc") return "mastercard";
	if (b.includes("amex") || b.includes("americanexpress")) return "amex";
	if (b.includes("discover")) return "discover";
	if (b.includes("unionpay") || b.includes("cup")) return "unionpay";
	if (b.includes("vault")) return "vault";
	return "unknown";
}

/**
 * Derive a token-only {@link PaymentCardArt} from the fragments a card already carries.
 *
 * Every ramp is anchored on `--surface-2` rather than laid over `--primary` directly, so
 * `foreground` can stay `var(--on-surface)`. That is deliberate rather than cautious: the
 * `--on-primary` / `--primary` pair measures 3.57:1 in dark mode (a live token-layer defect logged
 * against Decisions #64/#65), and a face printing a holder's name must not inherit it.
 *
 * Pure and total — no I/O, no clock, no randomness — so a server render and a client preview agree.
 */
export function paymentCardArt(card: PaymentCardData): PaymentCardArt {
	const network = networkOf(card.brand, card.binNumber);
	const recipe = NETWORK_RECIPE[network] ?? NETWORK_RECIPE.unknown;
	const label = labelOf(network);
	const business = card.isBusinessCard === true;

	// A business card sits a step deeper so it reads as the heavier of the two instruments.
	const lift = business ? 12 : 0;
	const from = Math.min(recipe.from + lift, 92);
	const to = Math.min(recipe.to + lift, 92);
	const mix = (pct: number) =>
		`color-mix(in srgb, var(${recipe.accent}) ${pct}%, var(--surface-2))`;

	return {
		network,
		networkLabel: label,
		issuerHint: network === "unknown"
			? null
			: network !== "vault" && business
			? `${label} Business`
			: label,
		gradient: `linear-gradient(${recipe.angle}deg, ${mix(from)} 0%, ${mix(to)} 100%)`,
		chipTone: `color-mix(in srgb, var(--on-surface) ${business ? 38 : 28}%, var(--surface-3))`,
		sheenTone: `color-mix(in srgb, var(--on-surface) ${business ? 16 : 10}%, transparent)`,
		foreground: "var(--on-surface)",
		holographic: business,
	};
}
// #endregion

// #region Derivation
/**
 * `MM/YY`, or `null` when either half is missing.
 *
 * A partial expiry renders NOTHING rather than a placeholder: `--/--` in the slot where a date
 * belongs reads as a date we failed to load, which is a different and worse claim than silence.
 */
function expiryOf(card: PaymentCardData): string | null {
	const m = card.expMonth;
	const y = card.expYear;
	if (m == null || y == null) return null;
	if (!Number.isFinite(m) || !Number.isFinite(y)) return null;
	return `${String(m).padStart(2, "0")}/${String(y % 100).padStart(2, "0")}`;
}

/**
 * The mask groups that precede the live `last4`.
 *
 * Amex prints 4-6-5 rather than 4-4-4-4, so its mask is two groups. This is the SHAPE of a number,
 * never digits — every group returned here is rendered `aria-hidden`.
 */
function maskGroupsFor(network: string): readonly string[] {
	return network === "amex" ? ["••••", "•".repeat(6)] : [
		"••••",
		"••••",
		"••••",
	];
}

/**
 * The front face's single accessible name.
 *
 * It carries only facts we hold, in the order a reader needs them, so a screen-reader user learns
 * exactly what a sighted user learns from the printing — and nothing the printing does not say.
 */
function describeFront(card: PaymentCardData, art: PaymentCardArt, expiry: string | null): string {
	const parts: string[] = [art.issuerHint ?? art.networkLabel];
	if (card.last4) parts.push(`ending ${card.last4}`);
	if (expiry && card.expMonth != null && card.expYear != null) {
		parts.push(`expires ${String(card.expMonth).padStart(2, "0")} ${card.expYear}`);
	}
	if (card.cardholderName) parts.push(card.cardholderName);
	if (card.isDefault) parts.push("default card");
	if (card.isExpired) parts.push("expired");
	return parts.join(", ");
}

/**
 * The back face's accessible name.
 *
 * It states the absence explicitly. A silent `•••` box is read by a sighted user as "the code is
 * here, hidden"; saying that the code is not stored is the only way the two audiences learn the
 * same thing.
 */
function describeBack(art: PaymentCardArt): string {
	return `${art.networkLabel} card, reverse: magnetic stripe and signature panel. ` +
		"The security code is not stored and is not shown.";
}

/**
 * The EMV chip plate.
 *
 * Drawn in CSS rather than as an icon: `icon.css` is explicit that artwork does not take `.ui-icon`
 * and must not be normalised to the icon stroke. A chip is artwork.
 */
function chipPlate(): VNode {
	return (
		<span class="ui-paycard__chip" aria-hidden="true">
			<span class="ui-paycard__chip-trace" />
		</span>
	);
}

/**
 * The contactless mark — three arcs.
 *
 * Artwork, not an icon (see {@link chipPlate}), so it carries its own geometry and deliberately does
 * NOT take `.ui-icon`. Returned from a function rather than held as a module constant so every card
 * mounts its own instance: a shared VNode cannot appear twice in one tree, and a wallet renders
 * several cards at once.
 */
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
/** The printed front. Pure presentation — every branch above it has already been decided. */
function FrontFace(props: {
	card: PaymentCardData;
	art: PaymentCardArt;
	expiry: string | null;
	expiryLabel: string;
	parallax: boolean;
	holographic: boolean;
	hidden: boolean;
	name: string;
}): VNode {
	const { card, art, expiry, expiryLabel, parallax, holographic, hidden, name } = props;

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

			<div class="ui-paycard__row ui-paycard__row--top">
				<span class="ui-paycard__emv">
					{chipPlate()}
					{contactlessMark()}
				</span>

				{
					/*
					 * Status marks. The face's own accessible name already carries both facts, so these are
					 * `aria-hidden` ornament rather than a second announcement — but each still spends a
					 * GLYPH and a WORD as well as a tone, so neither state rests on colour alone.
					 */
				}
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
			</div>

			{
				/*
				 * The PAN zone. Only the trailing group is real; the masked groups exist so the face reads
				 * as a card and are hidden from assistive tech so they can never be mistaken for digits we
				 * hold. A card with no `last4` renders no PAN at all rather than a mask of nothing.
				 */
			}
			{card.last4
				? (
					<p class="ui-paycard__pan">
						{maskGroupsFor(art.network).map((group, i) => (
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
				)
				: <p class="ui-paycard__pan ui-paycard__pan--empty" aria-hidden="true" />}

			<div class="ui-paycard__row ui-paycard__row--bottom">
				<span class="ui-paycard__fields">
					{expiry && (
						<span class="ui-paycard__field ui-paycard__field--expiry">
							<span class="ui-paycard__field-label">{expiryLabel}</span>
							<span class="ui-paycard__field-value">{expiry}</span>
						</span>
					)}
					{card.cardholderName && (
						<span class="ui-paycard__field ui-paycard__field--holder">
							<span class="ui-paycard__field-value ui-paycard__field-value--name">
								{card.cardholderName}
							</span>
						</span>
					)}
				</span>

				{/* A wordmark is a logo, not text — it keeps its own direction in every locale. */}
				<span class="ui-paycard__network" aria-hidden="true">
					<span class="ui-paycard__network-name">{art.networkLabel}</span>
					{art.issuerHint && art.issuerHint !== art.networkLabel && (
						<span class="ui-paycard__network-hint">{art.issuerHint}</span>
					)}
				</span>
			</div>
		</div>
	);
}

/** The reverse. Carries no value anywhere — see the module doc for why the CVV box is ornament. */
function BackFace(props: { art: PaymentCardArt; note?: string; hidden: boolean }): VNode {
	const { art, note, hidden } = props;

	return (
		<div
			class="ui-paycard__face ui-paycard__face--back"
			role={hidden ? undefined : "img"}
			aria-label={hidden ? undefined : describeBack(art)}
			aria-hidden={hidden ? "true" : undefined}
			inert={hidden || undefined}
		>
			<span class="ui-paycard__sheen" aria-hidden="true" />
			<span class="ui-paycard__stripe" aria-hidden="true" />

			<div class="ui-paycard__sigrow" aria-hidden="true">
				<span class="ui-paycard__signature" />
				{
					/*
					 * ORNAMENT. Three bullets in the shape of a security-code box, so the reverse reads as a
					 * card. It is not an input, not a value, not revealable, and carries no label that would
					 * imply a stored code — the face's accessible name says outright that no code is held.
					 */
				}
				<span class="ui-paycard__cvv">
					<span class="ui-paycard__cvv-dots">•••</span>
				</span>
			</div>

			<div class="ui-paycard__backfoot" aria-hidden="true">
				{note && <span class="ui-paycard__note">{note}</span>}
				<span class="ui-paycard__network-name">{art.networkLabel}</span>
			</div>
		</div>
	);
}
// #endregion

// #region PaymentCard
/**
 * Render one saved card as a flippable, ISO-7810 ID-1 (CR80, 1.586:1) face.
 *
 * @example A static face in a list.
 * ```tsx
 * <PaymentCard card={saved} art={resolveCardArt(saved)} size="sm" />
 * ```
 * @example A self-flipping hero card with a pointer-tracked highlight.
 * ```tsx
 * <PaymentCard card={saved} art={art} size="lg" flippable parallax backNote="Held by our processor" />
 * ```
 */
export function PaymentCard(props: PaymentCardProps): JSX.Element {
	const {
		card,
		size = "md",
		flipped,
		flippable = false,
		onFlipChange,
		flipLabel,
		expiryLabel = "Expires",
		backNote,
		parallax = false,
		decorative = false,
		label,
		class: className,
		id,
	} = props;

	// Hooks run unconditionally; the internal signal is simply unread when `flipped` is controlled.
	const internal = useSignal(false);
	const root = useRef<HTMLDivElement | null>(null);

	const art = props.art ?? paymentCardArt(card);
	const isFlipped = flipped ?? internal.value;
	// A control inside an `aria-hidden` subtree is a keyboard trap with no accessible name.
	const canFlip = flippable && !decorative;
	const expiry = expiryOf(card);
	const holographic = art.holographic ?? (card.isBusinessCard === true);
	const name = label ?? describeFront(card, art, expiry);

	function toggle() {
		const next = !isFlipped;
		if (flipped === undefined) internal.value = next;
		onFlipChange?.(next);
	}

	/**
	 * Write the pointer position as custom properties.
	 *
	 * A direct property write rather than a signal binding: a signal would re-render the whole face
	 * on every pointer sample. The stylesheet decides whether the values are USED, which is what
	 * keeps the reduced-motion answer in one place.
	 */
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
				// The one deliberate consumer hook — see the `--net-*` note in payment-card.css.
				`ui-paycard--net-${art.network}`,
				holographic && "ui-paycard--holo",
				card.isExpired === true && "ui-paycard--expired",
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
					expiry={expiry}
					expiryLabel={expiryLabel}
					parallax={parallax}
					holographic={holographic}
					hidden={decorative || isFlipped}
					name={name}
				/>
				<BackFace art={art} note={backNote} hidden={decorative || !isFlipped} />
			</div>

			{
				/*
				 * The flip control sits OUTSIDE the flipper, not on a face. A face becomes `aria-hidden`
				 * and `inert` the moment it turns away, so a control living on one would vanish from the
				 * accessibility tree exactly when it is needed — and a Tab would otherwise land on an
				 * off-screen face. Out here it persists, keeps its name, and is the only tab stop.
				 */
			}
			{canFlip && (
				<button
					type="button"
					class="ui-paycard__flip"
					/* Preact drops `aria-pressed={false}`; the string renders the attribute in both states. */
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
 * One selectable card in a picker — a `role="radio"` button wrapping a decorative {@link PaymentCard}.
 *
 * **Why a sibling component rather than an `interactive` prop.** `PaymentCard` can render its own
 * flip `<button>`; a nested button inside a `role="radio"` button is invalid HTML and breaks both
 * controls. Keeping the picker cell separate makes that structurally impossible instead of leaving
 * it to a prop combination nobody checks — the option always wraps a `decorative` face, which has no
 * interactive descendants and is silent to assistive tech, so the button owns exactly one name and
 * one role.
 *
 * The consumer supplies the `role="radiogroup"` wrapper, its group label, and the roving `tabIndex`
 * (only the checked option is `0`), which is what keeps the arrow-key behaviour with the group that
 * owns the collection rather than duplicated into every cell.
 *
 * @example
 * ```tsx
 * <div role="radiogroup" aria-label="Pay with">
 *   {cards.map((c) => (
 *     <PaymentCardOption
 *       key={c.id}
 *       card={c}
 *       art={resolveCardArt(c)}
 *       checked={c.id === selected.value}
 *       tabIndex={c.id === selected.value ? 0 : -1}
 *       onSelect={() => (selected.value = c.id)}
 *     />
 *   ))}
 * </div>
 * ```
 */
export function PaymentCardOption(props: PaymentCardOptionProps): JSX.Element {
	const {
		card,
		size = "sm",
		checked,
		onSelect,
		disabled = false,
		tabIndex,
		label,
		class: className,
		id,
	} = props;

	const art = props.art ?? paymentCardArt(card);
	const name = label ?? describeFront(card, art, expiryOf(card));

	return (
		<button
			type="button"
			id={id}
			role="radio"
			/* Both states must render — an absent `aria-checked` on a radio is an unchecked radio. */
			aria-checked={checked ? "true" : "false"}
			aria-label={name}
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
			<PaymentCard card={card} art={art} size={size} decorative />
			{
				/*
				 * The selection mark is a drawn tick in a filled disc — a SHAPE that appears and
				 * disappears, on top of the ring and the tonal lift. Selection never rests on the tint
				 * alone, and the fact itself is carried by `aria-checked`, so this is ornament.
				 */
			}
			<span class="ui-paycard-option__mark" aria-hidden="true">
				<Icon name="check" size="xs" />
			</span>
		</button>
	);
}
// #endregion

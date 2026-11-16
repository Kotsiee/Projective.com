// #region Types
/** Face geometry ceiling. Every interior measure is fluid in `cqi` beneath it. */
export type PaymentCardSize = "sm" | "md" | "lg";

/**
 * What the face prints. `card` reports a saved card's stored fragments; `wallet` is the platform's
 * own balance plate — a wordmark, a scope, a currency and a holder, and never a number.
 */
export type PaymentCardVariant = "card" | "wallet";

/**
 * The resolved visual identity of one card, structurally identical to the SSOT's `CardArtConfig`.
 *
 * Every colour field is a **design-token expression** (`var(--primary)`, a `color-mix()` or relative
 * `oklch(from …)` over tokens, a `linear-gradient()` of those) dropped straight into a custom
 * property, so the face resolves against whichever theme, contrast or colour-vision overlay is active.
 */
export interface PaymentCardArt {
	/** Network key, used as a face modifier and a mask-shape hint (Amex groups 4-6-5). */
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
	/** Whether the face carries the foil layer; absent, it follows `card.isBusinessCard`. */
	holographic?: boolean;
}

/**
 * The card fragments the face will print, structurally satisfied by the SSOT's `SavedCard`.
 *
 * There is deliberately no `pan` and no `cvv` field: they are not received, not stored, and a slot
 * for them is how a component starts implying otherwise.
 */
export interface PaymentCardData {
	/** Stripe brand string ("visa", "mastercard", "amex"…), or `null`. */
	brand?: string | null;
	/** The last four digits — the only real digits on the face. */
	last4?: string | null;
	/** 1–12, or `null`. A null month renders no expiry block. */
	expMonth?: number | null;
	/** Four-digit year, or `null`. A null year renders no expiry block. */
	expYear?: number | null;
	/** Billing or account name as stored. `null` renders nothing. */
	cardholderName?: string | null;
	/** Leading issuer-identification digits (6–8). Usually `null`, so art degrades to `brand`. */
	binNumber?: string | null;
	/** Whether this card spends an entity's money — drives the deeper, foil-marked face. */
	isBusinessCard?: boolean;
	/** Marked as the owner's default instrument. */
	isDefault?: boolean;
	/** Past its expiry. */
	isExpired?: boolean;
}

/** What a `wallet` face prints beyond the holder name. */
export interface PaymentCardWalletFace {
	/** The account's scope as the platform names it ("Personal wallet", "Team vault"). */
	scopeLabel: string | null;
	/** ISO 4217 code the balance is held in. */
	currency: string | null;
}
// #endregion

// #region Local art fallback
interface NetworkRecipe {
	accent: string | null;
	angle: number;
	lit: number;
}

const NETWORK_RECIPE: Record<string, NetworkRecipe> = {
	visa: { accent: "--primary", angle: 115, lit: 0.46 },
	mastercard: { accent: "--secondary", angle: 125, lit: 0.46 },
	amex: { accent: "--tertiary", angle: 160, lit: 0.46 },
	discover: { accent: "--tertiary", angle: 100, lit: 0.44 },
	unionpay: { accent: "--secondary", angle: 200, lit: 0.44 },
	vault: { accent: "--primary", angle: 135, lit: 0.46 },
	unknown: { accent: null, angle: 140, lit: 0 },
};

const RAMP_FALL = [0, 0.08, 0.17] as const;
const BUSINESS_DEPTH = 0.04;
const GRAPHITE_STOPS = [30, 21, 13] as const;
const STOP_AT = ["0%", "48%", "100%"] as const;

function accentStop(accent: string, lightness: number): string {
	return `oklch(from var(${accent}) ${lightness.toFixed(2)} min(c, 0.13) h)`;
}

function graphiteStop(share: number): string {
	return `color-mix(in srgb, var(--on-scrim) ${share}%, var(--scrim))`;
}

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
			return "Projective Vault Card";
		default:
			return "Card";
	}
}

/**
 * Resolve a network from a BIN prefix, then from the brand string — the same IIN ranges as the SSOT.
 * A wallet wrapper (`apple_pay`/`google_pay`) resolves to `unknown`: naming a network the wrapper
 * hides would be a confident fabrication on an instrument someone is about to be charged on.
 */
export function cardNetworkOf(
	brand: string | null | undefined,
	bin: string | null | undefined,
): string {
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
 * A **mirror** of `resolveCardArt()` in `@projective/types/finance`, kept byte-identical (pinned by
 * `card-art-parity.test.ts`): `packages/ui` cannot import the SSOT without breaking its portability,
 * and a component that cannot render without an app-supplied prop is not portable either. An app
 * should still pass `art` — that is the canonical path.
 *
 * Pure and total, so a server render and a client preview agree.
 */
export function paymentCardArt(card: PaymentCardData): PaymentCardArt {
	const network = cardNetworkOf(card.brand, card.binNumber);
	const recipe = NETWORK_RECIPE[network] ?? NETWORK_RECIPE.unknown;
	const label = labelOf(network);
	const business = card.isBusinessCard === true;
	const depth = business ? BUSINESS_DEPTH : 0;
	const accent = recipe.accent;

	const stops = accent === null
		? GRAPHITE_STOPS.map((share) => graphiteStop(share - (business ? 4 : 0)))
		: RAMP_FALL.map((fall) => accentStop(accent, recipe.lit - fall - depth));

	return {
		network,
		networkLabel: label,
		issuerHint: network === "unknown"
			? null
			: network !== "vault" && business
			? `${label} Business`
			: label,
		gradient: `linear-gradient(${recipe.angle}deg, ${
			stops.map((stop, i) => `${stop} ${STOP_AT[i]}`).join(", ")
		})`,
		chipTone: "color-mix(in srgb, var(--on-scrim) 78%, var(--scrim))",
		sheenTone: `color-mix(in srgb, var(--on-scrim) ${business ? 14 : 11}%, transparent)`,
		foreground: "var(--on-scrim)",
		holographic: business,
	};
}
// #endregion

// #region Printed fragments
/**
 * The typographic wordmark printed for a network, or `null` for an unknown one. A wordmark rather
 * than artwork: reproducing a network's mark is a licensing claim a design system must not make.
 */
export function cardWordmarkOf(art: PaymentCardArt): string | null {
	if (art.network === "unknown") return null;
	if (art.network === "amex") return "Amex";
	return art.networkLabel;
}

/** The programme qualifier printed under the wordmark ("Business" from "Visa Business"), if any. */
export function cardProgrammeOf(art: PaymentCardArt): string | null {
	const hint = art.issuerHint;
	if (!hint || hint === art.networkLabel) return null;
	return hint.startsWith(`${art.networkLabel} `) ? hint.slice(art.networkLabel.length + 1) : hint;
}

/**
 * `MM/YY`, or `null` when either half is missing. A partial expiry renders NOTHING: `--/--` in the
 * slot where a date belongs reads as a date that failed to load.
 */
export function cardExpiryOf(card: PaymentCardData): string | null {
	const m = card.expMonth;
	const y = card.expYear;
	if (m == null || y == null) return null;
	if (!Number.isFinite(m) || !Number.isFinite(y)) return null;
	return `${String(m).padStart(2, "0")}/${String(y % 100).padStart(2, "0")}`;
}

/**
 * The mask groups that precede the real `last4` — the SHAPE of a number, never digits. Amex prints
 * 4-6-5, so its mask is two groups.
 */
export function cardMaskGroupsFor(network: string): readonly string[] {
	return network === "amex" ? ["••••", "•".repeat(6)] : ["••••", "••••", "••••"];
}
// #endregion

// #region Accessible names
/** The front face's single accessible name: only facts we hold, in the order a reader needs them. */
export function describeCardFront(
	card: PaymentCardData,
	art: PaymentCardArt,
	variant: PaymentCardVariant,
	wallet: PaymentCardWalletFace,
): string {
	if (variant === "wallet") {
		const parts: string[] = [`${art.networkLabel} wallet`];
		if (wallet.scopeLabel) parts.push(wallet.scopeLabel);
		if (wallet.currency) parts.push(`held in ${wallet.currency}`);
		if (card.cardholderName) parts.push(card.cardholderName);
		return parts.join(", ");
	}

	const parts: string[] = [art.issuerHint ?? art.networkLabel];
	if (card.last4) parts.push(`ending ${card.last4}`);
	if (card.expMonth != null && card.expYear != null && cardExpiryOf(card)) {
		parts.push(`expires ${String(card.expMonth).padStart(2, "0")} ${card.expYear}`);
	}
	if (card.cardholderName) parts.push(card.cardholderName);
	if (card.isDefault) parts.push("default card");
	if (card.isExpired) parts.push("expired");
	return parts.join(", ");
}

/**
 * The back face's accessible name. It states the absence outright: a silent `•••` box reads to a
 * sighted user as "the code is here, hidden", so both audiences are told no code is held.
 */
export function describeCardBack(art: PaymentCardArt): string {
	return `${art.networkLabel} card, reverse: magnetic stripe and signature panel. ` +
		"The security code is not stored and is not shown.";
}
// #endregion

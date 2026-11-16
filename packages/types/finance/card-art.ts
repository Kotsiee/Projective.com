import { z } from "zod";

/**
 * finance card art — the DERIVED visual identity of a saved payment card.
 *
 * A card face is resolved from what we already hold (`brand`, the issuer-identification `binNumber`,
 * and whether the card belongs to an entity) into **design-token expressions** — never a raw colour and
 * never a remote asset. Two constraints force that shape:
 *
 *  1. `packages/ui` is **token-only** (root CLAUDE.md §3): a component reads `var(--*)` and may not
 *     carry a hex, so the art this module returns is composed of `var()` / `color-mix()` expressions
 *     that resolve against whichever theme, contrast overlay, or colour-blindness overlay is active.
 *  2. There is **no external asset host**. A published surface runs under a strict CSP with no
 *     third-party origins, so a network-hosted card-art image could not load; the face is therefore
 *     computed, not fetched.
 *
 * Nothing here identifies the issuing bank. We ship no BIN database, so {@link resolveCardArt} reports
 * only the card *programme* it can honestly derive (network + commercial flag) and returns `null`
 * rather than guessing an institution. Only regex/min/max/enum primitives are used so the schema stays
 * stable across Zod majors (matching `common.ts`).
 */

// #region Brand + network vocabularies
/**
 * `finance.card_brand` — the safe display fragment Stripe returns for a saved instrument, mirrored
 * member-for-member and in column order.
 *
 * It deliberately collapses two axes: `apple_pay`/`google_pay` are wallet *wrappers* around an
 * underlying network card, not networks, and `vault` is the platform-issued Projective Vault Card
 * (spend against a wallet balance, never a Stripe network card). Nothing routes money by reading this.
 */
export const CardBrand = z.enum([
	"visa",
	"mastercard",
	"amex",
	"discover",
	"unionpay",
	"apple_pay",
	"google_pay",
	"vault",
	"unknown",
]);
export type CardBrand = z.infer<typeof CardBrand>;

/**
 * The network a face is themed for — a **narrower** vocabulary than {@link CardBrand} on purpose.
 *
 * A wallet-wrapped card (`apple_pay`/`google_pay`) has no network we can recover from the brand alone,
 * so it themes as `unknown` unless a BIN resolves the card underneath. `unknown` is therefore a
 * first-class member, not an error: a card saved before we captured a BIN still has to render.
 */
export const CardNetwork = z.enum([
	"visa",
	"mastercard",
	"amex",
	"discover",
	"unionpay",
	"vault",
	"unknown",
]);
export type CardNetwork = z.infer<typeof CardNetwork>;

/**
 * A CSS value composed only of design tokens — `var(--primary)`,
 * `color-mix(in srgb, var(--primary) 40%, var(--surface-2))`, a `linear-gradient()` over those.
 *
 * The `#`-rejecting guard is the merge gate expressed as a type: a raw hex colour cannot be written
 * into a card face without the schema refusing it, so the token-only rule is enforced at the SSOT
 * boundary rather than by review.
 */
const tokenExpression = z.string().min(1).max(280).regex(
	/^[^#]*$/,
	"Card art must be a design-token expression, never a raw hex colour.",
);
// #endregion

// #region Config
/**
 * The resolved face of one card. Every colour field is a token expression the UI drops straight into a
 * custom property; `holographic` is the only behavioural flag (it enables the animated foil sweep).
 */
export const CardArtConfigSchema = z.object({
	network: CardNetwork,
	/** Display name of the network ("Visa", "Mastercard", "Card"). */
	networkLabel: z.string().max(40),
	/**
	 * The card programme we can honestly derive ("Visa Business", "Mastercard"). `null` when the
	 * network is unknown. Never the issuing bank — see the module note.
	 */
	issuerHint: z.string().max(60).nullable(),
	/** The card body fill — a `linear-gradient()` over token mixes. */
	gradient: tokenExpression,
	/** The EMV chip plate tone. */
	chipTone: tokenExpression,
	/** The diagonal highlight sweep tone (translucent). */
	sheenTone: tokenExpression,
	/** Ink for the number fragment, holder name and expiry printed on the face. */
	foreground: tokenExpression,
	/**
	 * Whether the face carries the animated foil sweep. Enabled for **business** cards so a card that
	 * spends an entity's money is distinguishable from a personal one at a glance — a functional
	 * distinction, not decoration (the `/wallet` rule that a capability difference must be visible).
	 */
	holographic: z.boolean(),
});
export type CardArtConfig = z.infer<typeof CardArtConfigSchema>;

/** What {@link resolveCardArt} needs — the safe fragments a {@link SavedCard} already carries. */
export interface CardArtInput {
	/** The Stripe-reported brand string ("visa", "Mastercard", "amex"), when known. */
	brand: string | null;
	/** The leading issuer-identification digits (6–8). Never a full PAN. */
	binNumber: string | null;
	/** Whether this card spends an entity's money rather than an individual's. */
	isBusinessCard: boolean;
}
// #endregion

// #region Network resolution
/** Strip everything but digits, so a formatted or spaced BIN still resolves. */
function digitsOf(raw: string): string {
	return raw.replace(/\D+/g, "");
}

/**
 * Resolve a network from the leading digits of a card number, using the well-known IIN ranges:
 * `4` Visa · `51`–`55` and `2221`–`2720` Mastercard · `34`/`37` Amex · `6011`/`65` Discover ·
 * `62` UnionPay.
 *
 * Longer prefixes are tested first so `6011` is not swallowed by a shorter rule. Returns `null` — not
 * `unknown` — when nothing matches, so a caller can fall back to {@link networkFromBrand} rather than
 * treating an unrecognised BIN as a positive "this is an unknown network" answer.
 */
export function networkFromBin(bin: string | null): CardNetwork | null {
	if (!bin) return null;
	const d = digitsOf(bin);
	if (d.length === 0) return null;

	const four = Number.parseInt(d.slice(0, 4), 10);
	if (d.length >= 4 && Number.isFinite(four)) {
		if (four >= 2221 && four <= 2720) return "mastercard";
		if (four === 6011) return "discover";
	}

	const two = Number.parseInt(d.slice(0, 2), 10);
	if (d.length >= 2 && Number.isFinite(two)) {
		if (two >= 51 && two <= 55) return "mastercard";
		if (two === 34 || two === 37) return "amex";
		if (two === 65) return "discover";
		if (two === 62) return "unionpay";
	}

	if (d.startsWith("4")) return "visa";
	return null;
}

/**
 * Resolve a network from a {@link CardBrand} (or any Stripe brand string). Case- and
 * separator-insensitive.
 *
 * `apple_pay`/`google_pay` resolve to `unknown` rather than to a guessed network: the wrapper hides
 * the card underneath, and naming a network we cannot see would be a confident fabrication on an
 * instrument the buyer is about to be charged on.
 */
export function networkFromBrand(brand: string | null): CardNetwork {
	const b = (brand ?? "").toLowerCase().replace(/[^a-z]/g, "");
	if (b.includes("visa")) return "visa";
	if (b.includes("mastercard") || b === "mc") return "mastercard";
	if (b.includes("amex") || b.includes("americanexpress")) return "amex";
	if (b.includes("discover")) return "discover";
	if (b.includes("unionpay") || b.includes("cup")) return "unionpay";
	if (b.includes("vault")) return "vault";
	return "unknown";
}

/** Human label for a network. */
export function networkLabel(network: CardNetwork): string {
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
		case "unknown":
			return "Card";
	}
}
// #endregion

// #region Token palettes
interface NetworkRecipe {
	accent: string | null;
	angle: number;
	lit: number;
}

const NETWORK_RECIPE: Record<CardNetwork, NetworkRecipe> = {
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
// #endregion

// #region Resolution
/**
 * Resolve the full card face.
 *
 * BIN wins over `brand` when it resolves (it is the authoritative issuer prefix), and degrades to the
 * brand string when the BIN is absent or unrecognised — so a card stored before BIN capture still gets
 * its correct network rather than the `unknown` face.
 *
 * The face is a deep three-stop ramp in the network's accent, printed in `var(--on-scrim)`. Each stop
 * pins OKLCH lightness (≤ 0.46) and keeps the token's own hue and chroma, so the face is identical in
 * light and dark mode and its ink clears 4.5:1 at the lit edge in both — `--secondary`/`--tertiary`
 * flip between tone 40 and tone 80 across the modes, which a `color-mix()` ramp could not absorb. The
 * `--on-primary`/`--primary` pair (3.57:1 in dark) is never used for ink.
 *
 * Pure and total — no I/O, no clock, no randomness — so the server projection and any client preview
 * render the same face.
 */
export function resolveCardArt(input: CardArtInput): CardArtConfig {
	const network = networkFromBin(input.binNumber) ?? networkFromBrand(input.brand);
	const recipe = NETWORK_RECIPE[network];
	const label = networkLabel(network);
	const depth = input.isBusinessCard ? BUSINESS_DEPTH : 0;
	const accent = recipe.accent;

	const stops = accent === null
		? GRAPHITE_STOPS.map((share) => graphiteStop(share - (input.isBusinessCard ? 4 : 0)))
		: RAMP_FALL.map((fall) => accentStop(accent, recipe.lit - fall - depth));

	return {
		network,
		networkLabel: label,
		issuerHint: network === "unknown"
			? null
			: network !== "vault" && input.isBusinessCard
			? `${label} Business`
			: label,
		gradient: `linear-gradient(${recipe.angle}deg, ${
			stops.map((stop, i) => `${stop} ${STOP_AT[i]}`).join(", ")
		})`,
		chipTone: "color-mix(in srgb, var(--on-scrim) 78%, var(--scrim))",
		sheenTone: `color-mix(in srgb, var(--on-scrim) ${
			input.isBusinessCard ? 14 : 11
		}%, transparent)`,
		foreground: "var(--on-scrim)",
		holographic: input.isBusinessCard,
	};
}
// #endregion

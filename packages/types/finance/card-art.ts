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
/** The per-network recipe: which brand accent anchors the face, at what angle and mix strengths. */
interface NetworkRecipe {
	accent: string;
	angle: number;
	fromPct: number;
	toPct: number;
}

/**
 * Networks are distinguished on **two** axes — which of the three brand accents anchors the face, and
 * the angle/strength of the ramp — because the theme engine emits only `--primary`/`--secondary`/
 * `--tertiary` as brand accents and five networks cannot each own one. Semantic tokens
 * (`--success`/`--warning`/`--danger`) are deliberately excluded: they carry meaning, and a card is not
 * a status.
 */
const NETWORK_RECIPE: Record<CardNetwork, NetworkRecipe> = {
	visa: { accent: "--primary", angle: 135, fromPct: 46, toPct: 18 },
	mastercard: { accent: "--secondary", angle: 120, fromPct: 52, toPct: 20 },
	amex: { accent: "--tertiary", angle: 160, fromPct: 44, toPct: 16 },
	discover: { accent: "--primary", angle: 100, fromPct: 24, toPct: 50 },
	unionpay: { accent: "--secondary", angle: 200, fromPct: 28, toPct: 48 },
	vault: { accent: "--primary", angle: 145, fromPct: 74, toPct: 40 },
	unknown: { accent: "--on-surface", angle: 140, fromPct: 12, toPct: 4 },
};

/** A token mix of `accent` into the card's surface ground. */
function mix(accent: string, pct: number): string {
	return `color-mix(in srgb, var(${accent}) ${pct}%, var(--surface-2))`;
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
 * Every ramp is anchored on `--surface-2` rather than laid over `--primary` directly, so `foreground`
 * can stay `var(--on-surface)`. That is deliberate: the `--on-primary` / `--primary` pair measures
 * 3.57:1 in dark mode (a live, unresolved token-layer defect flagged by CLAUDE.md Decisions #64/#65),
 * and a card face printing a holder's name must not inherit it.
 *
 * Pure and total — no I/O, no clock, no randomness — so the server projection and any client preview
 * render the same face.
 */
export function resolveCardArt(input: CardArtInput): CardArtConfig {
	const network = networkFromBin(input.binNumber) ?? networkFromBrand(input.brand);
	const recipe = NETWORK_RECIPE[network];
	const label = networkLabel(network);

	// A business card sits a step deeper so it reads as the heavier instrument of the two.
	const lift = input.isBusinessCard ? 12 : 0;
	const from = Math.min(recipe.fromPct + lift, 92);
	const to = Math.min(recipe.toPct + lift, 92);

	return {
		network,
		networkLabel: label,
		issuerHint: network === "unknown"
			? null
			: network !== "vault" && input.isBusinessCard
			? `${label} Business`
			: label,
		gradient: `linear-gradient(${recipe.angle}deg, ${mix(recipe.accent, from)} 0%, ${
			mix(recipe.accent, to)
		} 100%)`,
		chipTone: `color-mix(in srgb, var(--on-surface) ${
			input.isBusinessCard ? 38 : 28
		}%, var(--surface-3))`,
		sheenTone: `color-mix(in srgb, var(--on-surface) ${
			input.isBusinessCard ? 16 : 10
		}%, transparent)`,
		foreground: "var(--on-surface)",
		holographic: input.isBusinessCard,
	};
}
// #endregion

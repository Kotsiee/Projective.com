/**
 * pricing-calc — the Pricing section's arithmetic and words (`flows/LANDING.md` §4.9; claims C1–C7,
 * E1, N9): what a client pays for one stage, and what the team receives once the platform fee comes
 * off it, computed exactly as the database computes it. Pure and deterministic: no clock, no
 * locale, no network.
 *
 * The fee is never hard-coded. Every figure takes the server's basis points (`platform_fee_bp`,
 * read through `PublicMetricsService`) and runs through {@link platformFeeFor}
 * (`@projective/types/finance/fee`), which truncates to the penny exactly as SQL's integer division
 * does at every release — `fn_release_ticket_escrow`,
 * `supabase/migrations/00001200_functions_finance_core.sql:742-744`:
 *
 *   v_fee_bp := finance.fn_escrow_fee_bp(r.payer_business_id, r.payer_user_id);  -- :742
 *   v_fee    := (r.amount_cents * v_fee_bp) / 10000;                             -- :743
 *   v_payout := r.amount_cents + COALESCE(r.deadline_bonus_cents, 0) - v_fee;    -- :744
 *
 * with the rate from `fn_escrow_fee_bp` (`:691-707`). The client pays the stage price and nothing
 * on top (C2); the fee comes out of the team's payment (C3).
 *
 * The calculator island imports this module, so it stays a leaf: it reaches only the fee module,
 * never a Zod barrel. The fee's percentage label ("5%") is formatted on the server and handed in.
 */
import { platformFeeFor } from "@projective/types/finance/fee";

// #region Limits
/** The calculator's starting price: £2,000, the worked example's stage (§4.9). */
export const DEFAULT_PRICE_MINOR = 200_000;

/** What one press of a stepper adds or takes away: £100. */
export const PRICE_STEP_MINOR = 10_000;

/**
 * The largest stage price the calculator works out: £10,000,000. A sanity bound for an example,
 * well inside exact integer arithmetic (× 10,000 basis points stays under 2^53).
 */
export const PRICE_MAX_MINOR = 1_000_000_000;

/** The quick picks under the field: £500, £2,000 and £5,000 (§2.1 note 22). */
export const QUICK_PICKS_MINOR: readonly number[] = [50_000, 200_000, 500_000];
// #endregion

// #region Arithmetic
/** One stage's money: what the client pays, the platform fee, and what the team receives. */
export interface StageSplit {
	/** The stage price — what the client pays, with nothing on top (C2). */
	priceMinor: number;
	/** The platform fee, truncated to the penny like SQL (C1, C6). */
	feeMinor: number;
	/** What the team receives: the price minus the fee (C3, C4). */
	netMinor: number;
}

/**
 * The split of one stage at `feeBp` basis points: `fee = floor(price × bp / 10000)` (SQL's integer
 * division, `00001200:743`), `net = price − fee` (`:744`, with no deadline bonus).
 */
export function splitStage(priceMinor: number, feeBp: number): StageSplit {
	const feeMinor = platformFeeFor(priceMinor, feeBp);
	return { priceMinor, feeMinor, netMinor: priceMinor - feeMinor };
}

/** The price after one stepper press, held between nothing and {@link PRICE_MAX_MINOR}. */
export function stepPrice(priceMinor: number | null, direction: 1 | -1): number {
	const next = (priceMinor ?? 0) + direction * PRICE_STEP_MINOR;
	return Math.min(PRICE_MAX_MINOR, Math.max(0, next));
}
// #endregion

// #region Parsing
/** What the field holds: nothing yet, something that is not a price, or a price in pence. */
export type PriceInput =
	| { kind: "empty" }
	| { kind: "invalid" }
	| { kind: "ok"; minor: number };

/**
 * Whole pounds — plain (`2000`) or grouped in threes (`2,000`) — with up to two decimal places
 * (`2000.5`, `2000.50`); a trailing point is allowed while typing, and pence alone (`.50`) too.
 */
const PRICE_PATTERN = /^(?:(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/;

/**
 * The field's text as a price in pence. A leading "£" and any spaces are ignored. A negative, a
 * letter, a third decimal place, misplaced grouping or anything over {@link PRICE_MAX_MINOR} is
 * `invalid`; whitespace alone is `empty`. String arithmetic only, so `2000.10` is exactly 200010.
 */
export function parseStagePrice(text: string): PriceInput {
	const compact = text.replace(/\s+/g, "").replace(/^£/, "");
	if (compact === "") return { kind: "empty" };
	const match = PRICE_PATTERN.exec(compact);
	if (!match) return { kind: "invalid" };
	const whole = (match[1] ?? "0").replace(/,/g, "").replace(/^0+(?=\d)/, "");
	if (whole.length > String(PRICE_MAX_MINOR / 100).length) return { kind: "invalid" };
	const pence = (match[2] ?? match[3] ?? "").padEnd(2, "0");
	const minor = Number(whole) * 100 + Number(pence);
	if (!Number.isSafeInteger(minor) || minor > PRICE_MAX_MINOR) return { kind: "invalid" };
	return { kind: "ok", minor };
}
// #endregion

// #region Formatting
/** Whole units grouped in threes, en-GB (`2000000` → `2,000,000`), independent of the runtime's ICU. */
function grouped(units: number): string {
	return String(units).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Pence as two digits. */
function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

/** A calculator figure: pounds and pence, always two places (`£2,000.00`, `£0.52`). */
export function formatPounds(minor: number): string {
	const abs = Math.abs(Math.trunc(minor));
	return `£${grouped(Math.floor(abs / 100))}.${pad2(abs % 100)}`;
}

/**
 * A figure in a sentence: whole pounds without pence (`£2,000`), pounds and pence when there are
 * some (`£9.98`), and pence alone under a pound (`52p`).
 */
export function formatPoundsShort(minor: number): string {
	const abs = Math.abs(Math.trunc(minor));
	if (abs < 100) return `${abs}p`;
	const pence = abs % 100;
	const pounds = `£${grouped(Math.floor(abs / 100))}`;
	return pence === 0 ? pounds : `${pounds}.${pad2(pence)}`;
}

/** A price as the field shows it: grouped, pence only when there are some (`2,000`, `2,000.50`). */
export function formatPriceInput(minor: number): string {
	const pence = minor % 100;
	const pounds = grouped(Math.floor(minor / 100));
	return pence === 0 ? pounds : `${pounds}.${pad2(pence)}`;
}
// #endregion

// #region Copy
/**
 * The section's words (§4.9; rows C1–C5). `fee` is the platform fee as formatted on the server from
 * `platform_fee_bp` ("5%"); "flat" never appears (#281 flag j). With no fee every fee clause drops:
 * the heading keeps only its second sentence, and both examples are omitted.
 */
export const PRICING_COPY = {
	eyebrow: "Pricing",
	/** The h2's two sentences — C1, then C2. */
	headingFee: (fee: string) => `A ${fee} fee.`,
	headingPrice: "You pay the price you see.",
	/** C3 · C2 · C7. */
	body: [
		"The fee comes out of the team's payment when it's paid out.",
		"You pay the stage price, with nothing on top.",
		"There's no fee on refunds.",
	],
	/** C4: "On a £2,000 stage you pay £2,000. The team receives £1,900 after the 5% fee." */
	workedExample: (fee: string, feeBp: number) => {
		const s = splitStage(DEFAULT_PRICE_MINOR, feeBp);
		const price = formatPoundsShort(s.priceMinor);
		return `On a ${price} stage you pay ${price}. The team receives ${
			formatPoundsShort(s.netMinor)
		} after the ${fee} fee.`;
	},
	/** C5: "On a £10.50 stage, the fee is 52p and the team receives £9.98." */
	roundingExample: (feeBp: number) => {
		const s = splitStage(1050, feeBp);
		return `On a ${formatPoundsShort(s.priceMinor)} stage, the fee is ${
			formatPoundsShort(s.feeMinor)
		} and the team receives ${formatPoundsShort(s.netMinor)}.`;
	},
	/**
	 * The calculator's notes: E1 · C6 · N9, then P9 — the panel is an example (the wireframes' "Example
	 * only"): its figures are exact for a stage paid as one payment at the standard rate, while the
	 * database takes the fee once per ticket's escrow at the payer's own rate.
	 */
	notes: [
		"Clears in 7 days, then they can withdraw it.",
		"We round the fee down to the nearest penny.",
		"Paying a team? The team's vault share comes off, then the rest splits into each member's share.",
		"Example only.",
	],
} as const;

/** The calculator's own words (§4.9): its field, rows, states and live region. */
export const CALCULATOR_COPY = {
	label: "Stage price",
	prefix: "£",
	hint: "Type what one stage costs.",
	picks: "Try:",
	stepDown: `Take ${formatPoundsShort(PRICE_STEP_MINOR)} off the stage price`,
	stepUp: `Add ${formatPoundsShort(PRICE_STEP_MINOR)} to the stage price`,
	youPay: "You pay",
	fromTeam: "From the team's payment:",
	feeRow: (fee: string) => `Projective fee (${fee})`,
	teamReceives: "The team receives",
	empty: "Type a stage price to see who gets what.",
	invalid: "Use numbers only, like 2000 or 2000.50.",
	/** The polite live region: "You pay £2,000. The team receives £1,900." */
	live: (split: StageSplit) =>
		`You pay ${formatPoundsShort(split.priceMinor)}. The team receives ${
			formatPoundsShort(split.netMinor)
		}.`,
} as const;

/**
 * What the calculator's polite live region says once the field rests: the two figures for a price,
 * the invalid message, or the empty prompt — the same words the panel shows, so a screen reader
 * hears every state a sighted visitor sees.
 */
export function calculatorAnnouncement(input: PriceInput, feeBp: number): string {
	if (input.kind === "ok") return CALCULATOR_COPY.live(splitStage(input.minor, feeBp));
	return input.kind === "invalid" ? CALCULATOR_COPY.invalid : CALCULATOR_COPY.empty;
}
// #endregion

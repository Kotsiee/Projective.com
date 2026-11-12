import type { ProjectStage } from "@projective/types/explore";
import { toMinorUnits } from "@projective/types/finance";

/**
 * conversion-ledger — the live line items and total a `/view` conversion dialog's offer column shows
 * (Decision #424). Pure: every dialog derives its column from the buyer's current selection through
 * one of these, so the figure the dialog states is computed once, the same way the page's own stage
 * ledger scales it (`toMinorUnits` against the listing's currency).
 *
 * A total is stated only where the listing's own price determines it. A block of sessions is quoted
 * per session and its total is left to checkout, because no rule here knows how a block is priced —
 * a figure the dialog invented would be an offer that can disagree with the one the buyer pays.
 */

// #region Shapes
/** A structured amount in minor units. */
export interface LedgerAmount {
	minor: number;
	currency: string;
}

/** The listing's headline price, as the page resolves it (`headlinePriceFor`). */
export interface LedgerPrice {
	amount: LedgerAmount | null;
	fallback: string;
	unit?: string;
	isFloor: boolean;
}

/** One line of the offer column: a label, and either an amount or a plain fact. */
export interface LedgerLine {
	key: string;
	label: string;
	amount?: LedgerAmount;
	/** A range's floor — the line reads "from". */
	isFloor?: boolean;
	text?: string;
}

/** The figure the column ends on. */
export interface LedgerTotal {
	label: string;
	amount: LedgerAmount;
	isFloor: boolean;
}

/** What the offer column renders. */
export interface ConversionLedger {
	lines: readonly LedgerLine[];
	total: LedgerTotal | null;
	/** Said under the total when there is none, or when the figure is only a floor. */
	note: string | null;
}
// #endregion

// #region Ledgers
/** The stages the buyer is funding now, each at its floor, summed. */
export function stageLedger(funded: readonly ProjectStage[], currency: string): ConversionLedger {
	const lines = funded.map((stage): LedgerLine => ({
		key: stage.id,
		label: `${stage.index}. ${stage.name}`,
		amount: { minor: toMinorUnits(stage.price.min, currency) ?? 0, currency },
		isFloor: stage.price.max > stage.price.min,
	}));
	if (lines.length === 0) return { lines, total: null, note: null };
	const isFloor = lines.some((line) => line.isFloor);
	return {
		lines,
		total: {
			label: funded.length === 1 ? "Due now" : `Due now · ${funded.length} stages`,
			amount: { minor: lines.reduce((sum, line) => sum + (line.amount?.minor ?? 0), 0), currency },
			isFloor,
		},
		note: isFloor ? "A ranged stage is priced within its range when the work is scoped." : null,
	};
}

/** One fixed-scope deliverable at the listing's headline price. */
export function flatLedger(price: LedgerPrice, label: string): ConversionLedger {
	return {
		lines: [{
			key: "deliverable",
			label,
			...(price.amount
				? { amount: price.amount, isFloor: price.isFloor }
				: { text: price.fallback }),
		}],
		total: price.amount ? { label: "Due now", amount: price.amount, isFloor: price.isFloor } : null,
		note: price.amount ? null : "The provider confirms the price before you pay.",
	};
}

/**
 * The sessions the buyer has picked, by label, and the price. A single session totals at its own price;
 * a block states its per-session figure and leaves the total to checkout.
 */
export function sessionLedger(
	price: LedgerPrice,
	picked: readonly string[],
	sessionCount: number,
): ConversionLedger {
	const lines: LedgerLine[] = picked.length > 0
		? picked.map((when, i) => ({
			key: `pick-${i}`,
			label: sessionCount > 1 ? `Session ${i + 1}` : "Session",
			text: when,
		}))
		: [{ key: "pick-none", label: "Session", text: "No time picked yet" }];
	if (sessionCount > 1 && picked.length < sessionCount) {
		const later = sessionCount - picked.length;
		lines.push({
			key: "later",
			label: later === 1 ? "1 more session" : `${later} more sessions`,
			text: "Booked later",
		});
	}
	if (!price.amount) {
		return { lines, total: null, note: "The provider confirms the price before you pay." };
	}
	if (sessionCount > 1) {
		lines.push({ key: "rate", label: "Per session", amount: price.amount, isFloor: price.isFloor });
		return { lines, total: null, note: "The block's total is confirmed at checkout." };
	}
	return {
		lines,
		total: { label: "Due now", amount: price.amount, isFloor: price.isFloor },
		note: null,
	};
}

/** A discovery call: its kind and length, the picked time, and the fee only where one is set. */
export function callLedger(
	kind: "courtesy" | "paid",
	minutes: number,
	picked: string | null,
	fee: LedgerAmount | null,
): ConversionLedger {
	const lines: LedgerLine[] = [
		{ key: "call", label: kind === "paid" ? "Paid consult" : "Free intro", text: `${minutes} min` },
		{ key: "when", label: "Time", text: picked ?? "No time picked yet" },
	];
	if (kind === "courtesy") return { lines, total: null, note: "An intro call is free." };
	if (!fee) {
		return { lines, total: null, note: "The consult fee is confirmed when the provider accepts." };
	}
	return { lines, total: { label: "Due on acceptance", amount: fee, isFloor: false }, note: null };
}

/** Seats on a cohort at the listing's per-seat price. */
export function seatLedger(
	price: LedgerPrice,
	seats: number,
	sittings: string | null,
): ConversionLedger {
	const lines: LedgerLine[] = [];
	if (sittings) lines.push({ key: "sittings", label: "Cohort", text: sittings });
	lines.push({ key: "seats", label: "Seats", text: `× ${seats}` });
	if (!price.amount) {
		return { lines, total: null, note: "The provider confirms the price before you pay." };
	}
	const perSeat = price.unit === "seat";
	if (perSeat) {
		lines.push({ key: "rate", label: "Per seat", amount: price.amount, isFloor: price.isFloor });
	}
	return {
		lines,
		total: {
			label: "Due now",
			amount: {
				minor: price.amount.minor * (perSeat ? seats : 1),
				currency: price.amount.currency,
			},
			isFloor: price.isFloor,
		},
		note: null,
	};
}
// #endregion

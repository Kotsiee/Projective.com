import type { FundState, MoneyView, WalletOverview } from "../types/wallet-types.ts";

/**
 * hero-model — the pure maths behind the four-state capital meter (BUILD CONTRACT §4.2).
 *
 * Everything here is a DISPLAY RATIO over money the server already summed and formatted: `share` is
 * `minor / capital.minor`, which RULE D-1 explicitly permits. No balance, total, fee or currency
 * string is ever computed here — `capital` arrives from the server precisely so this module never
 * has to add money up.
 */

// #region Shares
/** One segment of the capital meter: a fund state, its money, and its honest share of the whole. */
export interface CapitalShare {
	state: FundState;
	money: MoneyView;
	/** `0`–`100`, the honest percentage. There is NO minimum (RULE H-2) — slivers get a pip instead. */
	share: number;
	/** Below `SLIVER_PCT`, so the segment is too thin to hover and needs an overhanging pip. */
	isSliver: boolean;
	isZero: boolean;
	/** Vertical offset in px for a pip, so adjacent pips never collide. Resolved in JS, not CSS. */
	pipLift: 0 | 10 | 20;
	/** The label the legend cell announces. */
	label: string;
	/** The `?fundState=` value the legend cell filters the ledger by. */
	filter: FundState;
}

/** Mirrors `--wlt-sliver`: below this share a segment cannot be a usable hover target. */
export const SLIVER_PCT = 1.75;

/** The rail order — settled money first, contested money last. Never re-ordered by magnitude. */
const ORDER: readonly { state: FundState; label: string }[] = [
	{ state: "available", label: "Available" },
	{ state: "locked", label: "In escrow" },
	{ state: "pending", label: "Pending" },
	{ state: "on_hold", label: "On hold" },
];

/**
 * The four shares, in rail order, with slivers flagged and pip collisions resolved.
 *
 * When `capital.minor` is `0` (a brand-new wallet) every share is `0` and every segment is `isZero`
 * — the rail still renders its rhythm, because a wallet with no money is exactly when the user is
 * learning the instrument's shape (RULE H-4 / §9 Empty).
 */
export function capitalShares(o: WalletOverview): CapitalShare[] {
	const total = o.capital.minor;
	const money: Record<FundState, MoneyView> = {
		available: o.available,
		locked: o.locked,
		pending: o.pending,
		on_hold: o.onHold,
	};

	const shares = ORDER.map(({ state, label }) => {
		const m = money[state];
		const share = total > 0 ? (m.minor / total) * 100 : 0;
		return {
			state,
			money: m,
			share,
			isSliver: share > 0 && share < SLIVER_PCT,
			isZero: m.minor === 0,
			pipLift: 0 as 0 | 10 | 20,
			label,
			filter: state,
		};
	});
	return resolvePipLifts(shares);
}

/**
 * Lift adjacent pips so their labels cannot overlap.
 *
 * This is deliberately JS, not a CSS `nth-of-type` stagger: whether two pips collide depends on
 * which segments happen to be slivers in THIS wallet, which no static selector can know. Three tiers
 * are enough — four adjacent slivers would mean a wallet whose capital is ~0, which is the zero
 * state, where no pips render at all.
 */
export function resolvePipLifts(shares: CapitalShare[]): CapitalShare[] {
	let run = 0;
	return shares.map((s) => {
		if (!s.isSliver) {
			run = 0;
			return s;
		}
		const lift = (run % 3) * 10 as 0 | 10 | 20;
		run++;
		return { ...s, pipLift: lift };
	});
}
// #endregion

// #region Cross-currency
/**
 * Whether ANY headline figure carries a pre-conversion origin. Drives the hero legend's 4-up → 2×2
 * reflow (RULE H-5): an inline FX line needs roughly twice the cell width, and hover-only disclosure
 * fails touch entirely.
 */
export function hasConvertedMoney(o: WalletOverview): boolean {
	return [o.available, o.locked, o.pending, o.onHold, o.capital, o.lifetime]
		.some((m) => m.origin !== null);
}

/** The inline FX disclosure: origin amount, then the rate. NEVER a fee, spread, or saving (§12.7). */
export function fxNote(m: MoneyView): string | null {
	if (!m.origin) return null;
	const rate = m.origin.fxRate.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
	return `${m.origin.display} · 1 ${m.origin.currency.toUpperCase()} = ${rate} ${m.currency}`;
}
// #endregion

// #region Legend notes
/**
 * The one-line note under each legend figure. Each traces to a named server field — where the field
 * is absent or zero the note is OMITTED rather than filled with a plausible sentence (§12.5).
 */
export function legendNote(share: CapitalShare, o: WalletOverview): string | null {
	if (share.isZero) return null;
	switch (share.state) {
		case "available":
			return o.verification.canWithdraw ? "Ready to withdraw" : "Withdrawal locked";
		case "locked": {
			const n = o.lockedStageCount;
			return n > 0 ? `Working on ${n} ${n === 1 ? "stage" : "stages"}` : null;
		}
		case "pending": {
			const item = o.incoming.find((i) => i.kind === "pending_release");
			return item ? item.clearingLabel : null;
		}
		case "on_hold": {
			const n = o.heldCaseCount;
			return n > 0 ? `${n} ${n === 1 ? "case" : "cases"} in review` : null;
		}
	}
}

/** The elapsed fraction of the 7-day window for the Pending mark's ring; `0` when nothing is clearing. */
export function pendingFraction(o: WalletOverview): number {
	return o.incoming.find((i) => i.kind === "pending_release")?.clearingFraction ?? 0;
}
// #endregion

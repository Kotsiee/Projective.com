import type { CategorySlice, MoneyView, ProjectFlow, TxnCategory } from "../types/wallet-types.ts";
import { finiteOr } from "./flow-chart.ts";

/**
 * category-chart — the by-category and by-project spend geometry (BUILD CONTRACT §6.2).
 *
 * Both are a **horizontal bar list**, never a donut. A marketplace answers "how much" before "what
 * shape": a donut forces every figure through an angle the eye cannot compare, hides the long tail
 * behind a legend, and is the single most recognisable neobank tell on a finance surface. A bar list
 * prints the amount and the share as text on the row, orders them by size, and uses the bar as the
 * comparative instrument rather than the only channel — which is also the only form that survives
 * `data-cvd`, `data-contrast="high"` and a screen reader intact.
 *
 * The bar is scaled by the ABSOLUTE share, not relative to the largest row: a track that always ends
 * full would say every category is the whole of something. Rows are ordered descending, and the
 * printed percentage is the fact — the bar is the impression.
 *
 * Pure and SSR-safe. Share is a display RATIO (`minor / Σ minor`), which RULE D-1 permits; nothing
 * here composes a currency string, a total, or a fee.
 */

// #region Row model
/** One row of a horizontal bar list. */
export interface BarRow {
	/** Stable key for the row — the category code or the project id. */
	key: string;
	/** The printed row label. */
	label: string;
	/** The server-formatted amount; rendered by `Money`, never re-composed. */
	amount: MoneyView;
	/** Share of the list's total, `0`–`1`. */
	share: number;
	/** The share printed to one decimal, e.g. `"26.8%"` — also the value written to `--wlt-fill`. */
	sharePct: string;
	/** Bar length in the caller's coordinate space, for an SVG rendering. */
	width: number;
	/** Row offset and height in the caller's coordinate space, for an SVG rendering. */
	y: number;
	height: number;
	/** Where the row navigates, or `null` when the row is not a link. */
	href: string | null;
}

/**
 * Category display labels. The wire values are lowercase codes; a code is not a label, and inferring
 * one by capitalising the code would produce "Withdrawal" where the surface says "Withdrawals".
 */
const CATEGORY_LABEL: Record<TxnCategory, string> = {
	earning: "Earnings",
	payout: "Payouts",
	deposit: "Deposits",
	withdrawal: "Withdrawals",
	fee: "Fees",
	refund: "Refunds",
	escrow: "Escrow",
	transfer: "Transfers",
	spend: "Spend",
};

/** Format a `0`–`1` ratio as a one-decimal percentage. Locale-neutral, so SSR and client agree. */
function pct(share: number): string {
	return `${(finiteOr(share) * 100).toFixed(1)}%`;
}

/** Clamp a ratio into `0`–`1`; a share outside that range is a transport error, not a wide bar. */
function clampShare(share: number): number {
	return Math.min(1, Math.max(0, finiteOr(share)));
}

/** Lay out sorted rows into the caller's coordinate space. */
function layout(
	rows: readonly Omit<BarRow, "width" | "y" | "height" | "sharePct">[],
	width: number,
	height: number,
): BarRow[] {
	const w = Math.max(0, finiteOr(width));
	const h = Math.max(0, finiteOr(height));
	const rowHeight = rows.length > 0 ? h / rows.length : 0;
	return rows.map((row, i) => ({
		...row,
		sharePct: pct(row.share),
		width: row.share * w,
		y: i * rowHeight,
		height: rowHeight,
	}));
}
// #endregion

// #region Builders
/**
 * Build the by-category bar list.
 *
 * The share comes from the server's `shareBp`, not from a client-side division: the backend already
 * decided what the denominator is (spend, not gross throughput), and re-deriving it here would let
 * the printed percentage disagree with the same figure elsewhere on the surface.
 */
export function buildCategoryBars(
	rows: readonly CategorySlice[],
	width: number,
	height: number,
): BarRow[] {
	const sorted = rows
		.map((row) => ({
			key: row.category,
			label: CATEGORY_LABEL[row.category] ?? row.category,
			amount: row.amount,
			share: clampShare(finiteOr(row.shareBp) / 10_000),
			href: null,
		}))
		.sort((a, b) => b.share - a.share || finiteOr(b.amount.minor) - finiteOr(a.amount.minor));
	return layout(sorted, width, height);
}

/**
 * Build the by-project bar list. Each row links into the project that produced the spend.
 *
 * `ProjectFlow` carries no share, so it is derived as `minor / Σ minor` — a display ratio, explicitly
 * legal under RULE D-1, and the only arithmetic in this module. A zero total yields zero-share rows
 * rather than a divide-by-zero.
 */
export function buildProjectBars(
	rows: readonly ProjectFlow[],
	width: number,
	height: number,
): BarRow[] {
	const total = rows.reduce((sum, row) => sum + Math.abs(finiteOr(row.amount.minor)), 0);
	const sorted = rows
		.map((row) => {
			const minor = Math.abs(finiteOr(row.amount.minor));
			return {
				key: row.id,
				label: row.name,
				amount: row.amount,
				share: total > 0 ? clampShare(minor / total) : 0,
				href: `/projects/${row.id}`,
			};
		})
		.sort((a, b) => b.share - a.share || a.label.localeCompare(b.label));
	return layout(sorted, width, height);
}
// #endregion

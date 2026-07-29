import type { LedgerLine, TxnCategory, TxnSort } from "../types/wallet-types.ts";

/**
 * ledger-model — the ledger's column contract and its vocabulary. Pure and SSR-safe.
 */

// #region Columns
export interface ColumnDef {
	key: TxnSort | "state" | "ref";
	label: string;
	/** Default width in px; the table persists user resizes over this. */
	width: number;
	min: number;
	max: number;
	align: "start" | "end";
	sortable: boolean;
}

/**
 * The ledger's columns. Amount sits at the inline-end because a column of figures is read down its
 * right edge (its END edge, which mirrors correctly under RtL), and date leads because the ledger's
 * primary order is chronological.
 */
export const LEDGER_COLUMNS: readonly ColumnDef[] = [
	{ key: "date", label: "Date", width: 128, min: 96, max: 200, align: "start", sortable: true },
	{
		key: "counterparty",
		label: "Description",
		width: 420,
		min: 220,
		max: 720,
		align: "start",
		sortable: true,
	},
	{
		key: "category",
		label: "Category",
		width: 148,
		min: 110,
		max: 240,
		align: "start",
		sortable: true,
	},
	{ key: "state", label: "State", width: 84, min: 64, max: 140, align: "start", sortable: false },
	{ key: "amount", label: "Amount", width: 168, min: 120, max: 280, align: "end", sortable: true },
];
// #endregion

// #region Vocabulary
const REASON_LABEL: Record<string, string> = {
	escrow_hold: "Escrow hold",
	escrow_release: "Escrow release",
	escrow_refund: "Escrow refund",
	fair_exit_release: "Fair-exit release",
	fair_exit_refund: "Fair-exit refund",
	team_split: "Team split",
	platform_fee: "Platform fee",
	payout: "Payout",
	deposit: "Deposit",
	transfer: "Transfer",
	refund: "Refund",
	chargeback: "Chargeback",
};

/** A reason code as a human phrase. An unknown code is de-snaked rather than shown raw. */
export function reasonLabel(reason: string): string {
	return REASON_LABEL[reason] ??
		reason.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

const CATEGORY_LABEL: Record<TxnCategory, string> = {
	earning: "Earning",
	payout: "Payout",
	deposit: "Deposit",
	withdrawal: "Withdrawal",
	fee: "Fee",
	refund: "Refund",
	escrow: "Escrow",
	transfer: "Transfer",
	spend: "Spend",
};

export function categoryLabel(category: TxnCategory): string {
	return CATEGORY_LABEL[category] ?? category;
}

/**
 * Whether a reason is a genuine DISPUTE. Only these two earn the danger tone, and only on a chip —
 * never on the amount itself. Money a user is still owed is never rendered red.
 */
export function isDisputeReason(reason: string): boolean {
	return reason === "chargeback" || reason === "dispute";
}

/** The label for a line's reference link, or `null` when the line has no destination. */
export function refLabel(line: LedgerLine): string | null {
	if (!line.href || !line.refKind) return null;
	switch (line.refKind) {
		case "stage":
			return "Open stage";
		case "session":
			return "Open session";
		case "invoice":
			return "Open invoice";
		case "payout":
			return "Payout run";
		case "deposit":
			return "Deposit";
		case "transfer":
			return "Transfer";
		case "fee":
			return "Fee detail";
	}
}
// #endregion

// #region Grouping
export interface LedgerGroup {
	key: string;
	label: string;
	lines: LedgerLine[];
}

/**
 * Group consecutive lines by their server-supplied `dateLabel`. Grouping on the LABEL rather than
 * re-deriving a day from `at` keeps the client out of timezone arithmetic entirely — the server has
 * already decided what "Yesterday" means for this viewer.
 */
export function groupByDay(lines: readonly LedgerLine[]): LedgerGroup[] {
	const groups: LedgerGroup[] = [];
	for (const line of lines) {
		const last = groups[groups.length - 1];
		if (last && last.label === line.dateLabel) {
			last.lines.push(line);
		} else {
			groups.push({ key: `${line.dateLabel}-${line.id}`, label: line.dateLabel, lines: [line] });
		}
	}
	return groups;
}
// #endregion

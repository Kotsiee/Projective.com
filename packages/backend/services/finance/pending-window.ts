/**
 * pending-window — how the wallet reads `finance.pending_releases` (finance-model.md §7, Decision #191).
 *
 * Earned money (an escrow release and each team share of one, a fair-exit or seat payout, a product
 * sale) clears a safety window before it is Available. Its row's `amount_cents` is what was earned;
 * a lost chargeback can take part of it back first (`recovered_cents`). Pending is what is LEFT.
 */

// #region Pending rows
/** A `finance.pending_releases` row as the wallet uses it, normalised to the amount still clearing. */
export interface PendingRow {
	id: string;
	escrow_id: string | null;
	order_id: string | null;
	wallet_id: string;
	amount_cents: number;
	currency: string;
	released_at: string;
	available_at: string;
}

/** The raw PostgREST shape of a `pending_releases` row: bigint columns may arrive as strings. */
export interface PendingRowRaw extends Omit<PendingRow, "amount_cents"> {
	amount_cents: number | string;
	recovered_cents: number | string | null;
}

/** The PostgREST column list that reads a {@link PendingRowRaw}. */
export const PENDING_ROW_COLUMNS =
	"id, escrow_id, order_id, wallet_id, amount_cents, recovered_cents, currency, released_at, available_at";

/**
 * Normalises raw rows to what each still holds in the window (`amount − recovered`), dropping rows a
 * chargeback emptied, so Pending never counts money that was taken back.
 */
export function stillClearing(rows: readonly PendingRowRaw[]): PendingRow[] {
	const out: PendingRow[] = [];
	for (const { recovered_cents, ...row } of rows) {
		const amount = Math.max(0, Number(row.amount_cents) || 0);
		const recovered = Math.min(amount, Math.max(0, Number(recovered_cents) || 0));
		if (amount - recovered > 0) out.push({ ...row, amount_cents: amount - recovered });
	}
	return out;
}

/** The label of a clearing row that links to no stage: a product sale or an escrow release. */
export function clearingKindLabel(row: Pick<PendingRow, "order_id">): string {
	return row.order_id ? "Sale clearing" : "Release clearing";
}
// #endregion

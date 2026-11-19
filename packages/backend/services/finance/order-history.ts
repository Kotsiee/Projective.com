/**
 * order-history — the keyset half of the buyer's order history (`/checkout/orders`, MARKETPLACE CK3).
 *
 * Pure: it builds the page window over any query builder shaped like PostgREST's, so the live reader in
 * `live-orders` and a unit test drive the same code.
 */

// #region Types
/** The order a page boundary stands on: its placement instant, verbatim from the database, and its id. */
export interface OrderCursor {
	placedAt: string;
	id: string;
}

/** Which way a page reads from its cursor: `older` lists what came before it, `newer` what came after. */
export type PageDirection = "older" | "newer";

/** One page request. `cursor: null` is the newest page. */
export interface HistoryRequest {
	cursor: OrderCursor | null;
	direction: PageDirection;
	limit: number;
}

/** The query surface the reader needs: PostgREST's builder, or a fake in a test. */
export interface KeysetQuery<T> {
	or(filter: string): KeysetQuery<T>;
	order(column: string, options: { ascending: boolean }): KeysetQuery<T>;
	limit(count: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

/** A window of orders, newest first, and the cursors of the windows either side (`null` at an end). */
export interface HistoryWindow<T> {
	rows: T[];
	older: string | null;
	newer: string | null;
}
// #endregion

// #region Cursor
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A timestamptz as PostgREST prints it, microseconds and offset included. Nothing else is accepted. */
const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

function toBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
	if (!/^[A-Za-z0-9_-]{1,200}$/.test(text)) return null;
	try {
		const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
		const binary = atob(padded);
		return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
	} catch {
		return null;
	}
}

/**
 * The opaque token a page boundary travels as in `?after=` / `?before=`. The placement instant is kept
 * exactly as the database printed it: a millisecond round trip through `Date` would drop the
 * microseconds, and a boundary that no longer equals its own row skips or repeats it.
 */
export function encodeOrderCursor(cursor: OrderCursor): string {
	return toBase64Url(`${cursor.placedAt}|${cursor.id}`);
}

/** A token back into its boundary, or `null` for anything this module did not write. */
export function decodeOrderCursor(raw: string | null | undefined): OrderCursor | null {
	if (!raw) return null;
	const text = fromBase64Url(raw);
	if (!text) return null;
	const bar = text.lastIndexOf("|");
	if (bar === -1) return null;
	const placedAt = text.slice(0, bar);
	const id = text.slice(bar + 1);
	return INSTANT.test(placedAt) && UUID.test(id) ? { placedAt, id: id.toLowerCase() } : null;
}
// #endregion

// #region Keyset
/** The most orders one page lists. */
export const HISTORY_PAGE_MAX = 50;

/**
 * The PostgREST filter for the rows strictly past a boundary on `(placed_at, id)`: older ones (`lt`) or
 * newer ones (`gt`). The instant is quoted because it carries `:` and `.`, which PostgREST reads as
 * syntax; {@link decodeOrderCursor} has already refused anything that is not an instant and a uuid.
 */
export function keysetFilter(cursor: OrderCursor, direction: PageDirection): string {
	const op = direction === "older" ? "lt" : "gt";
	return `placed_at.${op}."${cursor.placedAt}",and(placed_at.eq."${cursor.placedAt}",id.${op}.${cursor.id})`;
}

function boundaryOf(row: { placed_at: string; id: string }): string {
	return encodeOrderCursor({ placedAt: row.placed_at, id: row.id });
}
// #endregion

// #region Reader
/**
 * One page of an account's orders, newest first, keyset-paged on `(placed_at, id)` and never by offset:
 * a page is "the `limit` orders past this boundary", so an order placed while the buyer reads cannot
 * shift a later page by one and repeat or skip a row. One extra row is read to know whether the window
 * has a neighbour beyond it. `query` must already be scoped to the account (the owner filter, under the
 * caller's JWT).
 *
 * `older` names the boundary of the next page back (`null` on the last); `newer` the boundary of the
 * page before this one (`null` on the newest). A `newer` page that finds nothing past its boundary is
 * read again as the newest page, so a stale link lands on a full page rather than an empty one.
 */
export async function readHistoryRows<T extends { placed_at: string; id: string }>(
	query: KeysetQuery<T>,
	request: HistoryRequest,
	reread?: () => KeysetQuery<T>,
): Promise<HistoryWindow<T>> {
	const limit = Math.min(Math.max(Math.trunc(request.limit) || 1, 1), HISTORY_PAGE_MAX);
	const cursor = request.cursor;
	const ascending = cursor !== null && request.direction === "newer";
	const scoped = cursor ? query.or(keysetFilter(cursor, request.direction)) : query;
	const { data, error } = await scoped.order("placed_at", { ascending }).order("id", { ascending })
		.limit(limit + 1);
	if (error) throw new Error(`finance.orders read failed: ${error.message}`);
	const fetched = data ?? [];
	const more = fetched.length > limit;
	const page = fetched.slice(0, limit);

	if (!cursor) {
		return { rows: page, older: more ? boundaryOf(page[page.length - 1]) : null, newer: null };
	}
	if (request.direction === "older") {
		return {
			rows: page,
			older: more ? boundaryOf(page[page.length - 1]) : null,
			newer: page.length > 0 ? boundaryOf(page[0]) : null,
		};
	}
	if (page.length === 0 && reread) {
		return await readHistoryRows(reread(), { cursor: null, direction: "older", limit });
	}
	const rows = page.reverse();
	return {
		rows,
		older: rows.length > 0 ? boundaryOf(rows[rows.length - 1]) : null,
		newer: more && rows.length > 0 ? boundaryOf(rows[0]) : null,
	};
}
// #endregion

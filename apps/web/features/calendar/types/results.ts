/**
 * The calendar feature's client transport envelope — the soft `{ ok, message, errors, data }` shape the
 * thin `/api/scheduling/*` routes return and the islands consume (mirrors the projects/explore feature
 * `results.ts`). Never throws across the boundary; a failure degrades to `{ ok: false, message }`.
 */
export interface CalendarResult<T> {
	ok: boolean;
	message?: string;
	errors?: Record<string, string>;
	data?: T;
}

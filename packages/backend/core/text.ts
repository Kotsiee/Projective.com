/**
 * text — the string bounds every live projection applies before a database value reaches a Zod schema.
 *
 * A column is usually unbounded `text` while the schema it projects into carries a `max`, so a value
 * that is fine in Postgres can fail the parse and take a whole page down with it. Clamping at the
 * projection costs the tail of one pathological value instead.
 */

/** `value` cut to at most `max` characters; `""` for an absent value. */
export function clamp(value: string | null | undefined, max: number): string {
	if (!value) return "";
	return value.length <= max ? value : value.slice(0, max);
}

/** Clamp, falling back to `fallback` when the result would be empty — for `min(1)` fields. */
export function clampOr(value: string | null | undefined, max: number, fallback: string): string {
	const out = clamp(value, max).trim();
	return out.length > 0 ? out : fallback;
}

/**
 * Whether a write's error code says its INPUT held text no layer below can store: `22P05` (Postgres
 * refuses a NUL in text or jsonb) or `PGRST102` (PostgREST cannot read the body, e.g. a lone UTF-16
 * surrogate). The request schemas refuse such text first (`isStorableText`, `@projective/types/
 * content/text`); a service that still meets one answers 422 — malformed input — never 503.
 */
export function isUnstorableInputError(code: string | null | undefined): boolean {
	return code === "22P05" || code === "PGRST102";
}

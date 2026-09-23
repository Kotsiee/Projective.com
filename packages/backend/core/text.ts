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

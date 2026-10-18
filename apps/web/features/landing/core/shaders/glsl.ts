/**
 * glsl.ts — the tag the landing's shaders are written with (`flows/LANDING.md` §3.6; Decision #280:
 * raw WebGL2, no dependency).
 *
 * It joins the template exactly as written, so a shader reads as GLSL in the source and editors
 * that key syntax highlighting on the tag name pick it up. Interpolations splice shared chunks and
 * constants (the zone count, the quiet-zone function) into each program.
 */

/** Tag a GLSL ES 3.00 source string; interpolated values are inserted verbatim. */
export function glsl(strings: TemplateStringsArray, ...values: (string | number)[]): string {
	return String.raw(strings, ...values);
}

/** A number as a GLSL float literal (`4` → `4.0`), for splicing constants into float expressions. */
export function float(value: number): string {
	return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

import type { CSSProperties } from "preact";

/**
 * Merge a map of CSS custom-property references with an optional caller-supplied style object.
 *
 * Layout primitives set only `--*` custom properties here (token references); the real declarations
 * live in the co-located BEM stylesheet. This keeps styling in CSS while allowing dynamic,
 * token-driven values — the "variable mapping" pattern (SYSTEM_ARCHITECTURE.md §3). Undefined values
 * are dropped so CSS `var(--x, fallback)` defaults apply.
 */
export function styleVars(
	vars: Record<string, string | number | undefined>,
	extra?: CSSProperties,
): CSSProperties {
	const out: Record<string, string | number> = {};
	for (const [k, v] of Object.entries(vars)) {
		if (v !== undefined) out[k] = v;
	}
	return { ...out, ...(extra ?? {}) } as CSSProperties;
}

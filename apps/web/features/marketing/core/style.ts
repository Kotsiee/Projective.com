import type { JSX } from "preact";

/**
 * Local mirror of the design-system "variable mapping" pattern (SYSTEM_ARCHITECTURE.md §3): the only
 * values set inline are `--*` custom-property references — image sources and stagger indices that
 * cannot live in a static stylesheet. Real declarations stay in `styles/landing.css`; no hex, radius,
 * duration, or shadow is ever inlined. Undefined entries are dropped so CSS `var(--x, fallback)` wins.
 */
export function vars(map: Record<string, string | number | undefined>): JSX.CSSProperties {
	const out: Record<string, string | number> = {};
	for (const [k, v] of Object.entries(map)) {
		if (v !== undefined) out[k] = v;
	}
	return out as JSX.CSSProperties;
}

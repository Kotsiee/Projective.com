import type { MarginProps, PaddingProps, Space } from "../types/mod.ts";

/**
 * Spacing helpers — map the `--space-N` scale (or a raw CSS length) to values, and resolve
 * shorthand padding/margin props into the inline custom properties the BEM stylesheets consume.
 */

/** Resolve a Space to a CSS value (`var(--space-N)`), or pass a raw string through. */
export function space(v: Space | undefined): string | undefined {
	if (v === undefined) return undefined;
	return typeof v === "number" ? `var(--space-${v})` : v;
}

/** Resolve shorthand spacing props → per-side custom properties (most-specific side wins). */
export function spacingVars(p: PaddingProps & MarginProps): Record<string, string | undefined> {
	return {
		"--box-pt": space(p.pt ?? p.py ?? p.p),
		"--box-pr": space(p.pr ?? p.px ?? p.p),
		"--box-pb": space(p.pb ?? p.py ?? p.p),
		"--box-pl": space(p.pl ?? p.px ?? p.p),
		"--box-mt": space(p.mt ?? p.my ?? p.m),
		"--box-mr": space(p.mr ?? p.mx ?? p.m),
		"--box-mb": space(p.mb ?? p.my ?? p.m),
		"--box-ml": space(p.ml ?? p.mx ?? p.m),
	};
}

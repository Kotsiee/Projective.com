/**
 * Explore — per-card accent resolver.
 *
 * The Golden Blueprint asks a card's tags to warm toward "the prominent color scheme of the card's
 * banner or thumbnail" on hover. True dominant-colour extraction needs the pixels (a client-side or
 * pipeline step the discovery API will eventually supply as a stored swatch). Until then, this maps a
 * card to one of the three expressive semantic tokens by a stable hash of its id, so every card gets a
 * consistent, theme-aware accent with visible variety across a grid — no RNG, SSR/resume-safe.
 *
 * Returns a `var(--*)` reference (never a raw colour), so it stays token-only per root CLAUDE.md §3.
 */
const ACCENT_TOKENS = [
	"var(--primary)",
	"var(--secondary, var(--primary))",
	"var(--tertiary, var(--primary))",
] as const;

/** A stable design-token reference (`var(--*)`) used as a card's hover accent, derived from `seed`. */
export function cardAccent(seed: string): string {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
	return ACCENT_TOKENS[hash % ACCENT_TOKENS.length];
}

import type { JSX } from "preact";

/**
 * BrandMark — the 1:1 Projective icon mark for the shell's leading edge (DESIGN_SYSTEM.md §C.4 —
 * icon lockup is 1:1). Token-driven (uses `--primary`/`--on-primary`) so it recolors with the theme
 * and any user seed. Links home. Zero-JS.
 */
export function BrandMark({ href = "/home" }: { href?: string }): JSX.Element {
	return (
		<a class="shell-brand" href={href} aria-label="Projective — home">
			<svg class="shell-brand__mark" viewBox="0 0 32 32" aria-hidden="true">
				<rect x="1" y="1" width="30" height="30" rx="9" fill="var(--primary)" />
				<path
					d="M11 23V9h6.2a4.4 4.4 0 0 1 0 8.8H14"
					fill="none"
					stroke="var(--on-primary)"
					stroke-width="2.6"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</a>
	);
}

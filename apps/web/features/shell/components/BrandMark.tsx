import type { JSX } from "preact";
import { Logo } from "@web/components/Logo.tsx";

/**
 * BrandMark — the Projective mark for the shell's leading edge, wrapped in the home link.
 *
 * The glyph itself lives in the shared {@link Logo} component; what this adds is the shell-specific
 * anchor, its accessible name, and the `.shell-brand` slot geometry. The mark inherits `color` from
 * that anchor (`--primary`), so it recolors with the theme and any user seed. Zero-JS.
 */
export function BrandMark({ href = "/home" }: { href?: string }): JSX.Element {
	return (
		<a class="shell-brand" href={href} aria-label="Projective — home">
			<Logo class="shell-brand__mark" />
		</a>
	);
}

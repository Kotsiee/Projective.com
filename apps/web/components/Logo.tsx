import type { JSX } from "preact";

// #region Types

/**
 * Props for {@link Logo}.
 *
 * Sizing is deliberately optional: the mark carries a `viewBox` and no intrinsic dimensions, so a
 * call site that sets neither `width` nor `height` inherits whatever the surrounding CSS gives it
 * (which is how every existing brand slot in this codebase sizes its mark). Passing only ONE of the
 * pair is also safe — an inline `<svg>` with a `viewBox` derives the other axis from the aspect
 * ratio, so the mark never distorts.
 */
export interface LogoProps {
	/** Class applied to the root `<svg>`. */
	class?: string;
	/** Alias for {@link LogoProps.class}, for parity with the `className` JSX convention. */
	className?: string;
	/**
	 * Accessible name for the mark.
	 *
	 * Leave it unset wherever the logo sits inside a control that already names itself — every brand
	 * slot in this app is an `<a aria-label="Projective — home">` — and the mark is marked
	 * `aria-hidden` instead, so assistive tech announces the destination once rather than twice.
	 */
	alt?: string;
	/** Inline width. Omit to size from CSS. */
	width?: number | string;
	/** Inline height. Omit to size from CSS. */
	height?: number | string;
}

// #endregion

/**
 * Logo — the Projective brand mark, as a single inline SVG in `currentColor`.
 *
 * It is inline rather than an `<img src="/logo.svg">` for one reason that matters here: the shell
 * re-tints with the Material You theme engine and the user's own seed, and an `<img>` cannot follow
 * `color`. Drawing the glyph paths with `fill="currentColor"` means each brand slot sets its own
 * `color` token (`--primary` on a surface, `--on-primary` on the deep auth aside) and the mark
 * tracks the theme for free, with no second asset and no hardcoded value (root CLAUDE.md §3).
 *
 * The self-contained `/logo.svg` in `static/` is the counterpart for contexts that cannot inherit
 * anything — the favicon, and any future og:image or external embed — which is why that file, and
 * only that file, carries a literal brand background.
 */
export function Logo(
	{ class: klass, className, alt, width, height }: LogoProps,
): JSX.Element {
	const cls = klass ?? className;
	const labelled = Boolean(alt);
	return (
		<svg
			class={cls}
			width={width}
			height={height}
			viewBox="0 0 520 485"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			role={labelled ? "img" : undefined}
			aria-label={labelled ? alt : undefined}
			aria-hidden={labelled ? undefined : "true"}
			focusable="false"
		>
			<path
				d="M0 225C0 100.736 100.736 0 225 0V0V260C225 384.264 124.264 485 0 485V485V225Z"
				fill="currentColor"
			/>
			<path
				d="M407.342 0C469.474 0 519.842 50.3681 519.842 112.5C519.842 174.632 469.474 225 407.342 225H294.843V112.5C294.843 50.3682 345.21 0.000144315 407.342 0ZM407 77C387.67 77 372 92.67 372 112V147H407C426.33 147 442 131.33 442 112C442 92.67 426.33 77 407 77Z"
				fill="currentColor"
			/>
		</svg>
	);
}

import type { JSX } from "preact";
import "../styles/flag.css";
import { cx } from "../../core/cx.ts";
import { flagArt } from "../core/flag-art.tsx";

// #region Props
/** Flag diameters — the icon ramp, so a flag sits in a row exactly where an icon would. */
export type FlagSize = "xs" | "sm" | "md" | "lg" | "xl";

/** Props for {@link Flag}. */
export interface FlagProps {
	/** ISO 3166-1 alpha-2 country code (`GB`, `US`), or `EU`. Case-insensitive. */
	code: string;
	size?: FlagSize;
	/**
	 * The country's name, when the flag is the only thing naming it. Omit it beside a visible name —
	 * the flag is then decorative and hidden from assistive tech, which already reads the name.
	 */
	label?: string;
	class?: string;
}
// #endregion

/**
 * Flag — a circular national flag (DESIGN_SYSTEM §C.1). Drawn inline from {@link flagArt}, so it
 * renders identically on every platform; regional-indicator emoji do not (Windows draws them as two
 * letters). A code without artwork falls back to its letters on a neutral disc rather than to an
 * empty circle. A hairline ring keeps a white-field flag (Japan, Israel) readable on a white surface.
 */
export function Flag({ code, size = "sm", label, class: className }: FlagProps): JSX.Element {
	const art = flagArt(code);
	const decorative = !label;
	return (
		<span
			class={cx("ui-flag", `ui-flag--${size}`, !art && "ui-flag--fallback", className)}
			role={decorative ? undefined : "img"}
			aria-label={label}
			aria-hidden={decorative ? "true" : undefined}
			data-code={code.toUpperCase()}
		>
			{art
				? (
					<svg class="ui-flag__art" viewBox="0 0 32 32" focusable="false" aria-hidden="true">
						{art}
					</svg>
				)
				: <span class="ui-flag__code">{code.slice(0, 2).toUpperCase()}</span>}
		</span>
	);
}

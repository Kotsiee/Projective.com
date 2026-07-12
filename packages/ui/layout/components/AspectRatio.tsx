import type { ComponentChildren, CSSProperties, HTMLAttributes, JSX } from "preact";
import "../styles/aspect-ratio.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";

/**
 * Named ratio presets. `square` (1:1) for icons/avatars; `wordmark` (7:2) for the primary logo
 * lockup — the canonical brand ratios (resolved 2026-07-12, PRODUCT_SPEC.md §Visual Identity).
 */
export type AspectRatioPreset = "square" | "wordmark";

const PRESETS: Record<AspectRatioPreset, string> = {
	square: "1 / 1",
	wordmark: "7 / 2",
};

export interface AspectRatioProps extends Omit<HTMLAttributes<HTMLElement>, "style" | "ref"> {
	/** A preset, a number (e.g. `1.5`), or a raw CSS ratio string (e.g. `"16 / 9"`). Default `square`. */
	ratio?: AspectRatioPreset | number | string;
	style?: CSSProperties;
	children?: ComponentChildren;
}

function resolveRatio(ratio: AspectRatioProps["ratio"]): string {
	if (ratio === undefined) return "1 / 1";
	if (typeof ratio === "number") return String(ratio);
	if (ratio in PRESETS) return PRESETS[ratio as AspectRatioPreset];
	return ratio;
}

/** AspectRatio — constrains its box to a fixed ratio; a single media child fills it via `cover`. */
export function AspectRatio(props: AspectRatioProps): JSX.Element {
	const { ratio, class: className, style, children, ...rest } = props;
	return (
		<div
			class={cx("ui-aspect-ratio", className as string)}
			style={styleVars({ "--ar": resolveRatio(ratio) }, style)}
			{...rest}
		>
			{children}
		</div>
	);
}

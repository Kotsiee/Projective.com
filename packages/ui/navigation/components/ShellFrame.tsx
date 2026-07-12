import type { ComponentChildren, CSSProperties, JSX } from "preact";
import "../styles/shell-frame.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { FrameSurface } from "../types/mod.ts";

export interface ShellFrameProps {
	/** Nested surface tone (0 = `--surface` … 3 = `--surface-3`). */
	surface?: FrameSurface;
	/**
	 * Exposed-corner curvature (DESIGN_SYSTEM.md Part D). The top-left is ALWAYS curved (nested
	 * framing). `flushBottom` (default `true`) means the frame reaches the window bottom → sharp
	 * bottom-left, maximizing area. Set `false` when a parent track remains beneath it → the
	 * bottom-left curves to match. The `useFlushBottom` hook can drive this dynamically from an island.
	 */
	flushBottom?: boolean;
	class?: string;
	style?: CSSProperties;
	children?: ComponentChildren;
}

/**
 * ShellFrame — a nested layout layer. Curves its top-left (always) and, conditionally, its
 * bottom-left. Right corners stay flush to the far viewport edges. The parent reveals a track on the
 * top and left via the gutter its content region applies.
 */
export function ShellFrame(
	{ surface = 0, flushBottom = true, class: className, style, children }: ShellFrameProps,
): JSX.Element {
	const bg = surface === 0 ? "var(--surface)" : `var(--surface-${surface})`;
	return (
		<div
			class={cx("ui-shell-frame", className)}
			data-flush-bottom={flushBottom ? "true" : "false"}
			style={styleVars({ "--frame-surface": bg }, style)}
		>
			{children}
		</div>
	);
}

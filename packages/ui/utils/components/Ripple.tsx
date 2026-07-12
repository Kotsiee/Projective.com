import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import "../styles/ripple.css";
import { cx } from "../../core/cx.ts";
import { useRipple } from "../../hooks/useRipple.ts";

// #region Props
/** Props for {@link Ripple}. */
export interface RippleProps {
	/** Disable the effect (mirror the host control's disabled state). */
	disabled?: boolean;
	/** Ripple tint (token reference); defaults to translucent `currentColor`. */
	color?: string;
	/** Originate the ripple from the host centre instead of the press point. */
	center?: boolean;
	/** The single interactive child the ripple decorates. */
	children?: ComponentChildren;
	class?: string;
}
// #endregion

/**
 * Ripple — a directive-style wrapper that attaches the Material press-ripple to its child. It renders
 * a relatively-positioned, overflow-clipped host span (`.ui-ripple-host`) around `children` and wires
 * {@link useRipple} to it, so a pointer press spawns a token-tinted ripple that scales from the press
 * point and fades. Reduced-motion suppresses the ripple. Purely decorative (`aria-hidden` spans);
 * the wrapped child keeps its own role, focus and keyboard behaviour.
 *
 * @example
 * ```tsx
 * <Ripple><button class="my-btn">Save</button></Ripple>
 * ```
 */
export function Ripple(props: RippleProps): JSX.Element {
	const { disabled, color, center, children, class: className } = props;
	const hostRef = useRef<HTMLSpanElement>(null);

	useRipple(hostRef, { disabled, color, center });

	return (
		<span ref={hostRef} class={cx("ui-ripple-wrap", className)}>
			{children}
		</span>
	);
}

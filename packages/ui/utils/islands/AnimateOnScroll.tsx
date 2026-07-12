import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import "../styles/animate-on-scroll.css";
import { cx } from "../../core/cx.ts";
import { useIntersectionObserver } from "../../hooks/useIntersectionObserver.ts";

// #region Props
/** Built-in enter animations (keyframes live in `animate-on-scroll.css`). */
export type ScrollAnimation = "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "zoom";

/** Props for {@link AnimateOnScroll}. */
export interface AnimateOnScrollProps {
	/** One of the built-in animations. Ignored when `enterClass` is supplied. */
	animation?: ScrollAnimation;
	/** Custom class applied while the element is in view (overrides `animation`). */
	enterClass?: string;
	/** Custom class applied while the element is out of view. */
	leaveClass?: string;
	/** Animate only the first time it enters, then stay visible (default `true`). */
	once?: boolean;
	/** Fraction visible before the enter animation fires (default `0.15`). */
	threshold?: number;
	/** Margin grown around the viewport when computing intersection. */
	rootMargin?: string;
	/** Content to reveal. */
	children?: ComponentChildren;
	class?: string;
}
// #endregion

/**
 * AnimateOnScroll — reveals its children with an enter animation as they cross the viewport, driven
 * by {@link useIntersectionObserver}. Choose a built-in `animation` or supply `enterClass`/`leaveClass`.
 * With `once` (default) the element animates in a single time and stays; otherwise it re-animates on
 * every entry/exit. Reduced-motion is honoured by the token durations collapsing to 0ms, so the
 * element simply jumps to its final state (no motion). The wrapper is presentational (`aria`-neutral).
 */
export function AnimateOnScroll(props: AnimateOnScrollProps): JSX.Element {
	const {
		animation = "fade",
		enterClass,
		leaveClass,
		once = true,
		threshold = 0.15,
		rootMargin,
		children,
		class: className,
	} = props;
	const ref = useRef<HTMLDivElement>(null);
	const { visible, hasBeenVisible } = useIntersectionObserver({
		targetRef: ref,
		threshold,
		rootMargin,
		once,
	});

	const shown = once ? hasBeenVisible.value : visible.value;
	const builtin = !enterClass;

	return (
		<div
			ref={ref}
			class={cx(
				"ui-aos",
				builtin && `ui-aos--${animation}`,
				builtin && shown && "ui-aos--in",
				enterClass && shown && enterClass,
				leaveClass && !shown && leaveClass,
				className,
			)}
			data-state={shown ? "in" : "out"}
		>
			{children}
		</div>
	);
}

import type { JSX, RefObject, VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "../styles/scroll-top.css";
import { cx } from "../../core/cx.ts";

// #region Props
/** Props for {@link ScrollTop}. */
export interface ScrollTopProps {
	/** Scroll distance (px) past which the button appears (default `400`). */
	threshold?: number;
	/** Scroll a specific container instead of the window. */
	target?: RefObject<HTMLElement>;
	/** Custom glyph/icon (defaults to an up chevron). */
	icon?: VNode | string;
	/** Accessible label (default `"Scroll to top"`). */
	"aria-label"?: string;
	/**
	 * `fixed` pins the button to the viewport corner (default); `sticky` scrolls within `target`'s
	 * own flow — useful for a scoped scroll container.
	 */
	position?: "fixed" | "sticky";
	class?: string;
}
// #endregion

/**
 * ScrollTop — a back-to-top button that fades in after the window (or a `target` container) is
 * scrolled past `threshold`, and smooth-scrolls back to the top on activation. Rendered as a real
 * `<button>` (full keyboard + focus), fixed to the corner at `--z-raised` by default. Reduced-motion
 * swaps the smooth scroll for an instant jump and collapses the fade. Hidden from the a11y tree while
 * off-screen so it never becomes a phantom tab stop.
 */
export function ScrollTop(props: ScrollTopProps): JSX.Element {
	const {
		threshold = 400,
		target,
		icon = "↑",
		"aria-label": ariaLabel = "Scroll to top",
		position = "fixed",
		class: className,
	} = props;

	const [visible, setVisible] = useState(false);

	// #region Scroll tracking
	useEffect(() => {
		if (typeof window === "undefined") return;
		const scroller: HTMLElement | Window = target?.current ?? window;
		const readTop = () =>
			scroller === window ? globalThis.scrollY : (scroller as HTMLElement).scrollTop;
		const onScroll = () => setVisible(readTop() > threshold);
		onScroll();
		scroller.addEventListener("scroll", onScroll, { passive: true });
		return () => scroller.removeEventListener("scroll", onScroll);
	}, [target, threshold]);
	// #endregion

	const toTop = () => {
		if (typeof window === "undefined") return;
		const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
		const scroller: HTMLElement | Window = target?.current ?? window;
		scroller.scrollTo({ top: 0, behavior });
	};

	const btnRef = useRef<HTMLButtonElement>(null);

	return (
		<button
			ref={btnRef}
			type="button"
			class={cx(
				"ui-scroll-top",
				`ui-scroll-top--${position}`,
				visible && "ui-scroll-top--visible",
				className,
			)}
			data-state={visible ? "visible" : "hidden"}
			aria-label={ariaLabel}
			aria-hidden={!visible || undefined}
			tabIndex={visible ? 0 : -1}
			onClick={toTop}
		>
			<span class="ui-scroll-top__icon" aria-hidden="true">{icon}</span>
		</button>
	);
}

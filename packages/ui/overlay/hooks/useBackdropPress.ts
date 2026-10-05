import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { isDismissPress, type PressPoint } from "../core/backdrop-press.ts";

/** Event handlers {@link useBackdropPress} returns, spread onto the dismiss surface. */
export interface BackdropPressHandlers<T extends HTMLElement> {
	onPointerDown: (e: JSX.TargetedPointerEvent<T>) => void;
	onPointerLeave: () => void;
	onPointerCancel: () => void;
	onClick: (e: JSX.TargetedMouseEvent<T>) => void;
}

/**
 * Click-outside handlers for a dismiss surface. `onDismiss` fires only for a press that both starts
 * and ends on the surface element itself (never a descendant) — see {@link isDismissPress}. Passing
 * no `onDismiss` makes the surface inert.
 *
 * @example
 * const press = useBackdropPress(close);
 * return <div class="scrim" {...press} />;
 */
export function useBackdropPress<T extends HTMLElement = HTMLDivElement>(
	onDismiss?: (e: JSX.TargetedMouseEvent<T>) => void,
): BackdropPressHandlers<T> {
	const start = useRef<PressPoint | null>(null);
	const clear = () => {
		start.current = null;
	};

	return {
		onPointerDown: (e) => {
			start.current = e.button === 0 && e.target === e.currentTarget
				? { x: e.clientX, y: e.clientY }
				: null;
		},
		onPointerLeave: clear,
		onPointerCancel: clear,
		onClick: (e) => {
			const pressed = start.current;
			clear();
			if (!onDismiss) return;
			if (isDismissPress(pressed, { x: e.clientX, y: e.clientY }, e.target === e.currentTarget)) {
				onDismiss(e);
			}
		},
	};
}

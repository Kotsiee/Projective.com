/**
 * `useRipple` — the Material-style ripple effect directive (Cat 10). Attaches a pointer-driven ripple
 * to an element ref: on press it spawns a token-coloured span that scales from the press point and
 * fades out. Honours reduced-motion (the ripple is suppressed) and is a no-op during SSR. The host
 * element must be `position: relative; overflow: hidden` (the shared `.ui-ripple-host` class does
 * this). Pair with `styles/ripple.css`.
 */
import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";

export interface RippleOptions {
	/** Disable the effect (e.g. when the control is disabled). */
	disabled?: boolean;
	/** Ripple colour (token reference); defaults to a translucent `currentColor`. */
	color?: string;
	/** Centre the ripple instead of originating at the press point. */
	center?: boolean;
}

export function useRipple(ref: RefObject<HTMLElement>, opts: RippleOptions = {}): void {
	const { disabled = false, color, center = false } = opts;

	useEffect(() => {
		if (disabled || typeof window === "undefined") return;
		const host = ref.current;
		if (!host) return;
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

		const onPointerDown = (e: PointerEvent) => {
			const rect = host.getBoundingClientRect();
			const size = Math.max(rect.width, rect.height) * 2;
			const x = center ? rect.width / 2 : e.clientX - rect.left;
			const y = center ? rect.height / 2 : e.clientY - rect.top;

			const ripple = document.createElement("span");
			ripple.className = "ui-ripple";
			ripple.style.width = ripple.style.height = `${size}px`;
			ripple.style.left = `${x - size / 2}px`;
			ripple.style.top = `${y - size / 2}px`;
			if (color) ripple.style.background = color;
			ripple.addEventListener("animationend", () => ripple.remove());
			host.appendChild(ripple);
		};

		host.classList.add("ui-ripple-host");
		host.addEventListener("pointerdown", onPointerDown);
		return () => host.removeEventListener("pointerdown", onPointerDown);
	}, [ref, disabled, color, center]);
}

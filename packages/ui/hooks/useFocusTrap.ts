/**
 * `useFocusTrap` — confine keyboard focus inside a container while `active` (modal dialogs, drawers,
 * the standalone FocusTrap utility). On activate it focuses the first tabbable element (or the
 * container), cycles Tab / Shift+Tab within the tabbable set, and restores focus to the
 * previously-focused element on deactivate. Client-only; a no-op during SSR.
 */
import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";

const FOCUSABLE = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"[tabindex]:not([tabindex='-1'])",
	"[contenteditable='true']",
].join(",");

export interface FocusTrapOptions {
	active: boolean;
	containerRef: RefObject<HTMLElement>;
	/** Focus this element (or the first tabbable) on activate. */
	initialFocusRef?: RefObject<HTMLElement>;
	/** Restore focus to the previously-focused element on deactivate (default true). */
	restoreFocus?: boolean;
}

/** Collect visible, tabbable descendants in DOM order. */
export function getTabbable(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		(el) => el.offsetParent !== null || el === document.activeElement,
	);
}

export function useFocusTrap(opts: FocusTrapOptions): void {
	const { active, containerRef, initialFocusRef, restoreFocus = true } = opts;

	useEffect(() => {
		if (!active || typeof document === "undefined") return;
		const container = containerRef.current;
		if (!container) return;

		const previouslyFocused = document.activeElement as HTMLElement | null;
		const focusFirst = () => {
			const target = initialFocusRef?.current ?? getTabbable(container)[0] ?? container;
			target.focus({ preventScroll: true });
		};
		// Defer so the overlay has painted and elements are focusable.
		const raf = requestAnimationFrame(focusFirst);

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Tab") return;
			const tabbable = getTabbable(container);
			if (tabbable.length === 0) {
				e.preventDefault();
				container.focus({ preventScroll: true });
				return;
			}
			const first = tabbable[0];
			const last = tabbable[tabbable.length - 1];
			const activeEl = document.activeElement;
			if (e.shiftKey && (activeEl === first || !container.contains(activeEl))) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && activeEl === last) {
				e.preventDefault();
				first.focus();
			}
		};

		container.addEventListener("keydown", onKeyDown);
		return () => {
			cancelAnimationFrame(raf);
			container.removeEventListener("keydown", onKeyDown);
			if (restoreFocus && previouslyFocused?.isConnected) {
				previouslyFocused.focus({ preventScroll: true });
			}
		};
	}, [active, containerRef, initialFocusRef, restoreFocus]);
}

/**
 * `useFocusTrap` — confine keyboard focus inside a container while `active` (modal dialogs, drawers,
 * the standalone FocusTrap utility). On activate it focuses the first tabbable element (or the
 * container), cycles Tab / Shift+Tab within the tabbable set, marks the rest of the page `inert`, and
 * restores focus to the previously-focused element on deactivate. Client-only; a no-op during SSR.
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

/**
 * Fallback delay for the initial focus move — `requestAnimationFrame` never runs in a hidden or
 * throttled tab, and focus entering the panel must not depend on a frame that may not arrive.
 */
const FOCUS_WATCHDOG_MS = 120;

// #region Module-level trap stack
/**
 * Active trap containers, innermost last. The Tab handler binds to `document` (so focus that has
 * escaped the panel can be pulled back), which means nested traps would otherwise fight over the same
 * event — only the innermost one acts.
 */
const trapStack: HTMLElement[] = [];
// #endregion

export interface FocusTrapOptions {
	active: boolean;
	containerRef: RefObject<HTMLElement>;
	/**
	 * Focus this element on activate instead of the first tabbable. If the referenced element is not
	 * itself focusable it is treated as a scope and its first tabbable descendant is used, so a caller
	 * can point at an action group ("start on the safe button") without wiring a ref to the control.
	 */
	initialFocusRef?: RefObject<HTMLElement>;
	/** Restore focus to the previously-focused element on deactivate (default true). */
	restoreFocus?: boolean;
	/**
	 * Mark every sibling of the trapped subtree `inert` + `aria-hidden` while active (default true).
	 * Non-modal surfaces that trap focus for convenience only (an anchored popover) pass `false` —
	 * the page beneath stays live for them, so hiding it from assistive tech would be a lie.
	 */
	inertBackground?: boolean;
}

/**
 * Collect visible, tabbable descendants in DOM order.
 *
 * Visibility is measured with `getClientRects()` rather than `offsetParent`, because `offsetParent`
 * is also `null` for `position: fixed` elements — which would silently drop every fixed-positioned
 * control inside the panel. `visibility: hidden` still produces layout boxes, so it is excluded
 * explicitly, as are `inert` subtrees (which the selector list cannot express).
 */
export function getTabbable(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
		if (el === document.activeElement) return true;
		if (el.getClientRects().length === 0) return false;
		if (el.closest("[inert]")) return false;
		return globalThis.getComputedStyle(el).visibility !== "hidden";
	});
}

/**
 * Mark every `document.body` child that does not contain `container` as `inert` + `aria-hidden`, so
 * pointer, keyboard and the screen-reader virtual cursor are all confined to the overlay. Returns the
 * undo. Elements already marked by an outer trap are left alone, so nested overlays unwind cleanly.
 */
function inertSiblings(container: HTMLElement): () => void {
	const marked: HTMLElement[] = [];
	for (const child of Array.from(document.body.children)) {
		const el = child as HTMLElement;
		if (el.contains(container) || el.hasAttribute("inert")) continue;
		el.setAttribute("inert", "");
		el.setAttribute("aria-hidden", "true");
		marked.push(el);
	}
	return () => {
		for (const el of marked) {
			el.removeAttribute("inert");
			el.removeAttribute("aria-hidden");
		}
	};
}

export function useFocusTrap(opts: FocusTrapOptions): void {
	const {
		active,
		containerRef,
		initialFocusRef,
		restoreFocus = true,
		inertBackground = true,
	} = opts;

	useEffect(() => {
		if (!active || typeof document === "undefined") return;
		const container = containerRef.current;
		if (!container) return;

		const previouslyFocused = document.activeElement as HTMLElement | null;
		const releaseInert = inertBackground ? inertSiblings(container) : undefined;
		trapStack.push(container);

		let focused = false;
		const focusFirst = () => {
			if (focused) return;
			focused = true;
			const explicit = initialFocusRef?.current;
			const resolved = explicit
				? (explicit.matches(FOCUSABLE) ? explicit : getTabbable(explicit)[0])
				: undefined;
			const target = resolved ?? getTabbable(container)[0] ?? container;
			target.focus({ preventScroll: true });
		};
		// Defer so the overlay has painted and elements are focusable, with a timer fallback for the
		// hidden-tab case where the frame never comes.
		const raf = requestAnimationFrame(focusFirst);
		const watchdog = setTimeout(focusFirst, FOCUS_WATCHDOG_MS);

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Tab") return;
			// Only the innermost active trap governs Tab.
			if (trapStack[trapStack.length - 1] !== container) return;
			const tabbable = getTabbable(container);
			if (tabbable.length === 0) {
				e.preventDefault();
				container.focus({ preventScroll: true });
				return;
			}
			const first = tabbable[0];
			const last = tabbable[tabbable.length - 1];
			const activeEl = document.activeElement;
			// Focus can legitimately sit outside the container — a background click lands there, and the
			// browser's own chrome hands it back at the document root. Both directions pull it home.
			const outside = !container.contains(activeEl);
			if (e.shiftKey && (activeEl === first || outside)) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && (activeEl === last || outside)) {
				e.preventDefault();
				first.focus();
			}
		};

		// Bound to `document`, not the container: a container-scoped listener stops firing the moment
		// focus leaves the panel, which silently un-traps the overlay for the rest of its life.
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(watchdog);
			document.removeEventListener("keydown", onKeyDown, true);
			const i = trapStack.lastIndexOf(container);
			if (i >= 0) trapStack.splice(i, 1);
			releaseInert?.();
			if (restoreFocus && previouslyFocused?.isConnected) {
				previouslyFocused.focus({ preventScroll: true });
			}
		};
	}, [active, containerRef, initialFocusRef, restoreFocus, inertBackground]);
}

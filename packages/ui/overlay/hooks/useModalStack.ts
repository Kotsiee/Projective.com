import type { RefObject } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { ModalStack } from "../core/modal-stack.ts";

/**
 * Hooks that bind a component's live UI state to its {@link ModalStack} frame, so a modal replaced
 * by another and later restored comes back exactly as it was left.
 *
 * The contract each hook keeps is the same: read the cache ONCE per frame (on mount, or when the
 * frame identity changes under a persistent component), and write back on change without ever
 * touching the reactive frame list.
 */

// #region Frame state
/**
 * A signal whose value survives being replaced on the stack — a tab index, a search string, a set
 * of expanded ids.
 *
 * Keyed by the frame's `uid`, not by `kind`+`id`: two frames showing the same ticket are two visits
 * and must not share a tab position.
 *
 * @example
 * const tab = useFrameState(stack, uid, "tab", "details");
 */
export function useFrameState<T>(
	stack: ModalStack,
	uid: number,
	key: string,
	initial: T,
): Signal<T> {
	const value = useSignal<T>(stack.read(uid, key, initial));
	const boundTo = useRef(uid);

	// A host that keeps ONE component mounted across a frame change (rather than remounting per
	// frame) would otherwise carry the previous frame's value into the new one. Re-seed on identity
	// change, during render, so the first paint is already correct.
	if (boundTo.current !== uid) {
		boundTo.current = uid;
		value.value = stack.read(uid, key, initial);
	}

	useEffect(() => value.subscribe((v) => stack.write(uid, key, v)), [uid, key]);

	return value;
}
// #endregion

// #region Frame scroll
/**
 * Persist and restore one scroll container's offset across a stack replacement.
 *
 * Restoring is deliberately belt-and-braces. The layout effect handles the ordinary case, where the
 * element is already at its final height; the follow-up frame handles a body whose content is still
 * settling (an image resolving, a virtualized list measuring), where an immediate assignment would
 * be clamped to a smaller `scrollHeight` and silently lost. The follow-up uses a timeout rather than
 * `requestAnimationFrame` alone because a backgrounded tab never fires rAF, and a restore that only
 * works in a foreground tab is not a restore.
 */
export function useFrameScroll(
	stack: ModalStack,
	uid: number,
	key: string,
	ref: RefObject<HTMLElement | null>,
): void {
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;

		const target = stack.read(uid, key, 0);
		// Assign unconditionally, INCLUDING zero. One container often serves several keys (the tabs of
		// a modal share a scroll region), so "nothing cached" has to mean "go to the top" — skipping
		// the assignment left the incoming view inheriting wherever the outgoing one happened to be.
		const apply = () => {
			if (ref.current) ref.current.scrollTop = target;
		};
		apply();
		const settle = setTimeout(apply, 0);

		// Written synchronously on every scroll event. It is a `Map.set` into a non-reactive cache, so
		// there is nothing to coalesce for — and crucially nothing to flush late. The obvious
		// alternative, capturing `el.scrollTop` in the cleanup, is WRONG: by the time cleanup runs the
		// container already holds the NEXT view's content, so the browser has clamped the offset to
		// that content's height and the value recorded is not the one the reader left (measured: 47
		// saved as 15, because the incoming tab was shorter).
		const onScroll = () => {
			if (ref.current) stack.write(uid, key, ref.current.scrollTop);
		};
		el.addEventListener("scroll", onScroll, { passive: true });

		return () => {
			clearTimeout(settle);
			el.removeEventListener("scroll", onScroll);
		};
	}, [uid, key]);
}
// #endregion

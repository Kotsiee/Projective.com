/**
 * `useListNavigation` — roving "active option" index for listbox-pattern widgets (Select, Listbox,
 * MultiSelect, AutoComplete, CascadeSelect). Implements the WAI-ARIA active-descendant model:
 * ArrowUp/Down move a virtual highlight (skipping disabled rows), Home/End jump to the ends, and the
 * caller decides what Enter/Space do. Returns the active index signal and a keydown handler.
 */
import { useMemo } from "preact/hooks";
import { signal } from "@preact/signals";
import type { Signal } from "@preact/signals";

export interface ListNavigation {
	active: Signal<number>;
	/** Move to the next/previous enabled index, wrapping. */
	move: (delta: 1 | -1) => void;
	/** Jump to first/last enabled index. */
	toEdge: (edge: "first" | "last") => void;
	/** Reset the highlight (e.g. on close). */
	reset: (to?: number) => void;
	/** Keydown handler for arrow/home/end; returns true if it handled the key. */
	onKeyDown: (e: KeyboardEvent) => boolean;
}

export function useListNavigation(
	count: () => number,
	isDisabled: (i: number) => boolean = () => false,
): ListNavigation {
	const active = useMemo(() => signal<number>(-1), []);

	const nextEnabled = (from: number, delta: 1 | -1): number => {
		const n = count();
		if (n === 0) return -1;
		let i = from;
		for (let step = 0; step < n; step++) {
			i = (i + delta + n) % n;
			if (!isDisabled(i)) return i;
		}
		return from;
	};

	const move = (delta: 1 | -1) => {
		active.value = nextEnabled(active.peek() < 0 ? (delta === 1 ? -1 : 0) : active.peek(), delta);
	};
	const toEdge = (edge: "first" | "last") => {
		active.value = edge === "first" ? nextEnabled(-1, 1) : nextEnabled(0, -1);
	};
	const reset = (to = -1) => {
		active.value = to;
	};

	const onKeyDown = (e: KeyboardEvent): boolean => {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				move(1);
				return true;
			case "ArrowUp":
				e.preventDefault();
				move(-1);
				return true;
			case "Home":
				e.preventDefault();
				toEdge("first");
				return true;
			case "End":
				e.preventDefault();
				toEdge("last");
				return true;
			default:
				return false;
		}
	};

	return useMemo(() => ({ active, move, toEdge, reset, onKeyDown }), [active]);
}

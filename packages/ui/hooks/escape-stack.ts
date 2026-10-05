/// <reference lib="dom" />

// #region Layers
/** One open overlay's claim on the Escape key. Callbacks are read live at press time. */
export interface EscapeLayer {
	/** Whether the overlay currently owns dismissal — `useOverlayStack().isTop`. */
	enabled: () => boolean;
	/** Whether Escape closes it. A refusing top layer lets the press travel untouched. */
	closeOnEscape: () => boolean;
	/** Close the overlay. */
	dismiss: () => void;
}

/** The subset of `KeyboardEvent` the dispatcher touches. */
export type EscapeEvent = Pick<
	KeyboardEvent,
	"key" | "preventDefault" | "stopImmediatePropagation"
>;

/** A LIFO owner of the Escape key: only the most recently opened layer ever receives it. */
export interface EscapeStack {
	/** Push a layer on top. Returns an idempotent release function. */
	push(layer: EscapeLayer): () => void;
	/** Route one keydown to the top layer. Returns `true` when that layer consumed it. */
	dispatch(e: EscapeEvent): boolean;
	/** How many layers are open. */
	readonly size: number;
}

/**
 * Create an independent Escape stack. `onChange` receives the size after every push and release.
 * Lower layers are never consulted, so a stack of N overlays closes exactly one per press.
 */
export function createEscapeStack(onChange?: (size: number) => void): EscapeStack {
	const layers: EscapeLayer[] = [];

	return {
		push(layer) {
			layers.push(layer);
			onChange?.(layers.length);
			return () => {
				const i = layers.indexOf(layer);
				if (i < 0) return;
				layers.splice(i, 1);
				onChange?.(layers.length);
			};
		},

		dispatch(e) {
			if (e.key !== "Escape") return false;
			const top = layers[layers.length - 1];
			if (!top || !top.enabled() || !top.closeOnEscape()) return false;
			e.stopImmediatePropagation();
			e.preventDefault();
			top.dismiss();
			return true;
		},

		get size() {
			return layers.length;
		},
	};
}
// #endregion

// #region Document binding
const onKeyDown = (e: KeyboardEvent) => {
	escapeStack.dispatch(e);
};

const escapeStack = createEscapeStack((size) => {
	if (typeof document === "undefined") return;
	if (size === 1) document.addEventListener("keydown", onKeyDown, true);
	else if (size === 0) document.removeEventListener("keydown", onKeyDown, true);
});

/** Claim the Escape key for an open overlay, above everything already open. Client-only. */
export function pushEscapeLayer(layer: EscapeLayer): () => void {
	return escapeStack.push(layer);
}
// #endregion

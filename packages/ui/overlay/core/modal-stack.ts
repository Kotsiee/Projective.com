import { computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";

/**
 * modal-stack — a replace-in-place router for a chain of modals, with a state cache.
 *
 * The problem it exists to solve is a rendering one. The obvious way to open a second modal from
 * inside the first is to mount it on top: two dialogs, two focus traps and — because every one of
 * this product's overlays dims through a blurred {@link Backdrop} — two full-viewport
 * `backdrop-filter` layers compositing every frame. Blur is the single most expensive thing a
 * browser can be asked to do over a whole viewport, and stacking them multiplies that cost while
 * making the lower surface unreadable anyway.
 *
 * So the stack renders exactly ONE frame: the top. Opening a second modal REPLACES the first rather
 * than covering it, and the first's live UI state — its tab, its form inputs, its scroll positions —
 * is kept in a cache so popping back restores the surface a user actually left, not a fresh one.
 *
 * ## Why the cache is not a signal
 *
 * The frame list is reactive (the host re-renders when the top changes) but the per-frame state
 * cache deliberately is NOT. A modal writing its scroll offset on every scroll event, or a keystroke
 * into a cached text field, must not invalidate the frame list and re-render the host — that would
 * turn a cheap bookkeeping write into a render storm. The cache is a plain `Map` keyed by each
 * frame's unique id; components read it once on mount and write to it freely.
 *
 * ## Frame identity
 *
 * Every push mints a monotonic `uid`, so the same `kind`+`id` can legitimately appear twice in one
 * chain (a ticket that links to a ticket) without the two sharing a cache slot.
 *
 * Generic and business-free: `kind` is the consumer's own discriminated union, and this module never
 * renders anything. The host decides what each `kind` maps to.
 */

// #region Frame
/** One entry in a modal chain. `K` is the consumer's own union of modal kinds. */
export interface ModalFrame<K extends string = string, I = unknown> {
	/** Monotonic identity — unique for the life of the stack, even across identical `kind`+`id`. */
	readonly uid: number;
	/** Which modal to render. */
	readonly kind: K;
	/** What it is showing — a ticket id, a submission path. Stable across a restore. */
	readonly id: string;
	/** Open-time input for the modal. Immutable; live state belongs in the cache. */
	readonly input: I;
}
// #endregion

// #region Store
/** A modal chain: the reactive frame list, the non-reactive state cache, and the navigation verbs. */
export interface ModalStack<K extends string = string, I = unknown> {
	/** The whole chain, bottom-first. Reactive. */
	readonly frames: ReadonlySignal<readonly ModalFrame<K, I>[]>;
	/** The only frame that renders. `null` when nothing is open. */
	readonly top: ReadonlySignal<ModalFrame<K, I> | null>;
	/** The frame {@link ModalStack.back} would restore, for a "Back to …" affordance. */
	readonly beneath: ReadonlySignal<ModalFrame<K, I> | null>;
	/** How deep the chain is (0 = closed). */
	readonly depth: ReadonlySignal<number>;

	/** Start a NEW chain — discards anything open and its cache. */
	open(kind: K, id: string, input?: I): ModalFrame<K, I>;
	/** Open `kind` in place, keeping the current frame's state for {@link ModalStack.back}. */
	push(kind: K, id: string, input?: I): ModalFrame<K, I>;
	/** Swap the top frame WITHOUT growing the chain (its cache is dropped; the one below survives). */
	replace(kind: K, id: string, input?: I): ModalFrame<K, I>;
	/** Restore the frame beneath, with its cached state. Returns `false` when there is none. */
	back(): boolean;
	/** Close everything and clear every cache slot. */
	close(): void;

	/** Read one cached value for a frame; `fallback` when it has never been written. */
	read<T>(uid: number, key: string, fallback: T): T;
	/** Write one cached value for a frame. Does NOT notify — this is bookkeeping, not state. */
	write(uid: number, key: string, value: unknown): void;
	/** Whether a frame has a cached value under `key` (distinguishes "cached `null`" from "never set"). */
	has(uid: number, key: string): boolean;
}

/**
 * Create an independent modal chain. One per surface — a board's chain and a profile's chain share
 * no state, and neither is a global singleton.
 */
export function createModalStack<K extends string = string, I = unknown>(): ModalStack<K, I> {
	const frames = signal<readonly ModalFrame<K, I>[]>([]);
	const cache = new Map<number, Map<string, unknown>>();
	let seq = 0;

	const forget = (uid: number) => cache.delete(uid);

	const make = (kind: K, id: string, input?: I): ModalFrame<K, I> => ({
		uid: ++seq,
		kind,
		id,
		input: input as I,
	});

	return {
		frames,
		top: computed(() => frames.value[frames.value.length - 1] ?? null),
		beneath: computed(() => frames.value[frames.value.length - 2] ?? null),
		depth: computed(() => frames.value.length),

		open(kind, id, input) {
			for (const f of frames.value) forget(f.uid);
			const frame = make(kind, id, input);
			frames.value = [frame];
			return frame;
		},

		push(kind, id, input) {
			const frame = make(kind, id, input);
			frames.value = [...frames.value, frame];
			return frame;
		},

		replace(kind, id, input) {
			const current = frames.value;
			const frame = make(kind, id, input);
			if (current.length === 0) {
				frames.value = [frame];
				return frame;
			}
			forget(current[current.length - 1].uid);
			frames.value = [...current.slice(0, -1), frame];
			return frame;
		},

		back() {
			const current = frames.value;
			if (current.length < 2) return false;
			forget(current[current.length - 1].uid);
			frames.value = current.slice(0, -1);
			return true;
		},

		close() {
			for (const f of frames.value) forget(f.uid);
			frames.value = [];
		},

		read<T>(uid: number, key: string, fallback: T): T {
			const slot = cache.get(uid);
			if (!slot || !slot.has(key)) return fallback;
			return slot.get(key) as T;
		},

		write(uid, key, value) {
			let slot = cache.get(uid);
			if (!slot) {
				slot = new Map();
				cache.set(uid, slot);
			}
			slot.set(key, value);
		},

		has(uid, key) {
			return cache.get(uid)?.has(key) ?? false;
		},
	};
}
// #endregion

// #region Signal binding (framework-agnostic half of the hooks)
/**
 * Bind a signal to a frame's cache slot: seeded from the cache on creation, written back on every
 * change. Used by {@link useFrameState}; exported separately so a non-hook caller (a store built at
 * module scope) can bind too.
 *
 * The subscription is returned rather than self-managed — the caller decides its lifetime, which is
 * what lets a hook dispose it on unmount without this module importing `preact/hooks`.
 */
export function bindFrameSignal<T>(
	stack: ModalStack,
	uid: number,
	key: string,
	initial: T,
): { value: Signal<T>; dispose: () => void } {
	const value = signal<T>(stack.read(uid, key, initial));
	const dispose = value.subscribe((v) => stack.write(uid, key, v));
	return { value, dispose };
}
// #endregion

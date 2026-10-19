/**
 * overlay-handoff — open a dialog FROM a drawer without losing the keyboard reader's place (the
 * `/wallet` hand-off, Decision #123).
 *
 * `useFocusTrap` records `document.activeElement` when a modal activates and restores it on close only
 * if that element is still connected. A drawer act that closes the drawer and opens a dialog in the
 * same tick lets the dialog record the drawer's own button — still mounted while the drawer animates
 * out, gone a moment later — so when the dialog closes, focus falls to `<body>`. Any timer tuned to the
 * exit's duration is a guess about an ordering it cannot see.
 *
 * So the hand-off waits until the panel has really left the DOM (polled, capped so a panel that never
 * leaves cannot strand the act), puts focus back on what opened the panel, and only then opens the
 * dialog — which then records, and later restores, that element.
 *
 * Pure of the DOM: the panel test, the refocus and the clock are parameters, so the sequence is
 * unit-tested with a fake clock.
 */

// #region Types
/** The timers the hand-off polls on — the globals by default, a fake in a test. */
export interface HandoffClock {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	now(): number;
}

/** Options for {@link afterPanelLeaves}. */
export interface HandoffOptions {
	/** Whether the closing panel has left the DOM. */
	gone: () => boolean;
	/** Put focus back on whatever opened the panel, before the next overlay records it. */
	refocus: () => void;
	/** Open the next overlay. */
	then: () => void;
	/** Give up waiting after this long and hand off anyway, ms (default 1000). */
	capMs?: number;
	/** How often to look, ms (default 40). */
	stepMs?: number;
	clock?: HandoffClock;
}
// #endregion

// #region Hand-off
/** The longest a hand-off waits for a panel to leave. */
export const HANDOFF_CAP_MS = 1000;

/** How often a hand-off looks. */
export const HANDOFF_STEP_MS = 40;

const GLOBAL_CLOCK: HandoffClock = {
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
	now: () => Date.now(),
};

/**
 * Wait for the closing panel to leave, refocus its opener, then open the next overlay — once. Returns
 * a cancel for an unmount mid-wait (nothing runs after it).
 */
export function afterPanelLeaves(options: HandoffOptions): () => void {
	const clock = options.clock ?? GLOBAL_CLOCK;
	const cap = options.capMs ?? HANDOFF_CAP_MS;
	const step = options.stepMs ?? HANDOFF_STEP_MS;
	const started = clock.now();
	let timer: unknown = null;
	let settled = false;

	const look = () => {
		timer = null;
		if (settled) return;
		if (!options.gone() && clock.now() - started < cap) {
			timer = clock.setTimeout(look, step);
			return;
		}
		settled = true;
		options.refocus();
		options.then();
	};

	look();
	return () => {
		settled = true;
		if (timer !== null) clock.clearTimeout(timer);
		timer = null;
	};
}
// #endregion

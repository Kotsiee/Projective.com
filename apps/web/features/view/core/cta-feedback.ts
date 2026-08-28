import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

/**
 * cta-feedback — the calm positive-feedback state machine every conversion CTA on a listing page runs.
 *
 * # The shape
 *
 * `idle → pending → settled → idle`. Pressing the control puts it in `pending` (the button's own
 * spinner, `aria-busy`); the write resolves it to `settled` (a check mark and the server's sentence)
 * for a beat, and then it returns to `idle`. A refusal goes straight back to `idle` with the reason,
 * because a "done" mark for something that did not happen is the worst thing this module could do.
 *
 * # Why it is deliberately dull (§B.5)
 *
 * No confetti, no burst, no bounce. The press already gets a Material ripple from
 * `@projective/ui/utils` `Ripple`; the resolve is a 150ms cross-fade on `--dur-fast` with
 * `--spring-standard`, which is over-damped (`cubic-bezier(0.22, 1, 0.36, 1)` — ease-out-quint, no
 * overshoot) and therefore satisfies the merge gate that forbids a springy easing. An arcade
 * celebration on a control that has just moved somebody's money reads as a slot machine, and the
 * feedback a buyer actually needs is "it worked, here is what happens next".
 *
 * # Two rules this file exists to hold
 *
 * **The outcome never depends on a frame.** Every transition here is driven by `setTimeout`, never by
 * `requestAnimationFrame` and never by an `animationend`/`transitionend` listener. A backgrounded tab,
 * an occluded window and this repo's own preview pane all report `visible` while compositing nothing —
 * measured at zero rAF callbacks in 16.7 seconds — so a machine that advanced on a frame would strand
 * a button in `pending` forever and the buyer would press it again. §B.5's rule is that motion may
 * decorate an outcome but never carry it; this is that rule as code.
 *
 * **Reduced motion still gets the check.** The settled mark is information, not decoration: it is the
 * confirmation that the press landed. Under `prefers-reduced-motion` the global token layer already
 * collapses `--dur-fast` to `0ms`, so the state change jumps to its final frame rather than being
 * suppressed — jump-to-final, not skip.
 */

// #region Phases
/** Where a CTA is in its feedback cycle. */
export type CtaPhase = "idle" | "pending" | "settled";

/**
 * How long the settled mark holds, in ms.
 *
 * Long enough to be read at a glance, short enough that a buyer who wants to press again is not
 * waiting on it. It is also deliberately longer than the 150ms resolve, so the mark is stationary for
 * most of the time it is on screen rather than always mid-transition.
 */
export const SETTLE_MS = 1400;
// #endregion

// #region Hook
/** What {@link useCtaFeedback} hands back to a control. */
export interface CtaFeedback {
	/** The current phase. Drives `loading`, the check mark, and `data-phase` for the CSS. */
	phase: CtaPhase;
	/** Whether a write is in flight — the control's `disabled` / `aria-busy`. */
	busy: boolean;
	/**
	 * Run a write with feedback.
	 *
	 * Resolves to the action's own boolean: `true` settles the control, `false` returns it straight to
	 * idle. Re-entrant presses while one is in flight are ignored rather than queued — a second POST of
	 * one booking is a second charge, and an idempotency key protects the server rather than the buyer's
	 * nerves.
	 */
	run: (action: () => Promise<boolean>) => Promise<void>;
	/** Force back to idle — for a panel that closes mid-flight. */
	reset: () => void;
}

/**
 * Drive one control's feedback cycle.
 *
 * One hook per control rather than a shared signal: two CTAs in one region (a primary and a
 * secondary) each have their own cycle, and a shared phase would spin both when one was pressed.
 */
export function useCtaFeedback(): CtaFeedback {
	const phase = useSignal<CtaPhase>("idle");
	const timer = useRef<number | null>(null);
	const alive = useRef(true);

	useEffect(() => {
		alive.current = true;
		return () => {
			// Unmount mid-cycle: drop the timer, or it fires against a component that is gone. Preact
			// tolerates the signal write, but the timer would also outlive a listing the buyer has already
			// navigated away from, settling a control on the next page.
			alive.current = false;
			if (timer.current !== null) clearTimeout(timer.current);
		};
	}, []);

	function clear(): void {
		if (timer.current !== null) {
			clearTimeout(timer.current);
			timer.current = null;
		}
	}

	async function run(action: () => Promise<boolean>): Promise<void> {
		if (phase.value === "pending") return;
		clear();
		phase.value = "pending";
		let settled = false;
		try {
			settled = await action();
		} catch {
			// A thrown action is a failed action. The transport layer already degrades a network failure
			// to a soft result, so reaching here means a genuine programming fault — and the honest
			// response is still to release the control rather than to strand it.
			settled = false;
		}
		if (!alive.current) return;
		if (!settled) {
			phase.value = "idle";
			return;
		}
		phase.value = "settled";
		timer.current = setTimeout(() => {
			if (alive.current) phase.value = "idle";
			timer.current = null;
		}, SETTLE_MS) as unknown as number;
	}

	function reset(): void {
		clear();
		phase.value = "idle";
	}

	return { phase: phase.value, busy: phase.value === "pending", run, reset };
}
// #endregion

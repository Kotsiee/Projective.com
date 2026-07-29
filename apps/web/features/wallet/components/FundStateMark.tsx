import type { JSX } from "preact";
import { cx } from "@ui/core/cx.ts";
import { AvailableMark, AvailableMarkZero, EscrowMark, HoldMark } from "../core/glyphs.tsx";
import type { FundState } from "../types/wallet-types.ts";

/**
 * FundStateMark — the STATIC SHAPE channel for a fund state.
 *
 * RULE C-3: colour is never a sole channel. Every fund state on this surface carries a distinct
 * silhouette that survives every `data-cvd` overlay, `data-contrast="high"`, greyscale printing and
 * reduced motion:
 *
 *   available — a filled disc          (settled, whole)
 *   locked    — a strongbox            (stored value; NEVER a padlock)
 *   pending   — a progress ring        (in transit, time-based)
 *   on_hold   — two pause bars         (held under review; NEVER a warning triangle)
 *
 * The Pending ring is drawn at the SERVER-supplied elapsed fraction of the 7-day clearing window
 * (`IncomingItem.clearingFraction`), so the arc is honest — an unsynced client clock would render a
 * dishonest ring, so the client never measures elapsed time itself.
 */
export interface FundStateMarkProps {
	state: FundState;
	/** `0`–`1` elapsed fraction of the clearing window. Only read for `pending`. */
	clearingFraction?: number;
	/** Renders the zero variant: the same silhouette hollowed out, so the shape channel survives. */
	zero?: boolean;
	class?: string;
}

/** The 7-day clearing window as a ring. `r=5`, so the circumference is `2πr ≈ 31.416`. */
function PendingRing({ fraction }: { fraction: number }): JSX.Element {
	const c = 2 * Math.PI * 5;
	const filled = Math.max(0, Math.min(1, fraction)) * c;
	return (
		<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
			<circle
				cx="7"
				cy="7"
				r="5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				opacity="0.34"
			/>
			<circle
				cx="7"
				cy="7"
				r="5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-dasharray={`${filled} ${c}`}
				transform="rotate(-90 7 7)"
			/>
		</svg>
	);
}

export function FundStateMark(props: FundStateMarkProps): JSX.Element {
	const { state, clearingFraction = 0, zero = false } = props;
	const mark = state === "available"
		? (zero ? AvailableMarkZero : AvailableMark)
		: state === "locked"
		? EscrowMark
		: state === "pending"
		? <PendingRing fraction={zero ? 0 : clearingFraction} />
		: HoldMark;

	return (
		<span
			class={cx("wlt-fundstate__mark", `wlt-fundstate--${state}`, zero && "is-zero", props.class)}
			aria-hidden="true"
		>
			{mark}
		</span>
	);
}

/**
 * The dense-row variant: a fund-state dot for a ledger row. §B.6 — status in a dense row is
 * iconographic, and the words that explain it live ONLY in the caller's portal `Tooltip`, never as
 * inline text. The caller is responsible for that Tooltip and for the row's accessible name.
 */
export function FundStateDot(
	{ state, class: klass }: { state: FundState; class?: string },
): JSX.Element {
	return (
		<span
			class={cx("wlt-fundstate__dot", `wlt-fundstate--${state}`, klass)}
			aria-hidden="true"
			data-state={state}
		/>
	);
}

/** The human label for a fund state — used in tooltips and accessible names, never as a row's text. */
export function fundStateLabel(state: FundState): string {
	switch (state) {
		case "available":
			return "Available";
		case "locked":
			return "In escrow";
		case "pending":
			return "Pending";
		case "on_hold":
			return "On hold";
	}
}

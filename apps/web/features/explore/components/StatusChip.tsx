import type { JSX } from "preact";
import type { CardSignal } from "../core/card-signals.ts";

/**
 * StatusChip — the derived trust marker in a media card's TOP-LEFT overlay stack ("Top rated", "Fast
 * replies", "Available now").
 *
 * A chip here is not decoration: it floats over uploaded photography, so it takes the solid
 * `--ex-chip-on-media` label surface rather than a translucent veil, plus a soft drop shadow to lift
 * it off a busy image. Its meaning is carried by the WORDS; the accent tint is a second, redundant
 * channel for recognition speed, never the sole carrier (§B.6).
 *
 * **Palette note, deliberate:** none of the variants tint with `--primary`. `--on-primary` on
 * `--primary` measures 3.57:1 in dark mode in this theme — a known, still-unfixed theme-engine defect
 * flagged by Decisions #64/#65. These chips take `--secondary` / `--tertiary` / `--success`, each of
 * which measures comfortably past 4.5:1 in both themes.
 */
export function StatusChip({ signal }: { signal: CardSignal }): JSX.Element {
	return (
		<span class="ex-status" data-signal={signal.id}>
			<span class="ex-status__dot" aria-hidden="true" />
			{signal.label}
		</span>
	);
}

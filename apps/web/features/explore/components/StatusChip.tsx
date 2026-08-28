import type { JSX } from "preact";
import type { CardSignal } from "../core/card-signals.ts";

/**
 * StatusChip — the derived trust marker in a media card's TOP-LEFT overlay stack ("Top rated", "Fast
 * replies", "Available now").
 *
 * A chip here is not decoration: it floats over uploaded photography, so it takes a SOLID accent fill
 * — never a translucent veil and never a tint that has to survive whatever the seller uploaded. The
 * fill is a semantic role token and the ink is that role's generated `--on-*` counterpart, which the
 * theme engine emits as a verified-AA pair, so one declaration stays legible in both themes without a
 * per-theme override.
 *
 * The status DOT is gone. It was a second, fully redundant channel beside a word that already says the
 * same thing, and on a solid accent fill it had nothing left to distinguish itself against. Meaning is
 * carried by the WORDS; the fill colour is recognition speed, never the sole carrier (§B.6).
 *
 * **Palette note, deliberate:** no variant tints with `--primary`. `--on-primary` on `--primary`
 * measures 3.57:1 in dark mode in this theme — a known, still-unfixed theme-engine defect flagged by
 * Decisions #64/#65. These chips take `--secondary` / `--tertiary` / `--success`, whose generated
 * pairs measure comfortably past 4.5:1 in both themes.
 */
export function StatusChip({ signal }: { signal: CardSignal }): JSX.Element {
	return <span class="ex-status" data-signal={signal.id}>{signal.label}</span>;
}

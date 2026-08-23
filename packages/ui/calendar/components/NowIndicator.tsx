/**
 * @projective/ui/calendar — the live current-time line, isolated into its own component ON PURPOSE.
 *
 * The clock ticks once a minute. Before this component the tick was read in the `Calendar` island's
 * own render body and passed down as a plain number, so every tick re-rendered the header, the
 * 42-button mini-map, the availability panel, every day column, every re-run of `packDayEvents` and
 * every event block — to move one 2px rule.
 *
 * Here the tick signal is read ONLY inside this leaf, so a tick re-renders this element and nothing
 * else. Everything upstream consumes a day-granular `todayMs` instead, which changes at midnight
 * rather than every minute. The position is written straight into `--cal-top` from the measured
 * minute — no animation is involved, so a frozen animation clock (a hidden tab) cannot strand the
 * line at a stale offset.
 */
import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";

export interface NowIndicatorProps {
	/** The live clock. Read here and NOWHERE upstream — that isolation is the whole point. */
	now: Signal<number>;
	/** False until the client has mounted, so SSR never paints a line at the seed instant. */
	mounted: Signal<boolean>;
	/** The zoom, in the same scope's units. */
	pxPerHour: Signal<number>;
	/** The axis origin (minutes) the enclosing scope positions everything from. */
	rangeStartMin: number;
	/** Axis minute for an instant, or null when the line does not belong in this scope. */
	minuteAt: (nowMs: number) => number | null;
	class?: string;
}

export function NowIndicator(props: NowIndicatorProps): JSX.Element | null {
	if (!props.mounted.value) return null;
	const minute = props.minuteAt(props.now.value);
	if (minute == null) return null;
	const y = ((minute - props.rangeStartMin) / 60) * props.pxPerHour.value;
	return (
		<div
			class={cx("cal-daycol__now", props.class)}
			style={styleVars({ "--cal-top": `${y}px` })}
			aria-hidden="true"
		>
			<span class="cal-daycol__now-dot" />
		</div>
	);
}

import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/weekday-rail.css";
import { cx } from "../../core/cx.ts";
import { sweptSelection, weekdayOrder } from "../core/weekday-rail.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

// #region Props
/** Props for {@link WeekdayRail}. */
export interface WeekdayRailProps extends Omit<BaseFieldProps, "fluid" | "status" | "readOnly"> {
	/**
	 * The selected weekdays, 0 = Sunday … 6 = Saturday (the `Date#getDay` and
	 * `availability_rules.weekday` numbering). Raw (uncontrolled) or a `Signal` (controlled); always
	 * emitted sorted ascending.
	 */
	value?: Bindable<number[]>;
	/** Fired with the new selection on every accepted toggle. */
	onValueChange?: ValueChange<number[]>;
	/** The first letter on the rail, 0 = Sunday (default `1`, Monday). */
	weekStartsOn?: number;
	/** BCP-47 locale the letters and their accessible names are drawn in (default `en-GB`). */
	locale?: string;
	/**
	 * The fewest days the selection may hold (default `1`). A toggle that would go below it is
	 * refused, so "repeats every week on…" can never be left on no day.
	 */
	min?: number;
	/** The most days the selection may hold (default `7`). */
	max?: number;
	class?: string;
}
// #endregion

// #region Names
/** A Sunday in UTC; day `d` of the week is `d` days after it. */
const SUNDAY_UTC = Date.UTC(2023, 0, 1);

function weekdayLabel(day: number, locale: string, width: "narrow" | "long"): string {
	try {
		return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" })
			.format(SUNDAY_UTC + day * 86_400_000);
	} catch {
		return new Intl.DateTimeFormat("en-GB", { weekday: width, timeZone: "UTC" })
			.format(SUNDAY_UTC + day * 86_400_000);
	}
}

export { weekdayOrder };
// #endregion

// #region Sweep
/** A press on one day that may become a drag across the others. */
interface Sweep {
	pointerId: number;
	/** The rail position the press began on. */
	from: number;
	/** The rail position last painted to. */
	to: number;
	/** Whether the run selects or clears: the opposite of the first day's state. */
	on: boolean;
	/** The selection when the press began; the run is laid over it. */
	base: number[];
	/** Set once the pointer has crossed onto another day. */
	moved: boolean;
}

/** How long after a sweep's release the click it leaves behind is still its own. */
const SWEEP_CLICK_MS = 400;
// #endregion

/**
 * WeekdayRail — the seven weekdays as one row of circular letter toggles (`M T W T F S S`), for
 * choosing which days something repeats on.
 *
 * Each letter is a native `<button aria-pressed>` named by its full weekday ("Tuesday"), inside a
 * `role="group"` named by the caller, so the two letters a week shares (`T`, `S`) are never
 * ambiguous to a listener. The order follows `weekStartsOn`, which a host derives from the
 * viewer's locale; the VALUE is always weekday numbers, never positions, so a Sunday-first rail and a
 * Monday-first one write the same thing.
 *
 * Arrow keys move between letters (roving), Home/End jump to the ends, Space/Enter toggle. A press
 * that drags across the rail sweeps a run of days: every day from the first to the one under the
 * pointer is selected, or cleared when the first day was already selected ({@link sweptSelection}),
 * and moving back shrinks the run. A press that never leaves its day is an ordinary toggle.
 *
 * The selected state is a solid `--primary` fill under `--on-primary` ink and the resting state a
 * `--surface-2` disc under `--text-secondary`; the two differ by fill AND ink, and the disc is the
 * same size in both, so pressing one never shifts the row. `min`/`max` refuse a toggle, and stop a
 * sweep, rather than correcting either afterwards. Signal-first via `useControllable`.
 */
export function WeekdayRail(props: WeekdayRailProps): JSX.Element {
	const {
		value,
		onValueChange,
		weekStartsOn = 1,
		locale = "en-GB",
		min = 1,
		max = 7,
		id,
		disabled,
		required,
		size = "md",
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<number[]>(value, [], onValueChange);
	const rootId = useId(id, "weekday-rail");
	/** The letter holding the rail's one tab stop once the reader has moved onto it. */
	const roving = useSignal<number | null>(null);
	const sweeping = useSignal(false);
	const sweep = useRef<Sweep | null>(null);
	/** The `timeStamp` until which a click is the tail of a finished sweep, not a toggle. */
	const swallowUntil = useRef(0);
	const selected = new Set(ctrl.signal.value);
	const order = weekdayOrder(weekStartsOn);
	// One stop for the whole rail: the letter last focused, else the first selected, else the first.
	const stop = roving.value ?? Math.max(0, order.findIndex((d) => selected.has(d)));

	const toggle = (day: number) => {
		if (disabled) return;
		const next = new Set(ctrl.get());
		if (next.has(day)) next.delete(day);
		else next.add(day);
		if (next.size < min || next.size > max) return;
		ctrl.set([...next].sort((a, b) => a - b));
	};

	/** The rail position of the day at a point, or `-1` off every day of this rail. */
	const positionAt = (rail: HTMLElement, x: number, y: number): number => {
		const day = document.elementFromPoint(x, y)?.closest<HTMLElement>(".ui-weekday-rail__day");
		if (!day || !rail.contains(day)) return -1;
		return [...rail.querySelectorAll(".ui-weekday-rail__day")].indexOf(day);
	};

	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (disabled || e.button !== 0) return;
		const from = positionAt(e.currentTarget, e.clientX, e.clientY);
		if (from < 0) return;
		const base = ctrl.get();
		sweep.current = {
			pointerId: e.pointerId,
			from,
			to: from,
			on: !base.includes(order[from]),
			base,
			moved: false,
		};
	};

	const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const s = sweep.current;
		if (!s || s.pointerId !== e.pointerId) return;
		const to = positionAt(e.currentTarget, e.clientX, e.clientY);
		if (to < 0 || to === s.to) return;
		if (!s.moved) {
			// Captured only once the press has become a sweep: capturing on press retargets the release,
			// and the plain click a press that never moves depends on would never reach its day.
			s.moved = true;
			sweeping.value = true;
			e.currentTarget.setPointerCapture(e.pointerId);
		}
		s.to = to;
		const next = sweptSelection(s.base, order, s.from, to, s.on, min, max);
		if (next) ctrl.set(next);
	};

	const endSweep = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const s = sweep.current;
		if (!s || s.pointerId !== e.pointerId) return;
		sweep.current = null;
		if (!s.moved) return;
		sweeping.value = false;
		swallowUntil.current = e.timeStamp + SWEEP_CLICK_MS;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
	};

	const onDayClick = (e: JSX.TargetedMouseEvent<HTMLButtonElement>, day: number) => {
		if (e.timeStamp <= swallowUntil.current) {
			swallowUntil.current = 0;
			return;
		}
		toggle(day);
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const buttons = [
			...e.currentTarget.querySelectorAll<HTMLButtonElement>(".ui-weekday-rail__day"),
		];
		const at = buttons.indexOf(e.target as HTMLButtonElement);
		if (at < 0) return;
		const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
		let next: number | null = null;
		if (e.key === "ArrowRight") next = at + (rtl ? -1 : 1);
		else if (e.key === "ArrowLeft") next = at + (rtl ? 1 : -1);
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = buttons.length - 1;
		if (next === null) return;
		e.preventDefault();
		buttons[(next + buttons.length) % buttons.length]?.focus();
	};

	return (
		<div
			id={rootId}
			role="group"
			class={cx(
				"ui-weekday-rail",
				`ui-weekday-rail--size-${size}`,
				disabled && "ui-weekday-rail--disabled",
				className,
			)}
			data-sweeping={sweeping.value ? "true" : undefined}
			aria-label={ariaLabel ?? "Days of the week"}
			aria-describedby={describedBy}
			aria-required={required || undefined}
			aria-disabled={disabled || undefined}
			onKeyDown={onKeyDown}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endSweep}
			onPointerCancel={endSweep}
		>
			{order.map((day, i) => {
				const on = selected.has(day);
				return (
					<button
						key={day}
						type="button"
						class="ui-weekday-rail__day"
						aria-pressed={on}
						aria-label={weekdayLabel(day, locale, "long")}
						tabIndex={stop === i ? 0 : -1}
						disabled={disabled}
						onClick={(e) => onDayClick(e, day)}
						onFocus={() => (roving.value = i)}
					>
						<span class="ui-weekday-rail__letter" aria-hidden="true">
							{weekdayLabel(day, locale, "narrow")}
						</span>
					</button>
				);
			})}
		</div>
	);
}

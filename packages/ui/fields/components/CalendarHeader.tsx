import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Icon } from "../../icons/mod.ts";
import { Select } from "../islands/Select.tsx";
import type { Option } from "../types/mod.ts";
import { MONTH_NAMES } from "../core/datetime.ts";

// #region Constants

/** Month options for the header picker — built once; the labels never change. */
export const MONTH_OPTIONS: Option[] = MONTH_NAMES.map((label, i) => ({
	value: String(i),
	label,
}));

/**
 * Row height for the two windowed header lists, px.
 *
 * The windowed renderer positions rows absolutely, so it needs a concrete number where the rest of
 * the taxonomy reads a token. This is `Select`'s own `virtualItemSize` default — stated rather than
 * inherited, so a change to that default cannot silently misalign a two-hundred-entry list.
 *
 * BOTH header lists are windowed on it, including the twelve-row month list that does not need the
 * windowing, because the alternative is two adjacent dropdowns with different row heights: an
 * unwindowed `.ui-select__option` is `max(--fld-opt-h, line-box + 2 × --space-2)`, which at the
 * default root size resolves to ~38.5px rather than the token's 36px — and, being a function of the
 * root font size, to a different number again at any other. No px constant can equal that, so the
 * two lists are made to agree with each OTHER instead of each disagreeing separately. The real fix
 * is for `Select` to measure its own row; this constant goes when it does.
 */
export const NAV_ROW_H = 40;

// #endregion

// #region Types

export interface CalendarHeaderProps {
	/** Mirror of the viewed month, bound to the month `Select`. */
	monthValue: Signal<string>;
	/** Mirror of the viewed year, bound to the year `Select`. */
	yearValue: Signal<string>;
	/** Years the picker offers, already bounded by `minDate`/`maxDate` and the caller's span. */
	yearOptions: Option[];
	onPickMonth: (value: string) => void;
	onPickYear: (value: string) => void;
	/** Step the view by whole months. Called with ±1 for a month and ±12 for a year. */
	onStep: (months: number) => void;
	/** Would a step of `months` leave the selectable range entirely? */
	stepBlocked: (months: number) => boolean;
	/** Hide the dropdowns and show only the step controls (the multi-month presentation). */
	compact?: boolean;
}

// #endregion

/**
 * The calendar's month header: the period centred as two searchable dropdowns, flanked by paired
 * step controls — single chevrons for a month, doubled for a year.
 *
 * The centring is a three-track grid rather than `space-between`, so the dropdowns sit on the
 * panel's true centre line and stay there when a step button is disabled at a bound. With
 * `space-between` the middle drifts by whatever the two button groups differ by, which is exactly
 * the sort of movement a reader reads as the layout being unstable.
 *
 * The month and year controls are the package's own {@link Select}, not native `<select>`s. A native
 * dropdown is drawn by the OS: it ignores the token layer, cannot be windowed, and — the reason it
 * had to go — renders a century of years as a single unbounded list. Both carry `filter`, so a
 * hundred-entry year list is reachable by typing rather than by scrolling. Because both open from a
 * trigger INSIDE the (already portalled) calendar panel, the overlay registry reads them as that
 * panel's children, so choosing a month is not an outside click on the calendar.
 */
export function CalendarHeader(props: CalendarHeaderProps): JSX.Element {
	const { monthValue, yearValue, yearOptions, onPickMonth, onPickYear, onStep, stepBlocked } =
		props;

	const step = (
		months: number,
		label: string,
		icon: "chevron-left" | "chevron-right" | "chevrons-left" | "chevrons-right",
	): JSX.Element => (
		<button
			type="button"
			class={Math.abs(months) === 12
				? "ui-datepicker__nav-btn ui-datepicker__nav-btn--year"
				: "ui-datepicker__nav-btn"}
			aria-label={label}
			disabled={stepBlocked(months)}
			onClick={() => onStep(months)}
		>
			<Icon name={icon} />
		</button>
	);

	return (
		<div class="ui-datepicker__nav">
			<div class="ui-datepicker__nav-btns ui-datepicker__nav-btns--lead">
				{step(-12, "Previous year", "chevrons-left")}
				{step(-1, "Previous month", "chevron-left")}
			</div>

			{props.compact
				? <div class="ui-datepicker__nav-spacer" />
				: (
					<div class="ui-datepicker__nav-selects">
						<Select
							class="ui-field--bare ui-datepicker__nav-select"
							size="sm"
							aria-label="Month"
							options={MONTH_OPTIONS}
							value={monthValue}
							filter
							filterPlaceholder="Month"
							virtualScroll
							virtualItemSize={NAV_ROW_H}
							onValueChange={onPickMonth}
						/>
						<Select
							class="ui-field--bare ui-datepicker__nav-select"
							size="sm"
							aria-label="Year"
							options={yearOptions}
							value={yearValue}
							filter
							filterPlaceholder="Year"
							virtualScroll
							virtualItemSize={NAV_ROW_H}
							onValueChange={onPickYear}
						/>
					</div>
				)}

			<div class="ui-datepicker__nav-btns ui-datepicker__nav-btns--trail">
				{step(1, "Next month", "chevron-right")}
				{step(12, "Next year", "chevrons-right")}
			</div>
		</div>
	);
}

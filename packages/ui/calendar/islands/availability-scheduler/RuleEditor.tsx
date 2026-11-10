import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import { Tooltip } from "../../../feedback/islands/Tooltip.tsx";
import { Button } from "../../../fields/components/Button.tsx";
import { currencyAdornment, formatMoneyInput } from "../../../fields/core/money-input.ts";
import { DatePicker } from "../../../fields/islands/DatePicker.tsx";
import { InputText } from "../../../fields/islands/InputText.tsx";
import { MoneyInput } from "../../../fields/islands/MoneyInput.tsx";
import { NumberInput } from "../../../fields/islands/NumberInput.tsx";
import { Select } from "../../../fields/islands/Select.tsx";
import { SwatchPicker } from "../../../fields/islands/SwatchPicker.tsx";
import { WeekdayRail } from "../../../fields/islands/WeekdayRail.tsx";
import { Icon } from "../../../icons/components/Icon.tsx";
import { weekdayName } from "./announce.ts";
import {
	civilOf,
	clamp,
	dateOfCivil,
	DAY_MINUTES,
	daysInMonthOf,
	fmtMinutes,
	weekColumns,
	weekdayOf,
} from "./civil.ts";
import { pickOption, useScheduler } from "./context.ts";
import { MAX_BANDS } from "./reducer.ts";
import type {
	Band,
	RuleDraft,
	RuleEffect,
	RuleFee,
	RulePattern,
	RulePatternType,
	SchedulerPricing,
} from "./types.ts";

/**
 * RuleEditor — the open rule as a short form, read top to bottom as the sentence above it says it:
 * how often it repeats (`Every [2] [weeks]`), on which days (a weekday letter rail, a month-day
 * grid, or a weekday of the month), at what times, with what effect, between which dates, and in
 * which colour. Every rule is working hours (Decision #408), so the form names no layer. Every
 * control is a `@projective/ui/fields` control on the `bare` surface: no resting border or fill, a
 * tint on hover and the field halo on keyboard focus.
 *
 * The interval runs as far as the recurrence contract does (`RulePatternSchema`): days 1–30, weeks
 * 1–8, months 1–12, years 1–10. Every single day stays a weekly rule on all seven days; only a wider
 * gap is a daily one. The raw RRULE, the replace priority and — while the host passes `pricing`,
 * which it does only once paid calls are live — the rule's own call price sit behind a closed
 * Advanced disclosure.
 */

// #region Options
/** How often a rule repeats, as the editor offers it. */
type Unit = "day" | "week" | "month" | "year" | "once";

/** The widest interval the recurrence contract allows per unit; `1` means it takes none. */
const MAX_INTERVAL: Record<Unit, number> = { day: 30, week: 8, month: 12, year: 10, once: 1 };

const UNITS: { label: string; value: Unit }[] = [
	{ label: "Day", value: "day" },
	{ label: "Week", value: "week" },
	{ label: "Month", value: "month" },
	{ label: "Year", value: "year" },
	{ label: "Doesn't repeat", value: "once" },
];

const MONTH_MODES: { label: string; value: RulePatternType }[] = [
	{ label: "Dates of the month", value: "monthly_date" },
	{ label: "A weekday of the month", value: "monthly_weekday" },
];

const EFFECTS: { label: string; value: RuleEffect }[] = [
	{ label: "Add these hours", value: "add" },
	{ label: "Replace the day", value: "replace" },
	{ label: "Remove these hours", value: "subtract" },
];

const ORDINALS = [
	{ label: "First", value: "1" },
	{ label: "Second", value: "2" },
	{ label: "Third", value: "3" },
	{ label: "Fourth", value: "4" },
	{ label: "Last", value: "-1" },
];

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
	label: new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
		Date.UTC(2000, i, 1),
	),
	value: String(i + 1),
}));

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** The month-day grid: 1–31, then the last day of the month (`-1`). */
const MONTH_DAYS = [...Array.from({ length: 31 }, (_, i) => i + 1), -1];
// #endregion

// #region Helpers
/** A local signal that follows `value` whenever `key` changes — for controls bound to a Signal. */
function useSynced<T>(value: T, key: string = String(value)): Signal<T> {
	const sig = useSignal(value);
	useEffect(() => {
		sig.value = value;
	}, [key]);
	return sig;
}

function isEveryDay(p: RulePattern): boolean {
	return p.type === "weekly" && p.interval === 1 && p.days.length === 7;
}

/** The unit a pattern reads as; a weekly rule on every day reads as `day` only while that is asked. */
function unitOf(p: RulePattern, dayMode: boolean): Unit {
	switch (p.type) {
		case "daily":
			return "day";
		case "weekly":
			return dayMode && isEveryDay(p) ? "day" : "week";
		case "monthly_date":
		case "monthly_weekday":
			return "month";
		case "yearly":
			return "year";
		case "once":
			return "once";
	}
}

function intervalOf(p: RulePattern): number {
	return "interval" in p ? p.interval : 1;
}

/** The unit as it reads after "Every": singular, or plural past one. */
function unitWord(unit: Unit, interval: number): string {
	if (unit === "once") return "Doesn't repeat";
	return interval > 1 ? `${unit}s` : unit;
}

/** Every day is a weekly rule on all seven days; only a wider gap is a daily one. */
function dayPattern(interval: number): RulePattern {
	return interval > 1
		? { type: "daily", interval }
		: { type: "weekly", days: [...EVERY_DAY], interval: 1 };
}

/** The pattern a unit starts from, keeping what carries over (the interval, a weekly rule's days). */
function patternFor(unit: Unit, from: RulePattern, startsOn: string): RulePattern {
	const day = Number(startsOn.slice(8));
	const interval = clamp(intervalOf(from), 1, MAX_INTERVAL[unit]);
	switch (unit) {
		case "day":
			return dayPattern(interval);
		case "week":
			return {
				type: "weekly",
				days: from.type === "weekly" && !isEveryDay(from) ? from.days : [weekdayOf(startsOn)],
				interval,
			};
		case "month":
			return { type: "monthly_date", days: [day], interval };
		case "year":
			return { type: "yearly", month: Number(startsOn.slice(5, 7)), day, interval };
		case "once":
			return { type: "once", date: startsOn };
	}
}

/** Whether "skip when it falls on …" compiles for a pattern (plan §5.3). */
function takesCondition(type: RulePatternType): boolean {
	return type === "monthly_date" || type === "yearly";
}

/**
 * The times a band edge may take, on the grid's snap: `from`…`to` inclusive, plus the current value
 * when a drag left it off the grid, so the trigger always names what is stored.
 */
function timeOptions(from: number, to: number, step: number, current: number) {
	const values = new Set<number>();
	for (let m = Math.ceil(from / step) * step; m <= to; m += step) values.add(m);
	if (current >= from && current <= to) values.add(current);
	return [...values].sort((a, b) => a - b).map((m) => ({ label: fmtMinutes(m), value: String(m) }));
}

function monthDayName(day: number): string {
	return day === -1 ? "Last day" : `Day ${day}`;
}
// #endregion

// #region Time ranges
interface TimeRangeRowProps {
	band: Band;
	index: number;
	step: number;
	onChange: (band: Band) => void;
	onRemove: () => void;
}

/** One band as two time selects on the snap grid; moving the start past the end carries the end. */
function TimeRangeRow(props: TimeRangeRowProps): JSX.Element {
	const { band, index, step, onChange, onRemove } = props;
	const start = useSynced(String(band.start));
	const end = useSynced(String(band.end));
	const n = index + 1;
	return (
		<li class="ui-avsched__band-row">
			<Select
				size="sm"
				class="ui-field--bare ui-avsched__time"
				panelWidth="auto"
				options={timeOptions(0, DAY_MINUTES - step, step, band.start)}
				value={start}
				aria-label={`Time ${n} starts`}
				onValueChange={(v) => {
					const s = Number(v);
					onChange({ start: s, end: Math.min(DAY_MINUTES, Math.max(band.end, s + step)) });
				}}
			/>
			<span class="ui-avsched__to" aria-hidden="true">–</span>
			<Select
				size="sm"
				class="ui-field--bare ui-avsched__time"
				panelWidth="auto"
				options={timeOptions(band.start + step, DAY_MINUTES, step, band.end)}
				value={end}
				aria-label={`Time ${n} ends`}
				onValueChange={(v) => onChange({ start: band.start, end: Number(v) })}
			/>
			<Tooltip content="Remove" density="compact">
				<Button
					variant="text"
					size="sm"
					iconOnly
					class="ui-hit"
					icon={<Icon name="close" />}
					aria-label={`Remove time ${n}, ${fmtMinutes(band.start)} to ${fmtMinutes(band.end)}`}
					onClick={onRemove}
				/>
			</Tooltip>
		</li>
	);
}
// #endregion

// #region Day pickers
interface MonthDayGridProps {
	days: number[];
	labelledBy: string;
	onChange: (days: number[]) => void;
}

/**
 * The dates of the month as a seven-column grid of the same discs the weekday rail draws, with the
 * last day of the month after the 31st. A value the grid does not show (a stored `-2`, from a pasted
 * RRULE) is kept through every toggle. At least one date stays chosen.
 */
function MonthDayGrid(props: MonthDayGridProps): JSX.Element {
	const { days, labelledBy, onChange } = props;
	const chosen = new Set(days);
	const roving = useSignal<number | null>(null);
	const stop = roving.value ?? Math.max(0, MONTH_DAYS.findIndex((d) => chosen.has(d)));

	const toggle = (day: number) => {
		const next = new Set(chosen);
		if (next.has(day)) next.delete(day);
		else next.add(day);
		if (next.size === 0) return;
		onChange([...next].sort((a, b) => (a < 0 ? 99 - a : a) - (b < 0 ? 99 - b : b)));
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
		const at = buttons.indexOf(e.target as HTMLButtonElement);
		if (at < 0) return;
		const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
		const moves: Record<string, number> = {
			ArrowRight: rtl ? -1 : 1,
			ArrowLeft: rtl ? 1 : -1,
			ArrowDown: 7,
			ArrowUp: -7,
		};
		let next: number | null = e.key in moves ? at + moves[e.key] : null;
		if (e.key === "Home") next = 0;
		if (e.key === "End") next = buttons.length - 1;
		if (next === null) return;
		e.preventDefault();
		buttons[clamp(next, 0, buttons.length - 1)]?.focus();
	};

	return (
		<div
			class="ui-avsched__monthdays"
			role="group"
			aria-labelledby={labelledBy}
			onKeyDown={onKeyDown}
		>
			{MONTH_DAYS.map((day, i) => (
				<button
					key={day}
					type="button"
					class={day === -1
						? "ui-avsched__monthday ui-avsched__monthday--last"
						: "ui-avsched__monthday"}
					aria-pressed={chosen.has(day)}
					aria-label={monthDayName(day)}
					tabIndex={stop === i ? 0 : -1}
					onFocus={() => (roving.value = i)}
					onClick={() => toggle(day)}
				>
					<span aria-hidden="true">{day === -1 ? "Last" : day}</span>
				</button>
			))}
		</div>
	);
}
// #endregion

// #region Recurrence
interface PatternFieldsProps {
	rule: RuleDraft;
	patch: (p: Partial<RuleDraft>) => void;
	ids: (part: string) => string;
	/** Whether a weekly rule on every day reads as "Every day" (seeded per rule, kept while editing). */
	dayMode: Signal<boolean>;
}

/** `Every [n] [unit]`: the interval where the unit takes one, and the unit itself. */
function RepeatsField({ rule, patch, ids, dayMode }: PatternFieldsProps): JSX.Element {
	const p = rule.pattern;
	const unit = unitOf(p, dayMode.value);
	const interval = intervalOf(p);
	const unitValue = useSynced<string>(unit);
	const intervalValue = useSynced<number | null>(interval);
	const takesInterval = MAX_INTERVAL[unit] > 1;

	const setUnit = (next: Unit) => {
		dayMode.value = next === "day";
		if (next === unit) return;
		const pattern = patternFor(next, p, rule.startsOn);
		patch({
			pattern,
			condition: takesCondition(pattern.type) ? rule.condition : { unlessWeekdays: [] },
			endsOn: next === "once" ? null : rule.endsOn,
		});
	};

	return (
		<div class="ui-avsched__field" role="group" aria-labelledby={ids("repeats")}>
			<span class="ui-avsched__label" id={ids("repeats")}>Repeats</span>
			<div class="ui-avsched__line">
				{unit !== "once" && <span class="ui-avsched__word" aria-hidden="true">Every</span>}
				{takesInterval && (
					<NumberInput
						size="sm"
						variant="bare"
						class="ui-avsched__interval"
						value={intervalValue}
						min={1}
						max={MAX_INTERVAL[unit]}
						step={1}
						maxFractionDigits={0}
						arrowBounds={false}
						aria-label={`Every how many ${unit}s`}
						onValueChange={(n) => {
							if (n === null || !("interval" in p)) return;
							const next = clamp(Math.round(n), 1, MAX_INTERVAL[unit]);
							if (next === p.interval) return;
							patch({ pattern: unit === "day" ? dayPattern(next) : { ...p, interval: next } });
						}}
					/>
				)}
				<Select
					size="sm"
					class="ui-field--bare ui-avsched__unit"
					panelWidth="auto"
					options={UNITS}
					value={unitValue}
					valueTemplate={(opt) => unitWord(opt.value as Unit, interval)}
					aria-label="Repeats every"
					onValueChange={(v) => {
						const next = pickOption(UNITS, v);
						if (next) setUnit(next);
					}}
				/>
			</div>
		</div>
	);
}

/** Which days the rule falls on, in the shape its unit asks for; nothing for an every-day rule. */
function OnField({ rule, patch, ids, dayMode }: PatternFieldsProps): JSX.Element | null {
	const p = rule.pattern;
	const { locale, weekStartsOn } = useScheduler();
	const weekDays = useSynced(
		p.type === "weekly" ? p.days : [],
		p.type === "weekly" ? p.days.join(",") : "",
	);
	const monthMode = useSynced<string>(p.type === "monthly_weekday" ? p.type : "monthly_date");
	const ordinal = useSynced(p.type === "monthly_weekday" ? String(p.ordinal) : "1");
	const weekday = useSynced(p.type === "monthly_weekday" ? String(p.weekday) : "1");
	const month = useSynced(p.type === "yearly" ? String(p.month) : "1");
	const yearDay = useSynced<number | null>(p.type === "yearly" ? p.day : 1);
	const date = useSynced<Date | null>(
		dateOfCivil(p.type === "once" ? p.date : null),
		p.type === "once" ? p.date : "",
	);
	const weekdayOptions = weekColumns(weekStartsOn).map((d) => ({
		label: weekdayName(d, locale, "long"),
		value: String(d),
	}));
	const label = <span class="ui-avsched__label" id={ids("on")}>On</span>;

	switch (p.type) {
		case "daily":
			return null;
		case "weekly":
			if (unitOf(p, dayMode.value) === "day") return null;
			return (
				<div class="ui-avsched__field">
					{label}
					<WeekdayRail
						size="sm"
						value={weekDays}
						weekStartsOn={weekStartsOn}
						locale={locale}
						min={1}
						aria-label="Repeats on"
						onValueChange={(days) => patch({ pattern: { ...p, days } })}
					/>
				</div>
			);
		case "monthly_date":
		case "monthly_weekday":
			return (
				<div class="ui-avsched__field" role="group" aria-labelledby={ids("on")}>
					{label}
					<Select
						size="sm"
						class="ui-field--bare ui-avsched__mode"
						panelWidth="auto"
						options={MONTH_MODES}
						value={monthMode}
						aria-label="Repeats on"
						onValueChange={(v) => {
							const next = pickOption(MONTH_MODES, v);
							if (!next || next === p.type) return;
							const day = Number(rule.startsOn.slice(8));
							const interval = intervalOf(p);
							patch({
								pattern: next === "monthly_date"
									? { type: "monthly_date", days: [day], interval }
									: {
										type: "monthly_weekday",
										ordinal: Math.min(4, Math.ceil(day / 7)),
										weekday: weekdayOf(rule.startsOn),
										interval,
									},
								condition: next === "monthly_date" ? rule.condition : { unlessWeekdays: [] },
							});
						}}
					/>
					{p.type === "monthly_date"
						? (
							<MonthDayGrid
								days={p.days}
								labelledBy={ids("on")}
								onChange={(days) => patch({ pattern: { ...p, days } })}
							/>
						)
						: (
							<div class="ui-avsched__line">
								<span class="ui-avsched__word" aria-hidden="true">The</span>
								<Select
									size="sm"
									class="ui-field--bare"
									panelWidth="auto"
									options={ORDINALS}
									value={ordinal}
									aria-label="Which week of the month"
									onValueChange={(v) => patch({ pattern: { ...p, ordinal: Number(v) } })}
								/>
								<Select
									size="sm"
									class="ui-field--bare"
									panelWidth="auto"
									options={weekdayOptions}
									value={weekday}
									aria-label="Weekday"
									onValueChange={(v) => patch({ pattern: { ...p, weekday: Number(v) } })}
								/>
							</div>
						)}
				</div>
			);
		case "yearly":
			return (
				<div class="ui-avsched__field" role="group" aria-labelledby={ids("on")}>
					{label}
					<div class="ui-avsched__line">
						<NumberInput
							size="sm"
							variant="bare"
							class="ui-avsched__interval"
							value={yearDay}
							min={1}
							max={daysInMonthOf(p.month)}
							step={1}
							maxFractionDigits={0}
							arrowBounds={false}
							aria-label="Day of the month"
							onValueChange={(n) => {
								if (n === null) return;
								const day = clamp(Math.round(n), 1, daysInMonthOf(p.month));
								if (day !== p.day) patch({ pattern: { ...p, day } });
							}}
						/>
						<Select
							size="sm"
							class="ui-field--bare"
							panelWidth="auto"
							options={MONTHS}
							value={month}
							aria-label="Month"
							onValueChange={(v) => {
								const m = Number(v);
								patch({ pattern: { ...p, month: m, day: Math.min(p.day, daysInMonthOf(m)) } });
							}}
						/>
					</div>
				</div>
			);
		case "once":
			return (
				<div class="ui-avsched__field">
					{label}
					<DatePicker
						size="sm"
						variant="bare"
						value={date}
						segmented={false}
						dateFormat="D, d M yyyy"
						firstDayOfWeek={weekStartsOn === 0 ? 0 : 1}
						aria-label="Date"
						onValueChange={(v) => {
							const picked = Array.isArray(v) ? v[0] : v;
							if (!picked) return;
							const iso = civilOf(picked);
							patch({ pattern: { type: "once", date: iso }, startsOn: iso, endsOn: null });
						}}
					/>
				</div>
			);
	}
}
// #endregion

// #region Price
/** A fee as the reader's money text, mark included: "£60.00". */
function feeText(fee: RuleFee, locale: string): string {
	const mark = currencyAdornment(fee.currency, locale);
	const amount = formatMoneyInput(fee.amountMinor, fee.currency, locale);
	return mark.position === "start" ? `${mark.symbol}${amount}` : `${amount} ${mark.symbol}`;
}

interface PriceFieldProps {
	rule: RuleDraft;
	patch: (p: Partial<RuleDraft>) => void;
	ids: (part: string) => string;
	pricing: SchedulerPricing;
}

/**
 * The rule's own price for a paid call that starts inside its bands (Decision #408). Empty inherits
 * the host's call price, which the line under the field names.
 */
function PriceField({ rule, patch, ids, pricing }: PriceFieldProps): JSX.Element {
	const { locale } = useScheduler();
	const currency = rule.fee?.currency ?? pricing.currency;
	const amount = useSynced<number | null>(
		rule.fee?.amountMinor ?? null,
		rule.fee ? `${rule.fee.amountMinor}${rule.fee.currency}` : "",
	);
	const inherited = pricing.inherited;
	return (
		<div class="ui-avsched__field">
			<span class="ui-avsched__label" aria-hidden="true">Call price</span>
			<MoneyInput
				size="sm"
				variant="bare"
				class="ui-avsched__price"
				currency={currency}
				locale={locale}
				value={amount}
				min={1}
				placeholder={inherited
					? formatMoneyInput(inherited.amountMinor, currency, locale)
					: undefined}
				aria-label="Paid call price for this rule"
				aria-describedby={ids("price-inherit")}
				onValueChange={(minor) =>
					patch({ fee: minor === null || minor <= 0 ? null : { amountMinor: minor, currency } })}
			/>
			<p class="ui-avsched__meta" id={ids("price-inherit")}>
				{inherited
					? `Empty charges your call price, ${feeText(inherited, locale)}.`
					: "Empty charges your call price."}
			</p>
		</div>
	);
}
// #endregion

// #region Advanced
/** The rule's call price (while paid calls are live), the raw RRULE and the replace priority. */
function Advanced(
	{ rule, patch, ids }: Pick<PatternFieldsProps, "rule" | "patch" | "ids">,
): JSX.Element {
	const { store, pricing } = useScheduler();
	const written = store.engine.draftToRRule(rule);
	const compiled = written.ok ? written.rrule : "";
	const text = useSynced(compiled);
	const priority = useSynced<number | null>(rule.priority);
	const error = useSignal<string | null>(null);

	const apply = () => {
		const reading = store.engine.parseRRule(text.value, rule.startsOn);
		if (!reading.ok) {
			error.value = reading.message;
			return;
		}
		error.value = null;
		patch({ pattern: reading.pattern, condition: reading.condition, endsOn: reading.endsOn });
	};

	return (
		<details class="ui-avsched__advanced">
			<summary class="ui-avsched__advanced-toggle">
				<span>Advanced</span>
				<Icon name="chevron-down" size="sm" class="ui-avsched__advanced-caret" />
			</summary>
			<div class="ui-avsched__advanced-body">
				{pricing && rule.effect !== "subtract" && (
					<PriceField rule={rule} patch={patch} ids={ids} pricing={pricing} />
				)}
				{rule.effect === "replace" && (
					<div class="ui-avsched__field">
						<span class="ui-avsched__label" aria-hidden="true">Priority</span>
						<NumberInput
							size="sm"
							variant="bare"
							class="ui-avsched__interval"
							value={priority}
							min={0}
							max={99}
							step={1}
							maxFractionDigits={0}
							arrowBounds={false}
							aria-label="Priority, 0 to 99; the higher replace rule wins"
							onValueChange={(n) => {
								if (n === null) return;
								const next = clamp(Math.round(n), 0, 99);
								if (next !== rule.priority) patch({ priority: next });
							}}
						/>
					</div>
				)}
				<div class="ui-avsched__field">
					<span class="ui-avsched__label" aria-hidden="true">RRULE</span>
					<InputText
						size="sm"
						variant="bare"
						class="ui-avsched__rrule"
						value={text}
						aria-label="RRULE"
						fluid
						status={error.value ? "invalid" : "default"}
						onValueChange={() => {
							error.value = null;
						}}
					/>
					<Button
						severity="neutral"
						variant="outlined"
						size="sm"
						label="Apply RRULE"
						class="ui-avsched__apply"
						disabled={text.value.trim() === compiled}
						onClick={apply}
					/>
					{error.value && (
						<p class="ui-avsched__issue ui-avsched__issue--error" role="alert">{error.value}</p>
					)}
				</div>
			</div>
		</details>
	);
}
// #endregion

// #region RuleEditor
interface RuleFormProps {
	rule: RuleDraft;
}

function RuleForm({ rule }: RuleFormProps): JSX.Element {
	const { store, idBase, locale, weekStartsOn } = useScheduler();
	const ids = (part: string) => `${idBase}-rule-${part}`;
	const patch = (p: Partial<RuleDraft>) => {
		const current = store.draft.peek().rules.find((r) => r.id === rule.id);
		if (current) store.upsertRule({ ...current, ...p });
	};
	const effect = useSynced<string>(rule.effect);
	const colour = useSynced<string | null>(rule.colorToken, rule.colorToken ?? "");
	const label = useSynced(rule.label);
	const startsOn = useSynced<Date | null>(dateOfCivil(rule.startsOn), rule.startsOn);
	const endsOn = useSynced<Date | null>(dateOfCivil(rule.endsOn), rule.endsOn ?? "");
	const unlessDays = useSynced(
		rule.condition.unlessWeekdays,
		rule.condition.unlessWeekdays.join(","),
	);
	const dayMode = useSignal(unitOf(rule.pattern, true) === "day");
	const written = store.engine.draftToRRule(rule);
	const step = store.snap.value;
	const firstDay = weekStartsOn === 0 ? 0 : 1;

	const setBands = (bands: Band[]) => patch({ bands });
	const addBand = () => {
		const last = rule.bands[rule.bands.length - 1];
		const start = last ? Math.min(last.end, DAY_MINUTES - 60) : 9 * 60;
		setBands([...rule.bands, { start, end: Math.min(start + 60, DAY_MINUTES) }]);
	};

	return (
		<div class="ui-avsched__form">
			<p class="ui-avsched__sentence">{store.engine.describe(rule)}</p>
			{!written.ok && (
				<p class="ui-avsched__issue ui-avsched__issue--error" role="alert">{written.message}</p>
			)}

			<RepeatsField rule={rule} patch={patch} ids={ids} dayMode={dayMode} />
			<OnField rule={rule} patch={patch} ids={ids} dayMode={dayMode} />

			{takesCondition(rule.pattern.type) && (
				<div class="ui-avsched__field">
					<span class="ui-avsched__label" id={ids("unless")}>Skip when it falls on</span>
					<WeekdayRail
						size="sm"
						value={unlessDays}
						weekStartsOn={weekStartsOn}
						locale={locale}
						min={0}
						max={6}
						aria-label="Skip when it falls on"
						onValueChange={(unlessWeekdays) => patch({ condition: { unlessWeekdays } })}
					/>
				</div>
			)}

			<div class="ui-avsched__field" role="group" aria-labelledby={ids("times")}>
				<span class="ui-avsched__label" id={ids("times")}>Times</span>
				{rule.bands.length
					? (
						<ul class="ui-avsched__band-list">
							{rule.bands.map((band, i) => (
								<TimeRangeRow
									key={i}
									band={band}
									index={i}
									step={step}
									onChange={(b) => setBands(rule.bands.map((x, j) => j === i ? b : x))}
									onRemove={() => setBands(rule.bands.filter((_, j) => j !== i))}
								/>
							))}
						</ul>
					)
					: (
						<p class="ui-avsched__meta">
							{rule.effect === "subtract" ? "No times: the whole day is removed." : "No times yet."}
						</p>
					)}
				{rule.bands.length < MAX_BANDS && (
					<Tooltip content="Add time" density="compact">
						<Button
							variant="text"
							size="sm"
							iconOnly
							class="ui-hit ui-avsched__add-time"
							aria-label="Add time"
							icon={<Icon name="plus" />}
							onClick={addBand}
						/>
					</Tooltip>
				)}
			</div>

			<div class="ui-avsched__field">
				<span class="ui-avsched__label" aria-hidden="true">Effect</span>
				<Select
					size="sm"
					class="ui-field--bare"
					panelWidth="auto"
					options={EFFECTS}
					value={effect}
					aria-label="Effect"
					fluid
					onValueChange={(v) => {
						const next = pickOption(EFFECTS, v);
						if (!next) return;
						patch(
							next === "subtract"
								? { effect: next, fee: null, colorToken: null }
								: { effect: next },
						);
					}}
				/>
			</div>

			{rule.pattern.type !== "once" && (
				<div class="ui-avsched__pair">
					<div class="ui-avsched__field">
						<span class="ui-avsched__label" aria-hidden="true">Starts</span>
						<DatePicker
							size="sm"
							variant="bare"
							value={startsOn}
							segmented={false}
							dateFormat="d M yyyy"
							firstDayOfWeek={firstDay}
							maxDate={dateOfCivil(rule.endsOn) ?? undefined}
							aria-label="Starts on"
							fluid
							onValueChange={(v) => {
								const picked = Array.isArray(v) ? v[0] : v;
								if (picked) patch({ startsOn: civilOf(picked) });
							}}
						/>
					</div>
					<div class="ui-avsched__field">
						<span class="ui-avsched__label" aria-hidden="true">Ends</span>
						<DatePicker
							size="sm"
							variant="bare"
							value={endsOn}
							segmented={false}
							dateFormat="d M yyyy"
							placeholder="Never"
							showButtonBar
							firstDayOfWeek={firstDay}
							minDate={dateOfCivil(rule.startsOn) ?? undefined}
							aria-label="Ends on, empty for never"
							fluid
							onValueChange={(v) => {
								const picked = Array.isArray(v) ? v[0] : v;
								patch({ endsOn: picked ? civilOf(picked) : null });
							}}
						/>
					</div>
				</div>
			)}

			<div class="ui-avsched__field">
				<span class="ui-avsched__label" aria-hidden="true">Label</span>
				<InputText
					size="sm"
					variant="bare"
					value={label}
					maxLength={80}
					aria-label="Label"
					placeholder="Optional, e.g. Summer hours"
					fluid
					onValueChange={(v) => patch({ label: v })}
				/>
			</div>

			{rule.effect !== "subtract" && (
				<div class="ui-avsched__field">
					<span class="ui-avsched__label" id={ids("colour")}>Colour</span>
					<SwatchPicker
						size="sm"
						value={colour}
						aria-labelledby={ids("colour")}
						onValueChange={(token) => patch({ colorToken: token })}
					/>
				</div>
			)}

			<Advanced rule={rule} patch={patch} ids={ids} />
		</div>
	);
}

/** Repeats · on · times · effect · dates · label · colour for the open rule, with its sentence. */
export function RuleEditor(): JSX.Element {
	const { store } = useScheduler();
	const editing = store.editing.value;
	const rule = editing ? store.draft.value.rules.find((r) => r.id === editing) : undefined;

	return (
		<div class="ui-avsched__editor">
			<div class="ui-avsched__section-head">
				<h3 class="ui-avsched__heading">{rule ? "Edit rule" : "Rule"}</h3>
				{rule && (
					<Tooltip content="Close" density="compact">
						<Button
							variant="text"
							size="sm"
							iconOnly
							class="ui-hit"
							icon={<Icon name="close" />}
							aria-label="Close rule"
							onClick={() => store.dispatch({ type: "edit", ruleId: null })}
						/>
					</Tooltip>
				)}
			</div>
			{rule ? <RuleForm key={rule.id} rule={rule} /> : (
				<p class="ui-avsched__meta">
					Select a rule, or press Enter on a band, to edit its pattern, times and dates.
				</p>
			)}
		</div>
	);
}
// #endregion

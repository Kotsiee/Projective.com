import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import { Tooltip } from "../../../feedback/islands/Tooltip.tsx";
import { Button } from "../../../fields/components/Button.tsx";
import { InputMask } from "../../../fields/islands/InputMask.tsx";
import { InputText } from "../../../fields/islands/InputText.tsx";
import { Select } from "../../../fields/islands/Select.tsx";
import { SelectButton } from "../../../fields/islands/SelectButton.tsx";
import { Icon } from "../../../icons/components/Icon.tsx";
import { weekdayName } from "./announce.ts";
import {
	clamp,
	DAY_MINUTES,
	fmtMinutes,
	isIsoDate,
	parseMinutes,
	weekColumns,
	weekdayOf,
} from "./civil.ts";
import { pickOption, useScheduler } from "./context.ts";
import { MAX_BANDS } from "./reducer.ts";
import type { Band, Layer, RuleDraft, RuleEffect, RulePattern, RulePatternType } from "./types.ts";

// #region Options
const PATTERNS: { label: string; value: RulePatternType }[] = [
	{ label: "Weekly", value: "weekly" },
	{ label: "Monthly by date", value: "monthly_date" },
	{ label: "Monthly by weekday", value: "monthly_weekday" },
	{ label: "Yearly", value: "yearly" },
	{ label: "One date", value: "once" },
];
const EFFECTS: { label: string; value: RuleEffect }[] = [
	{ label: "Add", value: "add" },
	{ label: "Replace the day", value: "replace" },
	{ label: "Remove", value: "subtract" },
];
const LAYERS: { label: string; value: Layer }[] = [
	{ label: "Working hours", value: "working_hours" },
	{ label: "Calls", value: "call_window" },
];
const WEEK_INTERVALS = [1, 2, 3, 4].map((n) => ({
	label: n === 1 ? "Every week" : `Every ${n} weeks`,
	value: String(n),
}));
const MONTH_INTERVALS = [1, 2, 3, 6, 12].map((n) => ({
	label: n === 1 ? "Every month" : `Every ${n} months`,
	value: String(n),
}));
const ORDINALS = [
	{ label: "1st", value: "1" },
	{ label: "2nd", value: "2" },
	{ label: "3rd", value: "3" },
	{ label: "4th", value: "4" },
	{ label: "Last", value: "-1" },
];
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
	label: new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
		Date.UTC(2000, i, 1),
	),
	value: String(i + 1),
}));
// #endregion

// #region Helpers
function useSynced<T>(value: T, key: string = String(value)): Signal<T> {
	const sig = useSignal(value);
	useEffect(() => {
		sig.value = value;
	}, [key]);
	return sig;
}

function defaultPattern(type: RulePatternType, startsOn: string): RulePattern {
	const day = Number(startsOn.slice(8));
	const weekday = weekdayOf(startsOn);
	switch (type) {
		case "weekly":
			return { type, days: [weekday], interval: 1 };
		case "monthly_date":
			return { type, days: [day], interval: 1 };
		case "monthly_weekday":
			return { type, ordinal: Math.min(4, Math.ceil(day / 7)), weekday, interval: 1 };
		case "yearly":
			return { type, month: Number(startsOn.slice(5, 7)), day };
		case "once":
			return { type, date: startsOn };
	}
}

function parseMonthDays(text: string): number[] | null {
	const parts = text.split(/[\s,]+/).filter(Boolean);
	if (!parts.length) return null;
	const days = parts.map(Number);
	const ok = days.every((d) => Number.isInteger(d) && d !== 0 && d >= -31 && d <= 31);
	return ok && new Set(days).size === days.length ? days : null;
}

/** Whether "unless it's …" compiles for a pattern (plan §5.3). */
function takesCondition(type: RulePatternType): boolean {
	return type === "monthly_date" || type === "yearly";
}
// #endregion

// #region TimeRangeField
interface TimeFieldProps {
	minute: number;
	label: string;
	min: number;
	max: number;
	step: number;
	onCommit: (minute: number) => void;
}

function TimeField(props: TimeFieldProps): JSX.Element {
	const { minute, label, min, max, step, onCommit } = props;
	const text = useSynced(fmtMinutes(minute));
	const parsed = parseMinutes(text.value);
	const complete = /^\d{2}:\d{2}$/.test(text.value);
	const invalid = complete && (parsed === null || parsed < min || parsed > max);

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLSpanElement>) => {
		if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
		e.preventDefault();
		const next = clamp(minute + (e.key === "ArrowUp" ? step : -step), min, max);
		if (next !== minute) onCommit(next);
	};

	return (
		<span class="ui-avsched__time" onKeyDown={onKeyDown}>
			<InputMask
				mask="99:99"
				size="sm"
				value={text}
				aria-label={label}
				status={invalid ? "invalid" : "default"}
				onValueChange={(v) => {
					const m = parseMinutes(v);
					if (m !== null && m >= min && m <= max && m !== minute) onCommit(m);
				}}
			/>
		</span>
	);
}

interface TimeRangeFieldProps {
	band: Band;
	index: number;
	step: number;
	onChange: (band: Band) => void;
	onRemove: () => void;
}

function TimeRangeField(props: TimeRangeFieldProps): JSX.Element {
	const { band, index, step, onChange, onRemove } = props;
	return (
		<li class="ui-avsched__band-row">
			<TimeField
				minute={band.start}
				label={`Time ${index + 1} starts`}
				min={0}
				max={band.end - 5}
				step={step}
				onCommit={(start) => onChange({ start, end: band.end })}
			/>
			<span class="ui-avsched__to" aria-hidden="true">to</span>
			<TimeField
				minute={band.end}
				label={`Time ${index + 1} ends`}
				min={band.start + 5}
				max={DAY_MINUTES}
				step={step}
				onCommit={(end) => onChange({ start: band.start, end })}
			/>
			<Tooltip content="Remove">
				<Button
					variant="text"
					size="sm"
					iconOnly
					class="ui-hit"
					icon={<Icon name="close" />}
					aria-label={`Remove time ${index + 1}, ${fmtMinutes(band.start)} to ${
						fmtMinutes(band.end)
					}`}
					onClick={onRemove}
				/>
			</Tooltip>
		</li>
	);
}
// #endregion

// #region Pattern fields
interface PatternFieldsProps {
	rule: RuleDraft;
	patch: (p: Partial<RuleDraft>) => void;
}

interface WeekdayPickerProps {
	label: string;
	days: number[];
	max?: number;
	allowEmpty?: boolean;
	onChange: (days: number[]) => void;
}

function WeekdayPicker(props: WeekdayPickerProps): JSX.Element {
	const { locale, weekStartsOn } = useScheduler();
	const value = useSynced(props.days.map(String), props.days.join(","));
	const options = weekColumns(weekStartsOn).map((d) => ({
		label: weekdayName(d, locale, "short"),
		value: String(d),
	}));
	return (
		<SelectButton
			multiple
			size="sm"
			options={options}
			value={value}
			aria-label={props.label}
			onValueChange={(v) => {
				const days = (Array.isArray(v) ? v : [v]).map(Number).sort((a, b) => a - b);
				if (!days.length && !props.allowEmpty) return;
				if (props.max !== undefined && days.length > props.max) return;
				props.onChange(days);
			}}
		/>
	);
}

interface IntervalPickerProps extends PatternFieldsProps {
	interval: number;
	months: boolean;
}

function IntervalPicker(props: IntervalPickerProps): JSX.Element {
	const value = useSynced(String(props.interval));
	return (
		<SelectButton
			size="sm"
			options={props.months ? MONTH_INTERVALS : WEEK_INTERVALS}
			value={value}
			aria-label="Repeats"
			onValueChange={(v) => {
				const p = props.rule.pattern;
				if (p.type === "weekly" || p.type === "monthly_date" || p.type === "monthly_weekday") {
					props.patch({ pattern: { ...p, interval: Number(v) } });
				}
			}}
		/>
	);
}

function MonthDaysField({ rule, patch }: PatternFieldsProps): JSX.Element | null {
	const days = rule.pattern.type === "monthly_date" ? rule.pattern.days : [];
	const text = useSynced(days.join(", "));
	const parsed = parseMonthDays(text.value);
	return (
		<InputText
			size="sm"
			value={text}
			aria-label="Days of the month (negative counts from the end)"
			placeholder="1, 15, -1"
			status={parsed ? "default" : "invalid"}
			onValueChange={(v) => {
				const next = parseMonthDays(v);
				if (next && rule.pattern.type === "monthly_date") {
					patch({ pattern: { ...rule.pattern, days: next } });
				}
			}}
		/>
	);
}

function PatternFields({ rule, patch }: PatternFieldsProps): JSX.Element {
	const p = rule.pattern;
	const { locale, weekStartsOn } = useScheduler();
	const ordinal = useSynced(p.type === "monthly_weekday" ? String(p.ordinal) : "1");
	const weekday = useSynced(p.type === "monthly_weekday" ? String(p.weekday) : "1");
	const month = useSynced(p.type === "yearly" ? String(p.month) : "1");
	const yearDay = useSynced(p.type === "yearly" ? String(p.day) : "1");
	const date = useSynced(p.type === "once" ? p.date : "");
	const weekdayOptions = weekColumns(weekStartsOn).map((d) => ({
		label: weekdayName(d, locale, "short"),
		value: String(d),
	}));

	switch (p.type) {
		case "weekly":
			return (
				<>
					<WeekdayPicker
						label="Days"
						days={p.days}
						onChange={(days) => patch({ pattern: { ...p, days } })}
					/>
					<IntervalPicker rule={rule} interval={p.interval} months={false} patch={patch} />
				</>
			);
		case "monthly_date":
			return (
				<>
					<MonthDaysField rule={rule} patch={patch} />
					<IntervalPicker rule={rule} interval={p.interval} months patch={patch} />
				</>
			);
		case "monthly_weekday":
			return (
				<>
					<SelectButton
						size="sm"
						options={ORDINALS}
						value={ordinal}
						aria-label="Which week"
						onValueChange={(v) => patch({ pattern: { ...p, ordinal: Number(v) } })}
					/>
					<SelectButton
						size="sm"
						options={weekdayOptions}
						value={weekday}
						aria-label="Weekday"
						onValueChange={(v) => patch({ pattern: { ...p, weekday: Number(v) } })}
					/>
					<IntervalPicker rule={rule} interval={p.interval} months patch={patch} />
				</>
			);
		case "yearly":
			return (
				<>
					<Select
						size="sm"
						options={MONTHS}
						value={month}
						aria-label="Month"
						onValueChange={(v) => patch({ pattern: { ...p, month: Number(v) } })}
					/>
					<InputText
						size="sm"
						value={yearDay}
						aria-label="Day of the month"
						onValueChange={(v) => {
							const day = Number(v);
							if (Number.isInteger(day) && day >= 1 && day <= 31) patch({ pattern: { ...p, day } });
						}}
					/>
				</>
			);
		case "once":
			return (
				<InputMask
					mask="9999-99-99"
					size="sm"
					value={date}
					aria-label="Date (YYYY-MM-DD)"
					onValueChange={(v) => {
						if (isIsoDate(v)) {
							patch({
								pattern: { type: "once", date: v },
								startsOn: v,
								endsOn: null,
							});
						}
					}}
				/>
			);
	}
}
// #endregion

// #region Advanced
function AdvancedRRule({ rule, patch }: PatternFieldsProps): JSX.Element {
	const { store } = useScheduler();
	const written = store.engine.draftToRRule(rule);
	const compiled = written.ok ? written.rrule : "";
	const text = useSynced(compiled);
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
			<summary class="ui-avsched__advanced-toggle">Advanced</summary>
			<div class="ui-avsched__advanced-body">
				<InputText
					size="sm"
					value={text}
					aria-label="RRULE"
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
					disabled={text.value.trim() === compiled}
					onClick={apply}
				/>
				{error.value && (
					<p class="ui-avsched__issue ui-avsched__issue--error" role="alert">{error.value}</p>
				)}
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
	const { store } = useScheduler();
	const patch = (p: Partial<RuleDraft>) => {
		const current = store.draft.peek().rules.find((r) => r.id === rule.id);
		if (current) store.upsertRule({ ...current, ...p });
	};
	const type = useSynced<string>(rule.pattern.type);
	const effect = useSynced<string>(rule.effect);
	const layer = useSynced<string>(rule.layer);
	const label = useSynced(rule.label);
	const startsOn = useSynced(rule.startsOn);
	const endsOn = useSynced(rule.endsOn ?? "");
	const priority = useSynced(String(rule.priority));
	const written = store.engine.draftToRRule(rule);
	const step = store.snap.value;

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

			<div class="ui-avsched__field" role="group" aria-label="Pattern">
				<span class="ui-avsched__label" aria-hidden="true">Pattern</span>
				<SelectButton
					size="sm"
					options={PATTERNS}
					value={type}
					aria-label="Pattern"
					onValueChange={(v) => {
						const next = pickOption(PATTERNS, v);
						if (!next) return;
						patch({
							pattern: defaultPattern(next, rule.startsOn),
							condition: takesCondition(next) ? rule.condition : { unlessWeekdays: [] },
							endsOn: next === "once" ? null : rule.endsOn,
						});
					}}
				/>
				<PatternFields rule={rule} patch={patch} />
			</div>

			{takesCondition(rule.pattern.type) && (
				<div class="ui-avsched__field" role="group" aria-label="Unless it's">
					<span class="ui-avsched__label" aria-hidden="true">Unless it's…</span>
					<WeekdayPicker
						label="Unless it's"
						days={rule.condition.unlessWeekdays}
						max={6}
						allowEmpty
						onChange={(unlessWeekdays) =>
							patch({ condition: { unlessWeekdays } })}
					/>
				</div>
			)}

			<div class="ui-avsched__field" role="group" aria-label="Times">
				<span class="ui-avsched__label" aria-hidden="true">Times</span>
				{rule.bands.length
					? (
						<ul class="ui-avsched__band-list">
							{rule.bands.map((band, i) => (
								<TimeRangeField
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
					<Tooltip content="Add time">
						<Button
							variant="text"
							size="sm"
							iconOnly
							class="ui-hit"
							aria-label="Add time"
							icon={<Icon name="plus" />}
							onClick={addBand}
						/>
					</Tooltip>
				)}
			</div>

			<div class="ui-avsched__field" role="group" aria-label="Effect and layer">
				<span class="ui-avsched__label" aria-hidden="true">Effect</span>
				<SelectButton
					size="sm"
					options={EFFECTS}
					value={effect}
					aria-label="Effect"
					onValueChange={(v) => {
						const next = pickOption(EFFECTS, v);
						if (next) patch({ effect: next });
					}}
				/>
				<SelectButton
					size="sm"
					options={LAYERS}
					value={layer}
					aria-label="Layer"
					onValueChange={(v) => {
						const next = pickOption(LAYERS, v);
						if (next) patch({ layer: next });
					}}
				/>
				{rule.effect === "replace" && (
					<InputText
						size="sm"
						value={priority}
						aria-label="Priority (0–99, higher wins)"
						onValueChange={(v) => {
							const n = Number(v);
							if (Number.isInteger(n) && n >= 0 && n <= 99) patch({ priority: n });
						}}
					/>
				)}
			</div>

			{rule.pattern.type !== "once" && (
				<div class="ui-avsched__field" role="group" aria-label="Date range">
					<span class="ui-avsched__label" aria-hidden="true">From · until</span>
					<InputMask
						mask="9999-99-99"
						size="sm"
						value={startsOn}
						aria-label="Starts on (YYYY-MM-DD)"
						onValueChange={(v) => {
							if (isIsoDate(v)) {
								patch({ startsOn: v });
							}
						}}
					/>
					<InputMask
						mask="9999-99-99"
						size="sm"
						value={endsOn}
						aria-label="Ends on (YYYY-MM-DD, empty for no end)"
						onValueChange={(v) => {
							if (v === "") {
								patch({ endsOn: null });
							} else if (isIsoDate(v)) {
								patch({ endsOn: v });
							}
						}}
					/>
				</div>
			)}

			<div class="ui-avsched__field">
				<InputText
					size="sm"
					value={label}
					maxLength={80}
					aria-label="Label"
					placeholder="Label (optional)"
					onValueChange={(v) => patch({ label: v })}
				/>
			</div>

			<AdvancedRRule rule={rule} patch={patch} />
		</div>
	);
}

/** Pattern · condition · bands · effect · range for the rule being edited, with its sentence and RRULE. */
export function RuleEditor(): JSX.Element {
	const { store } = useScheduler();
	const editing = store.editing.value;
	const rule = editing ? store.draft.value.rules.find((r) => r.id === editing) : undefined;

	return (
		<div class="ui-avsched__editor">
			<div class="ui-avsched__section-head">
				<h3 class="ui-avsched__heading">{rule ? "Edit rule" : "Rule"}</h3>
				{rule && (
					<Tooltip content="Close">
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

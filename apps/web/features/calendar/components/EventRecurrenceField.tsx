import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
	Checkbox,
	DatePicker,
	NumberInput,
	NumberStepper,
	Select,
	SelectButton,
	WeekdayRail,
} from "@projective/ui/fields";
import type { CalendarEvent, IsoDate } from "@projective/types/scheduling";
import { addMonths, civilParts, isoDateOf } from "@projective/types/scheduling";
import {
	describeRepeat,
	fromRRule,
	isoWeekday,
	presetDraft,
	repeatAnchor,
	type RepeatDraft,
	type RepeatFreq,
	seriesOf,
	sundayWeekday,
	toRRule,
} from "../core/event-recurrence.ts";

/**
 * EventRecurrenceField — whether an entry repeats, and how.
 *
 * One checkbox, "Do not repeat", checked by default. Unchecked, the rule is laid out the way the
 * availability rule editor lays out its own (`RuleEditor`, Decision #379): `Every [n] [Day · Week ·
 * Month · Year]`, then for a weekly rule the days it falls `On` as a {@link WeekdayRail} that toggles a
 * day by click and a run of days by dragging across them, then how the series ends. Every control
 * writes the same thing — `recurrenceRule` on the working copy — and reads it back, so the fields can
 * never disagree with the rule.
 *
 * The sentence under them is the rule read aloud, in the Meta register and a polite live region, so a
 * keyboard user hears what each change did without leaving the control.
 */
export interface EventRecurrenceFieldProps {
	event: CalendarEvent;
	/** IANA display zone — the series is anchored to the start's civil date here. */
	tz: string;
	onPatch: (patch: Partial<CalendarEvent>) => void;
	/** A cadence with no entry behind it (a routine's), so there are no occurrences to speak of. */
	cadenceOnly?: boolean;
}

/**
 * A CONTROLLED binding that follows `value` whenever `key` changes. A raw value would be read once
 * by `useControllable` and freeze (EventMetaBar's `useInstantBinding` records the same trap), so a
 * control would keep showing the rule before the last change.
 */
function useBound<T>(value: T, key: string): Signal<T> {
	const bound = useSignal(value);
	useEffect(() => {
		bound.value = value;
	}, [key]);
	return bound;
}

const UNITS: { value: RepeatFreq; label: string }[] = [
	{ value: "DAILY", label: "Day" },
	{ value: "WEEKLY", label: "Week" },
	{ value: "MONTHLY", label: "Month" },
	{ value: "YEARLY", label: "Year" },
];
const UNIT_WORD: Record<RepeatFreq, string> = {
	DAILY: "day",
	WEEKLY: "week",
	MONTHLY: "month",
	YEARLY: "year",
};
const MAX_INTERVAL = 99;

function pickerDate(date: IsoDate): Date {
	const p = civilParts(date);
	return new Date(p.year, p.month - 1, p.day);
}

function unitWord(freq: RepeatFreq, interval: number): string {
	return interval > 1 ? `${UNIT_WORD[freq]}s` : UNIT_WORD[freq];
}

function isFreq(v: unknown): v is RepeatFreq {
	return UNITS.some((u) => u.value === v);
}

export function EventRecurrenceField(props: EventRecurrenceFieldProps): JSX.Element {
	const { event, tz, onPatch } = props;
	const anchor = repeatAnchor(event.start, tz);
	const rule = event.recurrenceRule;
	const draft = (rule ? fromRRule(rule) : null) ?? presetDraft("weekly", anchor);
	const series = rule && !props.cadenceOnly ? seriesOf(event, tz) : null;
	const key = rule ?? "";

	const once = useBound<boolean>(!rule, key);
	const freq = useBound<string>(draft.freq, key);
	const interval = useBound<number | null>(draft.interval, key);
	const days = useBound<number[]>(draft.isoDays.map(sundayWeekday), key);
	const endType = useBound<string>(draft.end.type, key);
	const until = useBound<Date | null>(
		draft.end.type === "until" ? pickerDate(draft.end.date) : null,
		key,
	);
	const count = useBound<number | null>(draft.end.type === "count" ? draft.end.count : 10, key);

	function setRule(next: RepeatDraft | null): void {
		onPatch({ recurrenceRule: next ? toRRule(next, anchor) : undefined });
	}

	function edit(next: Partial<RepeatDraft>): void {
		setRule({ ...draft, ...next });
	}

	return (
		<div class="evm-repeat">
			<Checkbox
				size="sm"
				label="Do not repeat"
				value={once}
				// Unticked, an entry starts from the plainest series — every week on its own weekday — so
				// the fields that appear show the rule in force rather than a preview of one.
				onValueChange={(on) => setRule(on ? null : presetDraft("weekly", anchor))}
			/>

			{rule
				? (
					<div class="evm-repeat__custom">
						<div class="evm-repeat__row" role="group" aria-label="Frequency">
							<span class="evm-repeat__word" aria-hidden="true">Every</span>
							<NumberInput
								size="sm"
								class="evm-repeat__interval"
								value={interval}
								min={1}
								max={MAX_INTERVAL}
								step={1}
								maxFractionDigits={0}
								aria-label={`Every how many ${UNIT_WORD[draft.freq]}s`}
								onValueChange={(n) => {
									if (n === null) return;
									const next = Math.min(MAX_INTERVAL, Math.max(1, Math.round(n)));
									if (next !== draft.interval) edit({ interval: next });
								}}
							/>
							<Select
								size="sm"
								value={freq}
								options={UNITS}
								panelWidth="auto"
								valueTemplate={(opt) =>
									isFreq(opt.value) ? unitWord(opt.value, draft.interval) : String(opt.label)}
								aria-label="Repeats every"
								onValueChange={(f) => {
									if (!isFreq(f) || f === draft.freq) return;
									edit({ freq: f, isoDays: f === "WEEKLY" ? [anchor.isoDay] : [] });
								}}
							/>
						</div>

						{draft.freq === "WEEKLY"
							? (
								<div class="evm-repeat__row">
									<span class="evm-repeat__k" aria-hidden="true">On</span>
									<WeekdayRail
										size="sm"
										value={days}
										min={1}
										aria-label="Repeats on"
										onValueChange={(next) =>
											edit({ isoDays: next.map(isoWeekday).sort((a, b) => a - b) })}
									/>
								</div>
							)
							: null}

						<div class="evm-repeat__row">
							<span class="evm-repeat__k">Ends</span>
							<SelectButton
								size="sm"
								value={endType}
								aria-label="Ends"
								options={[
									{ value: "never", label: "Never" },
									{ value: "until", label: "On a date" },
									{ value: "count", label: "After" },
								]}
								onValueChange={(t) =>
									edit({
										end: t === "until"
											? { type: "until", date: addMonths(anchor.date, 3) }
											: t === "count"
											? { type: "count", count: 10 }
											: { type: "never" },
									})}
							/>
							{draft.end.type === "until"
								? (
									<DatePicker
										size="sm"
										value={until}
										minDate={pickerDate(anchor.date)}
										aria-label="Last date"
										onValueChange={(d) => {
											if (d instanceof Date) {
												edit({
													end: {
														type: "until",
														date: isoDateOf(d.getFullYear(), d.getMonth() + 1, d.getDate()),
													},
												});
											}
										}}
									/>
								)
								: null}
							{draft.end.type === "count"
								? (
									<NumberStepper
										size="sm"
										value={count}
										min={1}
										max={999}
										unit="times"
										aria-label="Number of occurrences"
										onValueChange={(n) => {
											if (n) edit({ end: { type: "count", count: n } });
											else count.value = draft.end.type === "count" ? draft.end.count : 10;
										}}
									/>
								)
								: null}
						</div>
					</div>
				)
				: null}

			<p class="evm-repeat__sentence" aria-live="polite">
				{rule ? describeRepeat(draft, anchor) : ""}
				{series?.clipped ? ` · the first ${series.events.length} are added now` : ""}
			</p>
		</div>
	);
}

import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Accordion, AccordionTab } from "@projective/ui/display";
import { DatePicker, NumberStepper, Select, SelectButton } from "@projective/ui/fields";
import type { CalendarEvent, IsoDate } from "@projective/types/scheduling";
import { addMonths, civilParts, isoDateOf } from "@projective/types/scheduling";
import {
	describeRepeat,
	fromRRule,
	presetDraft,
	presetLabel,
	presetOf,
	REPEAT_PRESETS,
	repeatAnchor,
	type RepeatDraft,
	type RepeatFreq,
	type RepeatPreset,
	seriesOf,
	templateDraft,
	toRRule,
	weekdayShort,
} from "../core/event-recurrence.ts";
import { libraryPresets } from "@features/catalogue/core/availability-model.ts";
import { loadPresets, presets } from "@features/catalogue/core/availability-store.ts";
import { calendarModeHref } from "../core/availability-view.ts";

/**
 * EventRecurrenceField — whether a new entry repeats, in two tiers.
 *
 * Tier 1 is one dropdown: the five cadences almost every entry wants, then the owner's availability
 * templates — each repeats on the weekdays its weekly working hours cover (`templateDraft`) — then
 * "Create custom template…", which opens the availability page in a new tab so the entry being
 * composed is not lost (Decision #378). Tier 2 is a flush `Accordion` for the rest: an
 * interval, the weekdays, and how the series ends. Every choice writes the same thing —
 * `recurrenceRule` on the working copy — and both tiers read it back, so choosing "Weekly" and then
 * opening the custom panel shows the weekly rule's own fields.
 *
 * The sentence under them is the rule read aloud, in the Meta register and a polite live region, so a
 * keyboard user hears what each change did without leaving the control.
 */
export interface EventRecurrenceFieldProps {
	event: CalendarEvent;
	/** IANA display zone — the series is anchored to the start's civil date here. */
	tz: string;
	onPatch: (patch: Partial<CalendarEvent>) => void;
}

/**
 * A CONTROLLED binding that follows `value` whenever `key` changes. A raw value would be read once
 * by `useControllable` and freeze (EventMetaBar's `useInstantBinding` records the same trap), so a
 * preset chosen in tier 1 would leave tier 2 showing the rule before it.
 */
function useBound<T>(value: T, key: string): Signal<T> {
	const bound = useSignal(value);
	useEffect(() => {
		bound.value = value;
	}, [key]);
	return bound;
}

const UNIT: Record<RepeatFreq, string> = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" };
const TEMPLATE = "tpl:";
const NEW_TEMPLATE = "new-template";
const FREQS: RepeatFreq[] = ["DAILY", "WEEKLY", "MONTHLY"];
const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7];

function pickerDate(date: IsoDate): Date {
	const p = civilParts(date);
	return new Date(p.year, p.month - 1, p.day);
}

export function EventRecurrenceField(props: EventRecurrenceFieldProps): JSX.Element {
	const { event, tz, onPatch } = props;
	const anchor = repeatAnchor(event.start, tz);
	const rule = event.recurrenceRule;
	const preset = presetOf(rule, anchor);
	const draft = (rule ? fromRRule(rule) : null) ?? presetDraft("weekly", anchor);
	const series = rule ? seriesOf(event, tz) : null;
	const key = rule ?? "";

	// Read once: the disclosure opens on a custom rule and is the reader's to toggle after that.
	const openOnMount = useRef(preset === "custom").current;
	const picked = useSignal<string | null>(null);

	useEffect(() => {
		if (presets.peek() === null) void loadPresets();
	}, []);

	const templates = libraryPresets(presets.value ?? []).flatMap((p) => {
		const d = templateDraft(p.rules);
		return d ? [{ id: p.id, name: p.name, rule: toRRule(d, anchor), draft: d }] : [];
	});
	const chosen = templates.find((t) => t.id === picked.value && t.rule === rule);
	const shown = chosen ? `${TEMPLATE}${chosen.id}` : preset;
	const presetValue = useBound<string>(shown, shown);
	const freq = useBound<string>(draft.freq, key);
	const interval = useBound<number | null>(draft.interval, key);
	const days = useBound<string[]>(draft.isoDays.map(String), key);
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

	const options = [
		...REPEAT_PRESETS.map((p) => ({ value: p, label: presetLabel(p, anchor) })),
		...(preset === "custom" && !chosen ? [{ value: "custom", label: "Custom" }] : []),
		...templates.map((t) => ({
			value: `${TEMPLATE}${t.id}`,
			label: `Like “${t.name}” · ${t.draft.isoDays.map(weekdayShort).join(" ")}`,
		})),
		{ value: NEW_TEMPLATE, label: "Create custom template…" },
	];

	return (
		<div class="evm-repeat">
			<Select
				size="sm"
				value={presetValue}
				options={options}
				aria-label="Repeats"
				onValueChange={(v) => {
					if (v === NEW_TEMPLATE) {
						// A new tab, so the entry being composed here survives the detour.
						globalThis.open(calendarModeHref("availability"), "_blank", "noopener");
						presetValue.value = shown;
					} else if (typeof v === "string" && v.startsWith(TEMPLATE)) {
						const t = templates.find((x) => `${TEMPLATE}${x.id}` === v);
						if (!t) return;
						picked.value = t.id;
						setRule(t.draft);
					} else if (v === "none") {
						setRule(null);
					} else if (v && v !== "custom") {
						setRule(presetDraft(v as Exclude<RepeatPreset, "none">, anchor));
					}
				}}
			/>

			<Accordion
				variant="flush"
				activeIndex={openOnMount ? 0 : -1}
				onTabChange={(index) => {
					// Opening the panel on a one-off entry starts it from the plainest series, so the
					// fields it shows are the rule in force rather than a preview of one.
					if (index === 0 && !rule) setRule(presetDraft("weekly", anchor));
				}}
			>
				<AccordionTab header="Custom / Advanced">
					<div class="evm-repeat__custom">
						<div class="evm-repeat__row">
							<span class="evm-repeat__k">Repeat every</span>
							<NumberStepper
								size="sm"
								value={interval}
								min={1}
								max={99}
								aria-label="Repeat every"
								onValueChange={(n) => {
									if (n) edit({ interval: n });
									else interval.value = draft.interval;
								}}
							/>
							<Select
								size="sm"
								value={freq}
								aria-label="Unit"
								options={FREQS.map((f) => ({
									value: f,
									label: draft.interval === 1 ? UNIT[f] : `${UNIT[f]}s`,
								}))}
								onValueChange={(f) => {
									if (f) edit({ freq: f as RepeatFreq });
								}}
							/>
						</div>

						{draft.freq === "WEEKLY"
							? (
								<div class="evm-repeat__row">
									<span class="evm-repeat__k">On</span>
									<SelectButton
										multiple
										size="sm"
										value={days}
										aria-label="On"
										options={ISO_DAYS.map((d) => ({ value: String(d), label: weekdayShort(d) }))}
										onValueChange={(v) => {
											const next = (v as string[]).map(Number).sort((a, b) => a - b);
											// A weekly series needs a day to fall on: the last one cannot be cleared.
											if (next.length) edit({ isoDays: next });
											else days.value = draft.isoDays.map(String);
										}}
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
				</AccordionTab>
			</Accordion>

			<p class="evm-repeat__sentence" aria-live="polite">
				{rule ? describeRepeat(draft, anchor) : ""}
				{series?.clipped ? ` · the first ${series.events.length} are added now` : ""}
			</p>
		</div>
	);
}

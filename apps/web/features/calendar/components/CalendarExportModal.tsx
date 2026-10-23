import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { CALENDAR_KIND_LABEL, calendarTime } from "@projective/ui/calendar";
import { Dialog, HintPopover, Message, Toast, useToast } from "@projective/ui/feedback";
import { Button, DateTimePicker, FormControl, Select, SelectButton } from "@projective/ui/fields";
import type { CalendarEvent } from "@projective/types/scheduling";
import { integrationLabel } from "@projective/types/scheduling";
import {
	buildExportFile,
	customRangeError,
	EXPORT_FORMATS,
	EXPORT_RANGES,
	EXPORT_STATUS_LABEL,
	type ExportCriteria,
	type ExportRange,
	exportFacets,
	selectForExport,
} from "../core/calendar-export.ts";
import { downloadExportFile } from "../core/calendar-download.ts";
import { exportOpen, hiddenKinds, hiddenSources } from "../core/calendar-state.ts";
import { fromPickerDate, toPickerDate } from "../core/picker-time.ts";

/**
 * CalendarExportModal — `/calendar`'s Export: pick a format, a date range and the entries, and take
 * the file away.
 *
 * **It opens on what the grid is showing.** The event types and calendars start from the header
 * band's own filter, so a reader who has narrowed the week and presses Export gets what they were
 * looking at — and can widen it here, where every option is one the agenda actually contains. A facet
 * with a single value is not offered, because a control whose only effect is to empty the export is
 * not a filter.
 *
 * **The count is live and the button says it.** "Export 14 events", the span they cover and how many
 * private blocks were left out are worked out as the reader chooses, so an empty selection is caught
 * BEFORE a download — the button disables and says why — rather than reported after an empty file
 * has already landed in their downloads folder. An invalid custom range disables it the same way.
 *
 * The file is written on this thread by the SSOT writers; the button shows its spinner for that frame.
 * A failure keeps the modal open with the reason; a success closes it and says so in a toast.
 */
export interface CalendarExportModalProps {
	/** Every entry on the agenda, imported ones included. The modal narrows them itself. */
	events: readonly CalendarEvent[];
	/** The surface's zone: all-day dates, the CSV wall clock and the custom range are read in it. */
	timezone: string;
	/** Written into the file as the calendar's name. */
	calendarName: string;
}

const ANYONE = "anyone";
const CUSTOM_RANGE_DAYS = 30;

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

function isRange(value: string): value is ExportRange {
	return EXPORT_RANGES.some((r) => r.value === value);
}

function spanLabel(events: readonly CalendarEvent[], tz: string): string {
	if (events.length === 0) return "";
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	return fmt.formatRange(new Date(events[0].start), new Date(events[events.length - 1].start));
}

export function CalendarExportModal(props: CalendarExportModalProps): JSX.Element {
	const format = useSignal<string>("ics");
	const range = useSignal<string>("all");
	const from = useSignal<Date | null>(null);
	const to = useSignal<Date | null>(null);
	const kinds = useSignal<string[]>([]);
	const statuses = useSignal<string[]>([]);
	const sources = useSignal<string[]>([]);
	const organiser = useSignal<string>(ANYONE);
	const busy = useSignal(false);
	const failure = useSignal<string | null>(null);
	const toastMounted = useSignal(false);
	const toast = useToast();

	const tz = props.timezone;
	const facets = exportFacets(props.events);
	const offer = {
		kinds: facets.kinds.length > 1,
		statuses: facets.statuses.length > 1,
		sources: facets.sources.length > 1,
		organisers: facets.organisers.length > 1,
	};

	useEffect(() => {
		if (!exportOpen.value) return;
		const today = calendarTime.startOfDay(Date.now(), tz);
		range.value = "all";
		kinds.value = facets.kinds.filter((k) => !hiddenKinds.peek().includes(k));
		statuses.value = [...facets.statuses];
		sources.value = facets.sources.filter((s) => !hiddenSources.peek().includes(s));
		organiser.value = ANYONE;
		from.value = toPickerDate(today, tz);
		to.value = toPickerDate(calendarTime.addZonedDays(today, CUSTOM_RANGE_DAYS, tz), tz);
		failure.value = null;
	}, [exportOpen.value]);

	const criteria: ExportCriteria = {
		range: isRange(range.value) ? range.value : "all",
		from: from.value ? fromPickerDate(from.value, tz) : null,
		to: to.value ? fromPickerDate(to.value, tz) : null,
		kinds: offer.kinds ? facets.kinds.filter((k) => kinds.value.includes(k)) : facets.kinds,
		statuses: offer.statuses
			? facets.statuses.filter((s) => statuses.value.includes(s))
			: facets.statuses,
		sources: offer.sources ? facets.sources.filter((s) => sources.value.includes(s)) : facets.sources,
		organiser: offer.organisers && organiser.value !== ANYONE ? organiser.value : null,
	};
	const rangeError = customRangeError(criteria);
	const selection = selectForExport(props.events, criteria, Date.now());
	const count = selection.events.length;
	const chosen = EXPORT_FORMATS.find((f) => f.value === format.value) ?? EXPORT_FORMATS[0];

	async function runExport(): Promise<void> {
		if (busy.value || rangeError !== null || count === 0) return;
		busy.value = true;
		failure.value = null;
		await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
		try {
			downloadExportFile(buildExportFile(chosen.value, selection.events, {
				timezone: tz,
				now: Date.now(),
				origin: location.origin,
				calendarName: props.calendarName,
			}));
		} catch (cause) {
			failure.value = "The file couldn’t be written. Try again, or choose another format.";
			throw cause;
		} finally {
			busy.value = false;
		}
		exportOpen.value = false;
		if (!document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({
			severity: "success",
			summary: `Exported ${plural(count, "event", "events")} as ${chosen.label}.`,
			life: 4000,
		});
	}

	return (
		<>
			<Dialog
				visible={exportOpen}
				header="Export calendar"
				width="34rem"
				footer={
					<div class="cal-export__foot">
						<Button variant="text" size="sm" onClick={() => (exportOpen.value = false)}>
							Cancel
						</Button>
						<Button
							variant="filled"
							size="sm"
							loading={busy.value}
							disabled={busy.value || rangeError !== null || count === 0}
							onClick={() => void runExport()}
						>
							{count > 0 ? `Export ${plural(count, "event", "events")}` : "Export"}
						</Button>
					</div>
				}
			>
				<div class="cal-export">
					<section class="cal-export__section">
						<div class="cal-export__head">
							<h3 class="cal-export__label">Format</h3>
							<HintPopover label="About export formats">
								iCalendar opens in any calendar app. jCal is the same calendar written as JSON
								(RFC 7265). CSV opens in a spreadsheet, with times in {tz.replace(/_/g, " ")}.
							</HintPopover>
						</div>
						<SelectButton
							aria-label="Format"
							size="sm"
							options={EXPORT_FORMATS.map((f) => ({
								label: f.label,
								value: f.value,
								description: f.description,
							}))}
							value={format}
						/>
					</section>

					<section class="cal-export__section">
						<div class="cal-export__head">
							<h3 class="cal-export__label">Date range</h3>
							<HintPopover label="About the date range">
								Your calendar holds what Projective has loaded for your agenda, plus anything you
								imported this session. Upcoming includes entries still in progress. Private blocks
								are never exported.
							</HintPopover>
						</div>
						<SelectButton
							aria-label="Date range"
							size="sm"
							options={EXPORT_RANGES.map((r) => ({ label: r.label, value: r.value }))}
							value={range}
						/>
						{criteria.range === "custom"
							? (
								<div class="cal-export__range">
									<FormControl label="From">
										{({ id, describedBy }) => (
											<DateTimePicker
												id={id}
												aria-describedby={describedBy}
												size="sm"
												value={from}
												dateFormat="mm/dd/yy"
												showIcon
											/>
										)}
									</FormControl>
									<FormControl
										label="To"
										error={rangeError ?? undefined}
										status={rangeError ? "invalid" : "default"}
									>
										{({ id, describedBy, status }) => (
											<DateTimePicker
												id={id}
												aria-describedby={describedBy}
												status={status}
												size="sm"
												value={to}
												dateFormat="mm/dd/yy"
												showIcon
											/>
										)}
									</FormControl>
								</div>
							)
							: null}
					</section>

					{offer.kinds
						? (
							<section class="cal-export__section">
								<h3 class="cal-export__label">Event types</h3>
								<SelectButton
									aria-label="Event types"
									size="sm"
									multiple
									options={facets.kinds.map((k) => ({ label: CALENDAR_KIND_LABEL[k], value: k }))}
									value={kinds}
								/>
							</section>
						)
						: null}

					{offer.statuses
						? (
							<section class="cal-export__section">
								<h3 class="cal-export__label">Status</h3>
								<SelectButton
									aria-label="Status"
									size="sm"
									multiple
									options={facets.statuses.map((s) => ({ label: EXPORT_STATUS_LABEL[s], value: s }))}
									value={statuses}
								/>
							</section>
						)
						: null}

					{offer.sources
						? (
							<section class="cal-export__section">
								<h3 class="cal-export__label">Calendars</h3>
								<SelectButton
									aria-label="Calendars"
									size="sm"
									multiple
									options={facets.sources.map((s) => ({ label: integrationLabel(s), value: s }))}
									value={sources}
								/>
							</section>
						)
						: null}

					{offer.organisers
						? (
							<section class="cal-export__section">
								<h3 class="cal-export__label">Organiser</h3>
								<Select
									aria-label="Organiser"
									size="sm"
									options={[
										{ label: "Anyone", value: ANYONE },
										...facets.organisers.map((o) => ({ label: o.name, value: o.key })),
									]}
									value={organiser}
								/>
							</section>
						)
						: null}

					<div class="cal-export__summary" role="status">
						{rangeError
							? null
							: count > 0
							? (
								<p class="cal-export__count">
									<span class="cal-export__figure">{plural(count, "event", "events")}</span>
									{` · ${spanLabel(selection.events, tz)}`}
									{selection.withheld > 0
										? ` · ${plural(selection.withheld, "private block", "private blocks")} left out`
										: null}
								</p>
							)
							: (
								<Message severity="warning" size="sm">
									No events match. Widen the date range or turn a filter back on.
								</Message>
							)}
					</div>

					{failure.value ? <Message severity="danger" size="sm">{failure.value}</Message> : null}
				</div>
			</Dialog>
			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</>
	);
}

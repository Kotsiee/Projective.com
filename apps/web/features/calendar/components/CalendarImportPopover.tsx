import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { calendarTime } from "@projective/ui/calendar";
import { Message, Popover, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { ICS_MAX_BYTES } from "@projective/types/scheduling";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import {
	CALENDAR_IMPORT_ACCEPT,
	type CalendarImportPreview,
	readCalendarFile,
} from "../core/calendar-import.ts";
import { requestImport } from "../core/calendar-state.ts";
import { IMPORT_REVIEW_THRESHOLD, type ImportItem } from "../core/import-plan.ts";

/**
 * CalendarImportPopover — the Import control on `/calendar`: an icon trigger and the light popover it
 * opens, which reads a `.ics`, `.ical` or `.vcs` and hands it to the calendar to save once the reader
 * has seen what they are adding.
 *
 * **Preview, then commit.** The file is checked (extension, media type, size) before a byte is read,
 * parsed by the SSOT reader, and summarised — "Found 12 events in Work" with the first few rows —
 * and nothing is saved until Import is pressed. A refusal stays in the popover where the reader is
 * looking. The same file can also be dropped straight onto the grid.
 *
 * **Every note the parser made is shown.** A skipped entry, an assumed zone, a clipped repeating
 * series — "23 of 25 imported" is the difference between an import and one that quietly lost two
 * meetings. The first two are listed and the rest counted, so a floating-time file with forty notes
 * does not push the button off a phone screen.
 *
 * The trigger is a NATIVE button carrying `api.ref`: a `ref` on the `Button` component stops at the
 * component and the panel anchors at the origin.
 *
 * **Native entries** (Decision #442, reversing #440's view-only import). Import hands the file to the
 * body ({@link requestImport}), which owns the one write path: a small file is saved at once, a larger
 * one opens the review modal first (repeats merged, duplicates left out, routines). Every entry is
 * the reader's own and edits like any other. Keep in sync opens Settings → Integrations on its
 * Calendars block, for a calendar that should follow its source.
 */
export interface CalendarImportPopoverProps {
	/** The surface's zone — floating times and all-day dates in the file are read in it. */
	timezone: string;
	/** The trigger's classes: the band and the rig draw it in their own chrome. */
	triggerClass: string;
	/** Below a header control, above a footer one. */
	placement: "bottom-end" | "top-end";
	/** The trigger glyph's size, matched to the chrome it sits in. Defaults to `xs`. */
	iconSize?: "xs" | "sm";
}

const PREVIEW_ROWS = 4;
const NOTE_ROWS = 2;

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

function whenLabel(item: ImportItem, tz: string): string {
	const day = calendarTime.fmtDayLabel(item.start, tz);
	return item.allDay ? `${day} · All day` : `${day} · ${calendarTime.fmtTime(item.start, tz)}`;
}

export function CalendarImportPopover(props: CalendarImportPopoverProps): JSX.Element {
	const open = useSignal(false);
	const reading = useSignal(false);
	const dragging = useSignal(false);
	const preview = useSignal<CalendarImportPreview | null>(null);
	const error = useSignal<string | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	function reset(): void {
		preview.value = null;
		error.value = null;
		dragging.value = false;
		if (fileRef.current) fileRef.current.value = "";
	}

	async function read(file: File): Promise<void> {
		reset();
		reading.value = true;
		try {
			const result = await readCalendarFile(file, { timezone: props.timezone, now: Date.now() });
			if (result.ok) preview.value = result.preview;
			else error.value = result.message;
		} catch (cause) {
			error.value = "That file could not be read.";
			throw cause;
		} finally {
			reading.value = false;
			if (fileRef.current) fileRef.current.value = "";
		}
	}

	function confirm(): void {
		const chosen = preview.value;
		if (!chosen) return;
		open.value = false;
		reset();
		requestImport(chosen);
	}

	function onDrop(e: JSX.TargetedDragEvent<HTMLLabelElement>): void {
		e.preventDefault();
		dragging.value = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) void read(file);
	}

	const found = preview.value;
	const notes = found
		? [
			...(found.cancelled > 0
				? [`${plural(found.cancelled, "cancelled event is", "cancelled events are")} left out.`]
				: []),
			...found.warnings,
		]
		: [];
	const reviewed = (found?.items.length ?? 0) > IMPORT_REVIEW_THRESHOLD;

	return (
		<Popover
			open={open}
			label="Import a calendar"
			placement={props.placement}
			avoid={[".ui-app-shell__sidebar"]}
			onOpenChange={(next) => {
				if (!next) reset();
			}}
			trigger={(api) => (
				<Tooltip content="Import calendar" density="compact">
					<button
						type="button"
						ref={api.ref as RefObject<HTMLButtonElement>}
						class={props.triggerClass}
						aria-label="Import calendar"
						aria-haspopup="dialog"
						aria-expanded={api.expanded ? "true" : "false"}
						aria-controls={api.panelId}
						onClick={api.toggle}
					>
						<Icon name="upload" size={props.iconSize ?? "xs"} />
					</button>
				</Tooltip>
			)}
		>
			<div class="cal-importpop">
				<div class="cal-importpop__head">
					<p class="cal-importpop__title">Import iCalendar</p>
					<p class="cal-importpop__formats">.ics · .ical · .vcs</p>
				</div>

				{found
					? (
						<div class="cal-importpop__result" role="status">
							<p class="cal-importpop__count">
								Found {plural(found.items.length, "event", "events")} in {found.calendarName}
							</p>
							<ul class="cal-importpop__list">
								{found.items.slice(0, PREVIEW_ROWS).map((e) => (
									<li class="cal-importpop__row" key={e.key}>
										<span class="cal-importpop__rowtitle">{e.title}</span>
										<span class="cal-importpop__rowwhen">{whenLabel(e, props.timezone)}</span>
									</li>
								))}
							</ul>
							{found.items.length > PREVIEW_ROWS
								? <p class="cal-importpop__more">and {found.items.length - PREVIEW_ROWS} more</p>
								: null}
						</div>
					)
					: (
						<label
							class="cal-importpop__drop"
							data-over={dragging.value ? "true" : undefined}
							aria-busy={reading.value ? "true" : undefined}
							onDragOver={(e) => {
								e.preventDefault();
								dragging.value = true;
							}}
							onDragLeave={() => (dragging.value = false)}
							onDrop={onDrop}
						>
							<input
								ref={fileRef}
								class="cal-importpop__input"
								type="file"
								accept={CALENDAR_IMPORT_ACCEPT}
								disabled={reading.value}
								onChange={(e) => {
									const file = e.currentTarget.files?.[0];
									if (file) void read(file);
								}}
							/>
							<Icon name="upload" size="md" class="cal-importpop__dropglyph" aria-hidden="true" />
							<span class="cal-importpop__droplabel">
								{reading.value ? "Reading the file…" : "Choose a file or drop it here"}
							</span>
							<span class="cal-importpop__droplimit">
								Up to {Math.round(ICS_MAX_BYTES / (1024 * 1024))} MB
							</span>
						</label>
					)}

				{error.value
					? (
						<Message severity="danger" size="sm">
							{error.value}
						</Message>
					)
					: null}

				{notes.length > 0
					? (
						<Message severity="warning" size="sm">
							<ul class="cal-importpop__notes">
								{notes.slice(0, NOTE_ROWS).map((note) => <li key={note}>{note}</li>)}
							</ul>
							{notes.length > NOTE_ROWS
								? (
									<p class="cal-importpop__morenotes">
										and {plural(notes.length - NOTE_ROWS, "more note", "more notes")}
									</p>
								)
								: null}
						</Message>
					)
					: null}

				{found
					? (
						<div class="cal-importpop__foot">
							<Button variant="text" size="sm" onClick={reset}>Choose another</Button>
							<Button variant="filled" size="sm" onClick={confirm}>
								{reviewed
									? `Review ${plural(found.items.length, "event", "events")}`
									: `Import ${plural(found.items.length, "event", "events")}`}
							</Button>
						</div>
					)
					: (
						<div class="cal-importpop__foot cal-importpop__foot--sync">
							<p class="cal-importpop__note">
								Saved to your calendar as your own events, to edit like any other. They won’t follow
								changes to the original.
							</p>
							<Button
								variant="text"
								size="sm"
								class="cal-importpop__sync"
								onClick={() => {
									open.value = false;
									void openSettings("integrations", "calendars");
								}}
							>
								Keep in sync
							</Button>
						</div>
					)}
			</div>
		</Popover>
	);
}

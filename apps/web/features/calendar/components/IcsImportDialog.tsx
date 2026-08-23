import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { CalendarEvent } from "@projective/types/scheduling";
import {
	ICS_MAX_BYTES,
	icsEventsToCalendarEvents,
	IcsParseError,
	parseIcsCalendar,
} from "@projective/types/scheduling";
import { importedEvents } from "../core/calendar-state.ts";
import "../styles/calendar-chrome.css";

/**
 * IcsImportDialog — read a `.ics` file and put what is in it on the grid.
 *
 * The parsing itself lives in the SSOT (`@projective/types/scheduling` `ics.ts`), pure and unit
 * tested; this component only handles the file, reports what came back, and lets the reader confirm.
 * That split is deliberate: a parser inside a component cannot be tested against the format, and a
 * `.ics` read in the browser and the same `.ics` read by the fat service must not be able to yield
 * two different weeks.
 *
 * **A refusal is shown, never swallowed.** A file that is not a calendar, is truncated, or contains
 * nothing readable throws {@link IcsParseError} and the message goes on screen. Importing zero
 * events silently looks exactly like importing an empty calendar, and the reader cannot tell which
 * happened. Warnings — a skipped entry, an assumed timezone — are shown too, because "23 of 25
 * imported" is the difference between a successful import and one that quietly lost two meetings.
 *
 * Entries land in {@link importedEvents}, a client-side signal, and are NOT posted anywhere:
 * persisting them needs the `scheduling.*` write path that is still behind the backend gate. They
 * carry the `ics` source mark, so nothing on the grid claims they are synced with anything.
 */
export interface IcsImportDialogProps {
	open: Signal<boolean>;
	/** The zone a floating (zone-less) time in the file is resolved in — the surface's own. */
	timezone: string;
}

export function IcsImportDialog(props: IcsImportDialogProps): JSX.Element {
	const fileRef = useRef<HTMLInputElement>(null);
	const fileName = useSignal<string | null>(null);
	const staged = useSignal<CalendarEvent[]>([]);
	const warnings = useSignal<string[]>([]);
	const error = useSignal<string | null>(null);
	const busy = useSignal(false);

	/**
	 * Clear the staged read AND the picker itself.
	 *
	 * The input has to be emptied, not just the signals: a file input fires no `change` when the same
	 * file is chosen twice, so a reader who cancels and re-picks the file they just looked at would
	 * get nothing at all and no explanation for it.
	 */
	function reset(): void {
		fileName.value = null;
		staged.value = [];
		warnings.value = [];
		error.value = null;
		if (fileRef.current) fileRef.current.value = "";
	}

	async function read(file: File): Promise<void> {
		busy.value = true;
		reset();
		fileName.value = file.name;
		try {
			// Checked before the read as well as inside the parser: `file.text()` on a multi-gigabyte
			// file would buffer the whole thing before anything got a chance to refuse it.
			if (file.size > ICS_MAX_BYTES) {
				error.value = "That calendar file is too large to read.";
				return;
			}
			const text = await file.text();
			const result = parseIcsCalendar(text, { timezone: props.timezone });
			staged.value = icsEventsToCalendarEvents(result.events, {
				source: "ics",
				// Keyed on the file name so two imports in one session cannot mint the same event id.
				idPrefix: `ics-${file.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 24)}`,
			});
			warnings.value = result.warnings;
		} catch (e) {
			// A parse refusal carries its own words; anything else is a read failure, which is a
			// different fact and must not be reported as "that is not a calendar".
			error.value = e instanceof IcsParseError
				? e.message
				: "That file could not be read from your device.";
		} finally {
			busy.value = false;
		}
	}

	function confirm(): void {
		if (staged.value.length === 0) return;
		importedEvents.value = [...importedEvents.value, ...staged.value];
		props.open.value = false;
		reset();
	}

	return (
		<Dialog
			visible={props.open}
			header="Import a calendar file"
			width="30rem"
			footer={
				<div class="cal-import__foot">
					<Button
						variant="text"
						size="sm"
						onClick={() => {
							props.open.value = false;
							reset();
						}}
					>
						Cancel
					</Button>
					<Button
						variant="filled"
						size="sm"
						disabled={busy.value || staged.value.length === 0}
						onClick={confirm}
					>
						{staged.value.length > 0
							? `Add ${staged.value.length} ${staged.value.length === 1 ? "event" : "events"}`
							: "Add events"}
					</Button>
				</div>
			}
		>
			<p class="cal-import__hint">
				An <code>.ics</code>{" "}
				file is a one-off snapshot, not a connection: what you add here will not update when the
				original changes. Connect a calendar instead if you want it to stay in step.
			</p>

			<label class="cal-import__drop">
				<input
					ref={fileRef}
					class="cal-import__input"
					type="file"
					accept=".ics,text/calendar"
					onChange={(e) => {
						const file = (e.currentTarget as HTMLInputElement).files?.[0];
						if (file) void read(file);
					}}
				/>
				<Icon name="upload" size="lg" class="cal-import__dropglyph" aria-hidden="true" />
				<span class="cal-import__droplabel">
					{fileName.value ?? "Choose a .ics file"}
				</span>
			</label>

			{error.value
				? (
					<Message severity="danger" class="cal-import__msg">
						{error.value}
					</Message>
				)
				: null}

			{staged.value.length > 0
				? (
					<div class="cal-import__result" role="status">
						<p class="cal-import__count">
							{staged.value.length} {staged.value.length === 1 ? "event" : "events"} ready to add.
						</p>
						<ul class="cal-import__preview">
							{staged.value.slice(0, 5).map((e) => (
								<li class="cal-import__row" key={e.id}>
									<span class="cal-import__rowtitle">{e.title}</span>
									<span class="cal-import__rowwhen">
										{new Date(e.start).toISOString().slice(0, 16).replace("T", " ")} UTC
									</span>
								</li>
							))}
						</ul>
						{staged.value.length > 5
							? (
								<p class="cal-import__more">
									and {staged.value.length - 5} more
								</p>
							)
							: null}
					</div>
				)
				: null}

			{warnings.value.length > 0
				? (
					<Message severity="warning" class="cal-import__msg">
						<ul class="cal-import__warnings">
							{warnings.value.map((w) => <li key={w}>{w}</li>)}
						</ul>
					</Message>
				)
				: null}
		</Dialog>
	);
}

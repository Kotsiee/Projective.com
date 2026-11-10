import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/event-modal.css";
import { calendarEntryName, calendarTime, maskLabel } from "@projective/ui/calendar";
import { RichTextEditor } from "@projective/ui/editor";
import { Button, DateTimePicker, InlineEdit, type InlineEditField } from "@projective/ui/fields";
import { ConfirmPopup, Tooltip } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	type CalendarEvent,
	DEFAULT_ENTRY_REMINDERS,
	detectTimeClash,
	ENTRY_CLASS_LABEL,
	entryClassOf,
	type SchedulingTarget,
} from "@projective/types/scheduling";
import { normalizeLink } from "@projective/types/links";
import { hasRichTextProse, sanitizeRichText } from "@projective/types/richtext";
import {
	calendarPage,
	openEventModal,
	requestOrganise,
	requestReminders,
	requestRemove,
	requestUpdate,
} from "../core/calendar-state.ts";
import { repeatSentence, seriesMasterOf } from "../core/event-recurrence.ts";
import { canInvite, durationLabel, entryEditable, timesMovable } from "../core/event-view.ts";
import { fromPickerDate, toPickerDate } from "../core/picker-time.ts";
import { entryOrganisable } from "../core/routine-actions.ts";
import { EventAttendeePanel } from "./EventAttendeePanel.tsx";
import { EventClashNote } from "./EventClashNote.tsx";
import { EventGuestList } from "./EventGuestList.tsx";
import { EventInvitationActions } from "./EventInvitationActions.tsx";
import { EventOrganiseFields } from "./EventOrganiseFields.tsx";
import { EventRemindersField } from "./EventRemindersField.tsx";

/** How long a copy button says what it did. */
const COPIED_MS = 1_800;

/** The personal agenda prints a 12-hour clock, as its grid and its modal do. */
const HOUR12 = true;

/** Props for {@link EventSummary}. */
export interface EventSummaryProps {
	event: CalendarEvent;
	tz: string;
	/** Where an answer to the entry is addressed (`answerTargetFor`); default the agenda itself. */
	answerTarget?: Omit<SchedulingTarget, "eventId"> | null;
}

/**
 * An icon-only copy with the outcome in its own tooltip and glyph, and in a live region for a reader
 * who sees neither. A failed copy says so: the clipboard is refused on an insecure origin. Each names
 * what it copies in its glyph, because two buttons with one mark can only be told apart by hovering.
 */
function CopyButton(
	props: { text: string; label: string; done: string; icon: IconName },
): JSX.Element {
	const state = useSignal<"idle" | "copied" | "failed">("idle");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	async function copy(): Promise<void> {
		try {
			await globalThis.navigator.clipboard.writeText(props.text);
			state.value = "copied";
		} catch {
			state.value = "failed";
		}
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = setTimeout(() => (state.value = "idle"), COPIED_MS);
	}

	const said = state.value === "copied"
		? props.done
		: state.value === "failed"
		? "Couldn’t reach the clipboard"
		: props.label;

	return (
		<>
			<Tooltip content={said} density="compact">
				<Button
					variant="outlined"
					severity="neutral"
					size="sm"
					iconOnly
					icon={<Icon name={state.value === "copied" ? "check" : props.icon} size="sm" />}
					aria-label={props.label}
					onClick={() => void copy()}
				/>
			</Tooltip>
			<span class="ui-visually-hidden" role="status">{state.value === "idle" ? "" : said}</span>
		</>
	);
}

/** One instant, editing in place: a picker that stages, and saves once when its panel closes. */
function InstantField(
	props: { field: InlineEditField; label: string; tz: string; min?: number },
): JSX.Element {
	const { field, tz } = props;
	const bound = useSignal<Date | null>(toPickerDate(Number(field.draft.peek()), tz));
	return (
		<DateTimePicker
			class="cal-sum__picker"
			size="sm"
			fluid
			defaultOpen
			hour12={HOUR12}
			value={bound}
			min={props.min === undefined ? undefined : toPickerDate(props.min, tz)}
			dateFormat="mm/dd/yy"
			aria-label={props.label}
			onValueChange={(next) => {
				if (next) field.draft.value = String(fromPickerDate(next, tz));
			}}
			onClose={field.commit}
		/>
	);
}

/** One row of the When list: the fact at rest, and for its host the picker in the same box. */
function TimeRow(
	props: {
		term: string;
		ms: number;
		text: string;
		tz: string;
		min?: number;
		editable: boolean;
		onCommit: (ms: number) => void;
	},
): JSX.Element {
	const name = `${props.term}, ${props.text}`;
	return (
		<div class="cal-sum__time">
			<dt class="cal-sum__term">{props.term}</dt>
			<dd class="cal-sum__fact">
				<InlineEdit
					value={String(props.ms)}
					editable={props.editable}
					label={`Edit ${name}`}
					display={<time dateTime={new Date(props.ms).toISOString()}>{props.text}</time>}
					onCommit={(next) => props.onCommit(Number(next))}
					renderField={(field) => (
						<InstantField
							field={field}
							label={props.term}
							tz={props.tz}
							min={props.min}
						/>
					)}
				/>
			</dd>
		</div>
	);
}

/** The agenda as sanitized HTML, and for its host the same editor the modal has, where it sits. */
function Agenda(
	props: { agenda: string; editable: boolean; onCommit: (html: string) => void },
): JSX.Element | null {
	const { agenda, editable } = props;
	const html = sanitizeRichText(agenda);
	const written = hasRichTextProse(html);
	if (!written && !editable) return null;
	return (
		<section class="evm-doc__sec cal-sum__agenda" aria-label="Agenda">
			<h3 class="evm-h">Agenda</h3>
			<InlineEdit
				as="block"
				value={agenda}
				editable={editable}
				label="Edit the agenda"
				placeholder="Add an agenda"
				// The read path sanitises again, so a row written any other way (a seed, a service-role
				// job, a call's agenda) cannot reach the DOM as markup.
				display={written
					? <div class="evm-rich" dangerouslySetInnerHTML={{ __html: html }} />
					: undefined}
				onCommit={props.onCommit}
				renderField={(field) => (
					<div
						class="cal-sum__editor"
						onFocusOut={(e) => {
							if (!e.currentTarget.contains(e.relatedTarget as Node | null)) field.commit();
						}}
						onKeyDown={(e) => {
							if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
							e.preventDefault();
							field.commit();
						}}
					>
						<RichTextEditor
							autoFocus
							value={field.draft.peek()}
							minRows={3}
							aria-label="Event agenda"
							placeholder="What is this session for? What should people bring?"
							onValueChange={(next: string) => (field.draft.value = next)}
						/>
					</div>
				)}
			/>
		</section>
	);
}

/**
 * EventSummary — the inspector: one entry, read in the `/calendar` right panel's Event tab.
 *
 * READ first: what, when, where and whose, in type registers rather than a form, with nothing boxed
 * (§B.4) and metadata as inline middot text (§B.11). The agenda is the stored HTML, rebuilt by
 * {@link sanitizeRichText}, never a live editor.
 *
 * An entry's host changes it where they read it: the title, each time and the agenda are
 * {@link InlineEdit}s, so one field turns into its own input in its own box and saves on its own. What
 * has no room here (the room, the attachments, a ballot) stays in the event modal, one press away,
 * which is also how anybody else reaches what the modal lets them see. A seat that cannot change a
 * field reads the same words, with no affordance at all.
 *
 * Alerts are the reader's own, so they are offered to any seat that holds the entry
 * (`event.reminders`), and the Join rig to anyone a link was shared with. Its routine and whether it
 * holds its time are its owner's, an entry from a connected calendar included, because neither reaches
 * the provider.
 */
export function EventSummary({ event, tz, answerTarget }: EventSummaryProps): JSX.Element {
	const canEdit = entryEditable(event);
	const page = calendarPage.value;
	const events = page?.events ?? [];
	const nowMs = page?.now ?? Date.now();
	const reminder = entryClassOf(event) === "reminder";

	const host = event.viewerIsHost === true
		? "You host this"
		: event.organiser
		? `Hosted by ${event.organiser.name}`
		: event.connected
		? "From your connected calendar"
		: null;
	// Only an http(s) address becomes a link, as in the modal.
	const joinUrl = event.meeting?.joinUrl ?? event.meetingUrl ?? null;
	const joinHref = joinUrl ? normalizeLink(joinUrl) : null;
	const passcode = event.meeting?.passcode ?? null;
	const named = calendarEntryName(event);
	const classed = ENTRY_CLASS_LABEL[entryClassOf(event)];
	const facts = [
		event.masked ? null : classed,
		event.masked || named === classed ? null : named,
		repeatSentence(event, events, tz),
		event.masked ? null : event.location,
		joinHref ? null : event.meeting?.providerLabel,
		event.attendees != null && !event.roster ? `${event.attendees} going` : null,
	].filter(Boolean).join(" · ");

	const endsSameDay = calendarTime.startOfDay(event.start, tz) ===
		calendarTime.startOfDay(event.end, tz);
	const startText = event.allDay
		? `${calendarTime.fmtFullDate(event.start, tz)} · All day`
		: `${calendarTime.fmtFullDate(event.start, tz)}, ${
			calendarTime.fmtTime(event.start, tz, HOUR12)
		}`;
	const endTime = calendarTime.fmtTime(event.end, tz, HOUR12);
	const duration = durationLabel(event.start, event.end);
	const endText = `${
		endsSameDay ? endTime : `${calendarTime.fmtFullDate(event.end, tz)}, ${endTime}`
	}${duration ? ` · ${duration}` : ""}`;

	// A series' later occurrences leave an agenda they share with their master to it.
	const agenda = event.description ?? seriesMasterOf(event, events)?.description ?? "";
	// An all-day entry has no time of day to pick, as in the modal's meta bar.
	const timesEditable = timesMovable(event) && !event.allDay;

	return (
		<article class="cal-sum" aria-label="Event details">
			<h2 class="cal-sum__title">
				<InlineEdit
					value={event.masked ? maskLabel(event.status) : event.title}
					editable={canEdit}
					displayAs="span"
					maxLength={200}
					label="Edit the title"
					placeholder="Untitled event"
					onCommit={(title) => {
						if (title) requestUpdate({ ...event, title });
					}}
				/>
			</h2>
			{facts ? <p class="cal-sum__meta">{facts}</p> : null}

			<dl class="cal-sum__times">
				{event.allDay || reminder
					? (
						<TimeRow
							term={event.kind === "deadline" ? "Due" : "When"}
							ms={event.start}
							text={startText}
							tz={tz}
							editable={timesEditable}
							onCommit={(start) =>
								requestUpdate({ ...event, start, end: start + (event.end - event.start) })}
						/>
					)
					: (
						<>
							<TimeRow
								term="Starts"
								ms={event.start}
								text={startText}
								tz={tz}
								editable={timesEditable}
								// Moving the start carries the end, so the entry keeps its length.
								onCommit={(start) =>
									requestUpdate({ ...event, start, end: start + (event.end - event.start) })}
							/>
							<TimeRow
								term="Ends"
								ms={event.end}
								text={endText}
								tz={tz}
								min={event.start}
								editable={timesEditable}
								onCommit={(end) => requestUpdate({ ...event, end })}
							/>
						</>
					)}
			</dl>
			{host ? <p class="cal-sum__meta">{host}</p> : null}
			{event.clashCount
				? (
					<EventClashNote
						clashes={detectTimeClash({ ...event, excludeId: event.id }, events).clashes}
						span={event}
						tz={tz}
						focusable
					/>
				)
				: null}
			<EventInvitationActions event={event} nowMs={nowMs} target={answerTarget} />

			{joinHref
				? (
					<div class="cal-sum__rig">
						<Button
							variant="filled"
							severity="primary"
							size="sm"
							fluid
							icon={<Icon name="video-camera" size="sm" />}
							label="Join Meeting"
							aria-label={event.meeting?.providerLabel
								? `Join Meeting on ${event.meeting.providerLabel}`
								: "Join Meeting"}
							onClick={() => globalThis.open(joinHref, "_blank", "noopener,noreferrer")}
						/>
						<CopyButton
							icon="link"
							text={joinHref}
							label="Copy the join link"
							done="Join link copied"
						/>
						{passcode
							? (
								<CopyButton
									icon="lock"
									text={passcode}
									label="Copy the passcode"
									done="Passcode copied"
								/>
							)
							: null}
					</div>
				)
				: null}

			{canInvite(event, nowMs)
				? <EventGuestList event={event} />
				: event.roster && event.roster.length > 0
				? <EventAttendeePanel roster={event.roster} />
				: null}

			{event.masked ? null : (
				<Agenda
					agenda={agenda}
					editable={canEdit}
					onCommit={(description) => requestUpdate({ ...event, description })}
				/>
			)}

			{entryOrganisable(event)
				? (
					<EventOrganiseFields
						event={event}
						onChange={(change) => requestOrganise(event, change)}
					/>
				)
				: null}

			{event.reminders !== undefined
				? (
					<EventRemindersField
						value={event.reminders}
						fallback={page?.prefs?.reminders ?? DEFAULT_ENTRY_REMINDERS}
						onChange={(next) => requestReminders(event, next)}
					/>
				)
				: null}

			<div class="cal-sum__acts">
				<Button
					size="sm"
					variant="outlined"
					severity="neutral"
					icon={<Icon name={canEdit ? "edit" : "arrow-up-right"} size="sm" />}
					label={canEdit ? "Edit in Modal" : "Open details"}
					onClick={() => openEventModal(event.id)}
				/>
				{canEdit
					? (
						<ConfirmPopup
							label="Delete this event"
							message={event.roster?.length
								? "Delete this event? Everyone invited is told it is off."
								: "Delete this event from your calendar?"}
							acceptLabel="Delete"
							rejectLabel="Keep"
							acceptSeverity="danger"
							onAccept={() => requestRemove(event.id)}
							trigger={(api) => (
								<Button
									triggerRef={api.ref}
									size="sm"
									variant="text"
									severity="danger"
									label="Delete"
									aria-expanded={api.expanded ? "true" : "false"}
									aria-controls={api.panelId}
									onClick={api.toggle}
								/>
							)}
						/>
					)
					: null}
				{event.href ? <a class="cal-sum__link" href={event.href}>Go to its project</a> : null}
			</div>
		</article>
	);
}

import type { ComponentChildren, JSX } from "preact";
import { RichTextEditor } from "@projective/ui/editor";
import { InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { calendarTime } from "@projective/ui/calendar";
import type { CalendarEvent, EventMeeting } from "@projective/types/scheduling";
import { MEETING_PROVIDER_LABEL } from "@projective/types/scheduling";
import { normalizeLink } from "@projective/types/links";
import { sanitizeRichText } from "@projective/types/richtext";
import { durationLabel, type EventMode } from "../../core/event-view.ts";
import {
	checkJoinLink,
	GENERATED_PROVIDERS,
	rememberedProvider,
	rememberProvider,
} from "../../core/meeting-link.ts";
import { MeetingProviderRail } from "../MeetingProviderRail.tsx";
import { EventRecurrenceField } from "../EventRecurrenceField.tsx";

/**
 * EventDetailsTab — the agenda, where it happens, and how to get in.
 *
 * Three regions in reading order, because that is the order the questions arrive in: what is this
 * meeting about, where is the room, and what do I need to get through the door.
 *
 * **Composing is a two-column workspace.** The left column is what the entry IS — when it runs and
 * what it is for; the right column is how people reach it — the room and whether it repeats. The
 * facts about the occurrence itself move to the modal's footer, so nothing on this side restates a
 * value the reader is editing a column away.
 *
 * **Only a meeting has a room.** A Reminder or a Deadline is a moment, not a gathering, so neither
 * shows the room at all (Decision #378). Meet, Zoom and Teams rooms are CREATED for the host through
 * their integration, so those three take no link field; only a custom room is pasted.
 *
 * **A seat that cannot change something sees the ANSWER, never a disabled control.** The host writes
 * the agenda in a real editor; everybody else reads prose. The join details are the same fact drawn
 * two ways — an editable field for the person who arranges the room, a copyable line for the people
 * walking into it — and a greyed-out provider dropdown would offer an attendee a choice and then take
 * it back.
 */
export interface EventDetailsTabProps {
	event: CalendarEvent;
	mode: EventMode;
	/** IANA display zone — every instant on this surface is rendered in the schedule's own zone. */
	tz: string;
	hour12: boolean;
	/** Whether the acting viewer arranges this event (the host). */
	canEdit: boolean;
	/** While composing: the When row (the modal's meta bar), drawn at the head of the left column. */
	when?: ComponentChildren;
	onPatch: (patch: Partial<CalendarEvent>) => void;
}

/**
 * The room as it stands, so a patch never has to invent the half it is not changing. A new entry's
 * room starts on the provider its host picked last (Google Meet the first time).
 */
function meetingOf(event: CalendarEvent): EventMeeting {
	if (event.meeting) return event.meeting;
	const provider = rememberedProvider();
	return {
		provider,
		providerLabel: MEETING_PROVIDER_LABEL[provider],
		joinUrl: null,
		passcode: null,
		details: null,
		pending: true,
	};
}

/** The kinds that are a moment rather than a gathering, and so have no room. */
const ROOMLESS = new Set<CalendarEvent["kind"]>(["general", "deadline"]);

export function EventDetailsTab(props: EventDetailsTabProps): JSX.Element {
	const { event, tz, hour12, canEdit } = props;
	const meeting = meetingOf(event);
	// Only an http(s) address becomes a link — a `javascript:` "room" would run in this origin.
	const joinHref = meeting.joinUrl ? normalizeLink(meeting.joinUrl) : null;
	const linkCheck = meeting.joinUrl ? checkJoinLink(meeting.joinUrl) : null;
	const linkError = linkCheck && !linkCheck.ok ? linkCheck.message : null;
	const creating = props.mode === "create";
	const roomless = ROOMLESS.has(event.kind);
	const generated = GENERATED_PROVIDERS.includes(meeting.provider);
	const railLabelId = `evm-provider-${event.id}`;
	const linkErrorId = `evm-joinlink-${event.id}`;

	function patchMeeting(next: Partial<EventMeeting>): void {
		const merged: EventMeeting = { ...meeting, ...next };
		props.onPatch({
			meeting: {
				...merged,
				// The label follows the provider; only a room that was already custom keeps the name its
				// host gave it ("Studio, 2nd floor") when an older composer still offered one.
				providerLabel: merged.provider === "custom" && meeting.provider === "custom"
					? merged.providerLabel
					: MEETING_PROVIDER_LABEL[merged.provider],
			},
		});
	}

	/** A pasted link names its own provider (`meeting-link.ts`); one that fails the check keeps the rail. */
	function patchJoinLink(raw: string): void {
		const joinUrl = raw.trim() || null;
		const check = joinUrl ? checkJoinLink(joinUrl) : null;
		patchMeeting({
			joinUrl,
			pending: !joinUrl,
			...(check?.ok ? { provider: check.provider } : {}),
		});
	}

	// #region Agenda
	const agenda = (
		<section class="evm-doc__sec">
			<h3 class="evm-h">Agenda</h3>
			{canEdit
				? (
					<RichTextEditor
						// Quill owns its DOM after mount and is seeded exactly once, so a shared editor
						// would write the previous event's agenda back on the next keystroke. Keying it to
						// the subject is what makes opening a second event give you a second editor.
						key={event.id}
						value={event.description ?? ""}
						minRows={5}
						aria-label="Event agenda"
						placeholder="What is this session for? What should people bring?"
						onValueChange={(description: string) => props.onPatch({ description })}
					/>
				)
				: event.description
				? (
					<div
						class="evm-rich"
						// A host writes this for attendees to read. The write path already sanitised it;
						// rendering through the same allow-list again means a row written any other way
						// (a seed, a service-role job, a call's agenda) cannot reach the DOM as markup.
						dangerouslySetInnerHTML={{ __html: sanitizeRichText(event.description) }}
					/>
				)
				: <p class="evm-empty evm-empty--inline">No agenda was written for this one.</p>}
		</section>
	);
	// #endregion

	// #region The room
	const room = roomless ? null : (
		<section class="evm-doc__sec">
			{canEdit
				? (
					<>
						<h3 class="evm-h" id={railLabelId}>Meeting provider</h3>
						<div class="evm-form">
							<div class="evm-field evm-field--wide">
								<MeetingProviderRail
									value={meeting.provider}
									labelledBy={railLabelId}
									onChange={(provider) => {
										rememberProvider(provider);
										patchMeeting({ provider });
									}}
								/>
							</div>

							{generated
								? (
									<p class="evm-field evm-field--wide evm-room__note">
										{meeting.joinUrl && joinHref
											? (
												<a
													class="evm-link"
													href={joinHref}
													target="_blank"
													rel="noopener noreferrer"
												>
													{meeting.joinUrl}
													<Icon name="external-link" size="2xs" />
												</a>
											)
											: `The ${
												MEETING_PROVIDER_LABEL[meeting.provider]
											} link is created from your connected account and shared with everyone invited.`}
									</p>
								)
								: (
									<>
										<label class="evm-field evm-field--wide">
											<span class="evm-field__label">Join link</span>
											<InputText
												size="sm"
												value={meeting.joinUrl ?? ""}
												maxLength={600}
												placeholder="https://… — the provider is read from the link"
												aria-label="Join link"
												status={linkError ? "invalid" : "default"}
												aria-describedby={linkError ? linkErrorId : undefined}
												onValueChange={patchJoinLink}
											/>
											{linkError ? <p class="evm-refuse" id={linkErrorId}>{linkError}</p> : null}
										</label>

										<label class="evm-field">
											<span class="evm-field__label">Passcode</span>
											<InputText
												size="sm"
												value={meeting.passcode ?? ""}
												maxLength={120}
												placeholder="Optional"
												aria-label="Meeting passcode"
												onValueChange={(passcode: string) =>
													patchMeeting({ passcode: passcode.trim() || null })}
											/>
										</label>
									</>
								)}
							{/* A physical place (a project room, an internal space) returns here as Location once rooms exist; until then a room is online only. */}
						</div>
					</>
				)
				: (
					<>
						<h3 class="evm-h">Meeting</h3>
						<dl class="evm-facts">
							<div class="evm-facts__row">
								<dt>Provider</dt>
								<dd>{meeting.providerLabel}</dd>
							</div>
							<div class="evm-facts__row">
								<dt>Join link</dt>
								<dd>
									{joinHref
										? (
											<a
												class="evm-link"
												href={joinHref}
												target="_blank"
												rel="noopener noreferrer"
											>
												{meeting.joinUrl}
												<Icon name="external-link" size="2xs" />
											</a>
										)
										: meeting.joinUrl
										? <span class="evm-facts__note">{meeting.joinUrl}</span>
										: meeting.pending
										? (
											<span class="evm-facts__note">
												Not created yet — it appears here once the session is confirmed.
											</span>
										)
										: <span class="evm-facts__note">Not shared with you.</span>}
								</dd>
							</div>
							{meeting.passcode
								? (
									<div class="evm-facts__row">
										<dt>Passcode</dt>
										<dd class="evm-facts__code">{meeting.passcode}</dd>
									</div>
								)
								: null}
							{meeting.details
								? (
									<div class="evm-facts__row">
										<dt>Details</dt>
										<dd>{meeting.details}</dd>
									</div>
								)
								: null}
						</dl>
					</>
				)}
		</section>
	);
	// #endregion

	if (creating) {
		return (
			<div class="evm-compose">
				<div class="evm-compose__main">
					<section class="evm-doc__sec">
						<h3 class="evm-h">When</h3>
						{props.when}
					</section>
					{agenda}
				</div>
				<div class="evm-compose__side">
					{room}
					<section class="evm-doc__sec">
						<h3 class="evm-h">Repeats</h3>
						<EventRecurrenceField event={event} tz={tz} onPatch={props.onPatch} />
					</section>
				</div>
			</div>
		);
	}

	return (
		<div class="evm-doc">
			{agenda}
			{room}

			{/* #region The occurrence itself */}
			<section class="evm-doc__sec">
				<h3 class="evm-h">This occurrence</h3>
				<dl class="evm-facts">
					<div class="evm-facts__row">
						<dt>When</dt>
						<dd>
							{calendarTime.fmtFullDate(event.start, tz)} ·{" "}
							{event.allDay ? "All day" : calendarTime.fmtRange(event.start, event.end, tz, hour12)}
						</dd>
					</div>
					<div class="evm-facts__row">
						<dt>{event.allDay || durationLabel(event.start, event.end) ? "Runs for" : "Due"}</dt>
						<dd>
							{event.allDay ? "All day" : durationLabel(event.start, event.end) ??
								calendarTime.fmtTime(event.start, tz, hour12)}
						</dd>
					</div>
					{event.organiser
						? (
							<div class="evm-facts__row">
								<dt>Organiser</dt>
								<dd>{event.organiser.name}</dd>
							</div>
						)
						: null}
					<div class="evm-facts__row">
						<dt>Timezone</dt>
						<dd>
							<Tooltip content="Every time on this surface is shown in the schedule's own zone, not your device's.">
								<span tabIndex={0}>{tz}</span>
							</Tooltip>
						</dd>
					</div>
					{typeof event.capacity === "number"
						? (
							<div class="evm-facts__row">
								<dt>Seats</dt>
								<dd>
									{event.attendees ?? 0} of {event.capacity} taken
								</dd>
							</div>
						)
						: null}
				</dl>
			</section>
			{/* #endregion */}
		</div>
	);
}

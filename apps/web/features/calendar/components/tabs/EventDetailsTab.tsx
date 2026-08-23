import type { JSX } from "preact";
import { RichTextEditor } from "@projective/ui/editor";
import { InputText, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { calendarTime } from "@projective/ui/calendar";
import type {
	CalendarEvent,
	CalendarEventKind,
	EventMeeting,
	MeetingProvider,
} from "@projective/types/scheduling";
import { MEETING_PROVIDER_LABEL } from "@projective/types/scheduling";
import { durationLabel, type EventMode } from "../../core/event-view.ts";

/**
 * EventDetailsTab — the agenda, where it happens, and how to get in.
 *
 * Three regions in reading order, because that is the order the questions arrive in: what is this
 * meeting about, where is the room, and what do I need to get through the door.
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
	/**
	 * The entry kinds this surface can create. Only consulted while composing — an existing event's
	 * kind is what it IS, and a control that re-labels a deadline as a session after the fact would be
	 * rewriting history rather than editing a plan.
	 */
	createKinds: { value: CalendarEventKind; label: string }[];
	onPatch: (patch: Partial<CalendarEvent>) => void;
}

/** Every room-minting provider the platform names, plus the host's own arrangement. */
const PROVIDER_OPTIONS: { value: MeetingProvider; label: string }[] = (
	["google", "outlook", "zoom", "microsoft_teams", "discord", "custom"] as MeetingProvider[]
).map((v) => ({ value: v, label: MEETING_PROVIDER_LABEL[v] }));

/** The room as it stands, so a patch never has to invent the half it is not changing. */
function meetingOf(event: CalendarEvent): EventMeeting {
	return event.meeting ?? {
		provider: "custom",
		providerLabel: MEETING_PROVIDER_LABEL.custom,
		joinUrl: null,
		passcode: null,
		details: null,
		pending: true,
	};
}

export function EventDetailsTab(props: EventDetailsTabProps): JSX.Element {
	const { event, tz, hour12, canEdit } = props;
	const meeting = meetingOf(event);
	const creating = props.mode === "create";

	function patchMeeting(next: Partial<EventMeeting>): void {
		const merged: EventMeeting = { ...meeting, ...next };
		props.onPatch({
			meeting: {
				...merged,
				// The label follows the provider unless the host is naming their own arrangement, where
				// the label IS the arrangement ("Studio, 2nd floor") and must not be overwritten.
				providerLabel: merged.provider === "custom"
					? merged.providerLabel
					: MEETING_PROVIDER_LABEL[merged.provider],
			},
		});
	}

	return (
		<div class="evm-doc">
			{/* #region Agenda */}
			{creating
				? (
					<section class="evm-doc__sec">
						<h3 class="evm-h">What is it</h3>
						<div class="evm-form">
							<label class="evm-field">
								<span class="evm-field__label">Type</span>
								<Select
									size="sm"
									value={event.kind}
									aria-label="Entry type"
									options={props.createKinds}
									onValueChange={(v) => {
										if (v) props.onPatch({ kind: v as CalendarEventKind });
									}}
								/>
							</label>
							<label class="evm-field">
								<span class="evm-field__label">Where</span>
								<InputText
									size="sm"
									value={event.location ?? ""}
									maxLength={160}
									placeholder="Project room, studio, online"
									aria-label="Location"
									onValueChange={(location: string) =>
										props.onPatch({ location: location.trim() || undefined })}
								/>
							</label>
						</div>
					</section>
				)
				: null}

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
							/*
							 * ⚠️ UNSANITISED, and the reason it is currently safe is a fact about the SYSTEM, not
							 * about this line.
							 *
							 * The claim this comment used to make — "the only HTML that can reach here is what the
							 * shared editor emits" — is an assertion about a write path that does not exist. What
							 * is actually true today: `description` reaches this branch only from a SERVER-derived
							 * payload (the fixtures), it is withheld from non-parties by the privacy allow-list,
							 * and the editor branch above is the only writer — staged in the frame cache, never
							 * persisted, and only ever re-read by the same browser through the editor, not through
							 * here. So no author's markup can currently reach another viewer.
							 *
							 * That stops being true the moment an update write path lands (`description` is a
							 * `z.string().max(8000)` on the eventual payload, and a host writes it for an audience
							 * of attendees). This is a PLATFORM gap, not a local one — the ticket modal renders
							 * two more of these and the repo has no sanitiser — so it is flagged for a shared
							 * allow-list sanitiser rather than half-solved with a regex here, which is how a
							 * sanitiser that looks like protection ships without being any.
							 */
							dangerouslySetInnerHTML={{ __html: event.description }}
						/>
					)
					: <p class="evm-empty evm-empty--inline">No agenda was written for this one.</p>}
			</section>
			{/* #endregion */}

			{/* #region The room */}
			<section class="evm-doc__sec">
				<h3 class="evm-h">Where it happens</h3>

				{canEdit
					? (
						<div class="evm-form">
							<label class="evm-field">
								<span class="evm-field__label">Meeting provider</span>
								<Select
									size="sm"
									value={meeting.provider}
									aria-label="Meeting provider"
									options={PROVIDER_OPTIONS}
									onValueChange={(v) => {
										if (v) patchMeeting({ provider: v as MeetingProvider });
									}}
								/>
							</label>

							{meeting.provider === "custom"
								? (
									<label class="evm-field">
										<span class="evm-field__label">What to call it</span>
										<InputText
											size="sm"
											value={meeting.providerLabel}
											maxLength={60}
											placeholder="Studio, 2nd floor"
											aria-label="Name for this arrangement"
											onValueChange={(providerLabel: string) => patchMeeting({ providerLabel })}
										/>
									</label>
								)
								: null}

							<label class="evm-field">
								<span class="evm-field__label">Join link</span>
								<InputText
									size="sm"
									value={meeting.joinUrl ?? ""}
									maxLength={600}
									placeholder="https://…"
									aria-label="Join link"
									onValueChange={(joinUrl: string) =>
										patchMeeting({ joinUrl: joinUrl.trim() || null, pending: !joinUrl.trim() })}
								/>
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

							<label class="evm-field evm-field--wide">
								<span class="evm-field__label">Anything else a joiner needs</span>
								<InputText
									size="sm"
									value={meeting.details ?? ""}
									maxLength={600}
									placeholder="Dial-in numbers, a room number, who to ask for"
									aria-label="Joining details"
									onValueChange={(details: string) =>
										patchMeeting({ details: details.trim() || null })}
								/>
							</label>
						</div>
					)
					: (
						<dl class="evm-facts">
							<div class="evm-facts__row">
								<dt>Provider</dt>
								<dd>{meeting.providerLabel}</dd>
							</div>
							<div class="evm-facts__row">
								<dt>Join link</dt>
								<dd>
									{meeting.joinUrl
										? (
											<a
												class="evm-link"
												href={meeting.joinUrl}
												target="_blank"
												rel="noopener noreferrer"
											>
												{meeting.joinUrl}
												<Icon name="external-link" size="2xs" />
											</a>
										)
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
					)}
			</section>
			{/* #endregion */}

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

				{creating
					? (
						<p class="evm-note">
							<Icon name="info" size="2xs" />
							The time comes from the range you selected on the grid.
						</p>
					)
					: null}
			</section>
			{/* #endregion */}
		</div>
	);
}

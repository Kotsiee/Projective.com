import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import {
	type CalendarEvent,
	eligibleVoterCount,
	type RsvpResponse,
} from "@projective/types/scheduling";
import {
	agendaReload,
	leavingEvents,
	openEventModal,
	publishEvent,
} from "../core/calendar-state.ts";
import { canAnswer, rescheduleView, RSVP_ACTIONS, viewerSeat } from "../core/event-view.ts";
import { ScheduleService } from "../core/ScheduleService.ts";

/** How long a declined card takes to fade: `--dur-medium`, the time its stylesheet gives it. */
const FADE_MS = 250;

/** Props for {@link EventInvitationActions}. */
export interface EventInvitationActionsProps {
	event: CalendarEvent;
	nowMs: number;
}

/**
 * EventInvitationActions — the inspector's answer to an invitation: Accept · Tentative · Decline, and
 * a way into the negotiation.
 *
 * The negotiation itself stays in the event modal's Reschedule tab, which holds the ballot, the tallies
 * and the countdown, so this is a door to it and not a second copy. It says what the round is waiting
 * for. Who may do what there is {@link rescheduleView}'s to say, so a refusal reads as the server would
 * word it, and a seat with no way in is told why.
 *
 * Declining fades the card off the calendar while the write is in flight. If the write is refused the
 * card comes back, with the refusal in its own words.
 */
export function EventInvitationActions(props: EventInvitationActionsProps): JSX.Element | null {
	const { event, nowMs } = props;
	const busy = useSignal(false);
	const refusal = useSignal<string | null>(null);

	const answering = canAnswer(event, nowMs);
	const hosting = event.viewerIsHost === true;
	const guests = eligibleVoterCount(event.roster ?? []) > 0 && !event.callId;
	if (!answering && !(hosting && guests)) return null;

	const seat = viewerSeat(event);
	const view = rescheduleView(event, nowMs);
	const open = !view.closed && view.status !== "none";
	const negotiate = view.status === "voting"
		? "Vote on a new time"
		: open
		? "See the proposed times"
		: hosting
		? "Propose a new time"
		: "Propose alternate time";

	async function answer(response: RsvpResponse): Promise<void> {
		if (busy.peek()) return;
		busy.value = true;
		refusal.value = null;
		const leaving = response === "rejected";
		if (leaving) leavingEvents.value = [...leavingEvents.peek(), event.id];
		const [res] = await Promise.all([
			ScheduleService.respond({ scope: "personal", eventId: event.id, response }),
			leaving ? new Promise((done) => setTimeout(done, FADE_MS)) : null,
		]);
		leavingEvents.value = leavingEvents.peek().filter((id) => id !== event.id);
		busy.value = false;
		if (!res.ok || !res.data) {
			refusal.value = res.message ?? "That answer could not be recorded.";
			return;
		}
		publishEvent(res.data.event);
		// An answer changes who holds the entry, so its alerts and its neighbours' clashes are read again.
		agendaReload.value++;
	}

	return (
		<div class="cal-sum__answer">
			{answering
				? (
					<div class="evm-rsvp" role="group" aria-label="Your answer">
						{RSVP_ACTIONS.map((a) => (
							<Button
								key={a.value}
								variant={seat?.response === a.value ? "filled" : "outlined"}
								severity={a.severity}
								size="sm"
								disabled={busy.value}
								aria-pressed={seat?.response === a.value ? "true" : "false"}
								onClick={() => void answer(a.value)}
							>
								{a.label}
							</Button>
						))}
					</div>
				)
				: null}
			{view.propose.allowed
				? (
					<Button
						variant="outlined"
						severity="neutral"
						size="sm"
						label={negotiate}
						onClick={() => openEventModal(event.id, "reschedule")}
					/>
				)
				: <p class="cal-sum__meta">{view.propose.reason}</p>}
			{refusal.value ? <p class="evm-refuse" role="alert">{refusal.value}</p> : null}
		</div>
	);
}

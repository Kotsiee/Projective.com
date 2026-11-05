import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "@features/share/styles/share-people.css";
import type { RankedContact } from "@projective/types/messaging";
import type { CalendarEvent, EventAttendee } from "@projective/types/scheduling";
import { UserSearchPopover } from "@features/share/components/UserSearchPopover.tsx";
import {
	handleSet,
	normaliseHandle,
	type PersonActionState,
} from "@features/share/core/people-picker.ts";
import { publishEvent } from "../core/calendar-state.ts";
import { ScheduleService } from "../core/ScheduleService.ts";
import { EventAttendeePanel } from "./EventAttendeePanel.tsx";

/**
 * EventGuestList — a host's roster in the inspector: who is on the entry, a way to withdraw each
 * invitation, and the search that adds to it.
 *
 * The search is the share modal's own picker. Choosing somebody invites them at once, one write per
 * person, and the list stays open so several can be added in a row, each keeping their own outcome.
 * Whether the entry can take a guest was asked before this was drawn (`canInvite`), and the door asks
 * again, so a refusal here is a race and reads in the door's words.
 *
 * shortcut: accounts only. `EmailAction` would offer an address, but nothing can reach a person with no
 * account yet, so the row would promise a delivery that does not happen. Add it with that sender.
 */
export function EventGuestList({ event }: { event: CalendarEvent }): JSX.Element {
	const inviting = useSignal<Record<string, PersonActionState>>({});
	const refusal = useSignal<string | null>(null);
	const seated = handleSet(event.roster ?? []);

	async function invite(person: RankedContact): Promise<void> {
		refusal.value = null;
		inviting.value = { ...inviting.value, [person.id]: "busy" };
		const res = await ScheduleService.invite(event.id, [person.id]);
		inviting.value = { ...inviting.value, [person.id]: res.ok ? "done" : "idle" };
		if (res.ok && res.data) publishEvent(res.data.event);
		else refusal.value = res.message ?? "That invitation could not be sent.";
	}

	async function withdraw(seat: EventAttendee): Promise<void> {
		refusal.value = null;
		const res = await ScheduleService.withdrawInvite(event.id, seat.id);
		if (res.ok && res.data) publishEvent(res.data.event);
		else refusal.value = res.message ?? "That invitation could not be withdrawn.";
	}

	return (
		<>
			{event.roster && event.roster.length > 0
				? <EventAttendeePanel roster={event.roster} onWithdraw={(seat) => void withdraw(seat)} />
				: null}
			<section class="cal-sum__guests" aria-label="Invite people">
				<UserSearchPopover
					label="Invite people to this event"
					placeholder="Invite by name or @handle"
					actionLabel="Invite"
					doneLabel="Invited"
					busyLabel="Inviting…"
					hidden={(person) => seated.has(normaliseHandle(person.handle) ?? "")}
					stateOf={(person) => inviting.value[person.id] ?? "idle"}
					onAct={(person) => void invite(person)}
				/>
				{refusal.value ? <p class="evm-refuse" role="alert">{refusal.value}</p> : null}
			</section>
		</>
	);
}

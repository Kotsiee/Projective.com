import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/event-modal.css";
import { Button, InlineEdit } from "@projective/ui/fields";
import { ConfirmPopup } from "@projective/ui/feedback";
import {
	type CalendarEvent,
	type Routine,
	ROUTINE_NAME_MAX,
	type UpdateRoutineInput,
} from "@projective/types/scheduling";
import { agendaReload, calendarPage, deselectRoutine } from "../core/calendar-state.ts";
import { listRows } from "../core/event-series.ts";
import { saveRoutine } from "../core/routine-actions.ts";
import { routineMeta, sessionServicesHref } from "../core/routine-view.ts";
import { EventRecurrenceField } from "./EventRecurrenceField.tsx";
import { AvailabilityBehaviorField } from "./EventOrganiseFields.tsx";

/** Props for {@link RoutineSummary}. */
export interface RoutineSummaryProps {
	routine: Routine;
	tz: string;
}

/**
 * RoutineSummary — the inspector for a routine, in the right panel's first tab (Decision #389): what it
 * is called, how much it holds, whether it holds its time, and the cadence new entries take. Unboxed,
 * in type registers, as {@link EventSummary} is, and each control saves on its own.
 *
 * A passive routine ends on one plain link into Session Services. It is left open for exactly the time
 * a client could be booked into, so this is the moment a marketplace session is a useful thought rather
 * than an advert.
 */
export function RoutineSummary({ routine, tz }: RoutineSummaryProps): JSX.Element {
	const page = calendarPage.value;
	const refusal = useSignal<string | null>(null);
	const now = page?.now ?? Date.now();
	const members = listRows(
		(page?.events ?? []).filter((e) => e.routineId === routine.id),
		now,
		null,
	);

	async function change(next: Omit<UpdateRoutineInput, "id">): Promise<void> {
		refusal.value = await saveRoutine(routine, next);
		// `trg_routine_behavior` moved its entries, which only the agenda's own read can see.
		if (!refusal.value && next.behavior) agendaReload.value++;
	}

	// The field reads a working copy; a cadence has no occurrence of its own to anchor to.
	const cadence: CalendarEvent = {
		id: routine.id,
		title: routine.name,
		kind: "general",
		start: now,
		end: now,
		recurrenceRule: routine.recurrenceRule ?? undefined,
	};

	return (
		<article class="cal-sum" aria-label="Routine details">
			<h2 class="cal-sum__title">
				<InlineEdit
					value={routine.name}
					editable
					displayAs="span"
					maxLength={ROUTINE_NAME_MAX}
					label="Rename this routine"
					placeholder="Untitled routine"
					onCommit={(name) => {
						if (name.trim()) void change({ name: name.trim() });
					}}
				/>
			</h2>
			<p class="cal-sum__meta">{routineMeta(routine, members.length)}</p>

			<section class="evm-doc__sec">
				<h3 class="evm-h">Availability</h3>
				<AvailabilityBehaviorField
					value={routine.behavior}
					onChange={(behavior) => void change({ behavior })}
				/>
			</section>

			<section class="evm-doc__sec">
				<h3 class="evm-h">Repeats</h3>
				<EventRecurrenceField
					event={cadence}
					tz={tz}
					cadenceOnly
					onPatch={(next) => void change({ recurrenceRule: next.recurrenceRule ?? null })}
				/>
				<p class="evm-room__note">New entries in this routine repeat like this.</p>
			</section>

			{refusal.value ? <p class="cal-sum__meta" role="alert">{refusal.value}</p> : null}

			{routine.behavior === "passive"
				? (
					<a class="cal-sum__link" href={sessionServicesHref(routine)}>
						Browse session services for {routine.name}
					</a>
				)
				: null}

			<div class="cal-sum__acts">
				<ConfirmPopup
					label="Archive this routine"
					message="Archive this routine? Its entries stay on your calendar exactly as they are."
					acceptLabel="Archive"
					rejectLabel="Keep"
					acceptSeverity="danger"
					onAccept={() =>
						void saveRoutine(routine, { isActive: false }).then((refused) => {
							refusal.value = refused;
							if (!refused) deselectRoutine();
						})}
					trigger={(api) => (
						<Button
							triggerRef={api.ref}
							size="sm"
							variant="text"
							severity="danger"
							label="Archive"
							aria-expanded={api.expanded ? "true" : "false"}
							aria-controls={api.panelId}
							onClick={api.toggle}
						/>
					)}
				/>
			</div>
		</article>
	);
}

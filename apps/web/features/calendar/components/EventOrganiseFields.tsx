import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Select, SelectButton } from "@projective/ui/fields";
import {
	AVAILABILITY_BEHAVIOR_HINT,
	AVAILABILITY_BEHAVIOR_LABEL,
	AvailabilityBehavior,
	type CalendarEvent,
	type Routine,
} from "@projective/types/scheduling";
import { calendarPage, requestNewRoutine, routinesOn } from "../core/calendar-state.ts";
import { entryHoldsTime, type EntryOrganisation } from "../core/routine-view.ts";

const NONE = "none";
const NEW = "new";

/** Props for {@link AvailabilityBehaviorField}. */
export interface AvailabilityBehaviorFieldProps {
	value: AvailabilityBehavior;
	onChange: (next: AvailabilityBehavior) => void;
}

/** The two behaviours, and what the picked one does, said where the choice is made. */
export function AvailabilityBehaviorField(props: AvailabilityBehaviorFieldProps): JSX.Element {
	const { value, onChange } = props;
	// A raw value would seed once and freeze (`useControllable`), and a routine can move this one.
	const bound = useSignal<string>(value);
	useEffect(() => {
		bound.value = value;
	}, [value]);
	return (
		<div class="cal-behavior">
			<SelectButton
				size="sm"
				value={bound}
				aria-label="Availability behavior"
				options={AvailabilityBehavior.options.map((b) => ({
					value: b,
					label: AVAILABILITY_BEHAVIOR_LABEL[b],
				}))}
				onValueChange={(next) => {
					// Pressing the picked one is no choice: there is always a behaviour.
					if (next && next !== value) onChange(next as AvailabilityBehavior);
					else bound.value = value;
				}}
			/>
			<p class="cal-behavior__hint">{AVAILABILITY_BEHAVIOR_HINT[value]}</p>
		</div>
	);
}

/** Props for {@link EventOrganiseFields}. */
export interface EventOrganiseFieldsProps {
	event: CalendarEvent;
	onChange: (change: EntryOrganisation) => void;
	/** The routine it just joined, for a composer that takes its cadence too. */
	onJoin?: (routine: Routine) => void;
}

/**
 * EventOrganiseFields — whether an entry holds its time against bookings, and which routine it is in,
 * for the event modal and the inspector alike (Decision #389).
 *
 * A commitment gets the ANSWER rather than a control it could only be refused on: somebody else is
 * relying on it, so it holds its time. Joining a routine takes on the routine's behaviour, and the
 * Availability row shows that happen, so nothing changes out of sight.
 */
export function EventOrganiseFields(props: EventOrganiseFieldsProps): JSX.Element {
	const { event, onChange, onJoin } = props;
	const routines = routinesOn(calendarPage.value);
	const holds = entryHoldsTime(event);
	// An archived routine is not on offer, so an entry still in one reads as in none.
	const current = routines.some((r) => r.id === event.routineId) ? event.routineId! : NONE;
	const picked = useSignal<string>(current);
	useEffect(() => {
		picked.value = current;
	}, [current]);

	function join(routine: Routine): void {
		onChange({
			routineId: routine.id,
			...(holds ? {} : { availabilityBehavior: routine.behavior }),
		});
		onJoin?.(routine);
	}

	return (
		<>
			<section class="evm-doc__sec">
				<h3 class="evm-h">Availability</h3>
				{holds
					? (
						<p class="evm-room__note">
							Disruptive. Somebody is relying on this, so it always blocks bookings.
						</p>
					)
					: (
						<AvailabilityBehaviorField
							value={event.availabilityBehavior ?? "disruptive"}
							onChange={(availabilityBehavior) => onChange({ availabilityBehavior })}
						/>
					)}
			</section>
			<section class="evm-doc__sec">
				<h3 class="evm-h">Routine</h3>
				<Select
					size="sm"
					value={picked}
					aria-label="Routine"
					options={[
						{ value: NONE, label: "No routine" },
						...routines.map((r) => ({ value: r.id, label: r.name })),
						{ value: NEW, label: "New routine…" },
					]}
					onValueChange={(next) => {
						if (next === NEW) {
							picked.value = current;
							requestNewRoutine(join);
							return;
						}
						const routine = routines.find((r) => r.id === next);
						if (routine) join(routine);
						else if (next === NONE && current !== NONE) onChange({ routineId: null });
					}}
				/>
			</section>
		</>
	);
}

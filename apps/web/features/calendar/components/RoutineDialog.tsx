import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button, FormControl, InputText } from "@projective/ui/fields";
import {
	type AvailabilityBehavior,
	type CalendarEvent,
	ROUTINE_NAME_MAX,
} from "@projective/types/scheduling";
import { finishNewRoutine, routineDialogOpen } from "../core/calendar-state.ts";
import { ScheduleService } from "../core/ScheduleService.ts";
import { EventRecurrenceField } from "./EventRecurrenceField.tsx";
import { AvailabilityBehaviorField } from "./EventOrganiseFields.tsx";

/** Props for {@link RoutineDialog}. */
export interface RoutineDialogProps {
	/** IANA display zone: a cadence is read against today in the schedule's own zone. */
	tz: string;
	/** The page's clock, which anchors a cadence that depends on a date ("Monthly on the 5th"). */
	now: number;
}

/** The form, remounted each time so a cancelled draft does not come back. */
function RoutineForm(
	{ tz, now, nameRef }: RoutineDialogProps & { nameRef: RefObject<HTMLDivElement> },
): JSX.Element {
	const name = useSignal("");
	const behavior = useSignal<AvailabilityBehavior>("passive");
	// The recurrence field works on a working copy, and this is the least of one that it can read.
	const cadence = useSignal<CalendarEvent>({
		id: "routine-cadence",
		title: "",
		kind: "general",
		start: now,
		end: now,
	});
	const busy = useSignal(false);
	const refusal = useSignal<string | null>(null);
	const blank = !name.value.trim();

	async function create(): Promise<void> {
		if (blank || busy.value) return;
		busy.value = true;
		refusal.value = null;
		const res = await ScheduleService.createRoutine({
			name: name.value,
			behavior: behavior.value,
			recurrenceRule: cadence.value.recurrenceRule ?? null,
		});
		busy.value = false;
		if (!res.ok || !res.data) {
			refusal.value = res.message ?? "That routine could not be created.";
			return;
		}
		finishNewRoutine(res.data.routine);
	}

	return (
		<form
			class="cal-rtn-form"
			onSubmit={(e) => {
				e.preventDefault();
				void create();
			}}
		>
			<div ref={nameRef}>
				<FormControl label="Name">
					{({ id, describedBy }) => (
						<InputText
							id={id}
							aria-describedby={describedBy}
							size="sm"
							value={name}
							maxLength={ROUTINE_NAME_MAX}
							placeholder="Gym, focused work, Spanish"
						/>
					)}
				</FormControl>
			</div>
			<section class="evm-doc__sec">
				<h3 class="evm-h">Availability</h3>
				<AvailabilityBehaviorField
					value={behavior.value}
					onChange={(next) => (behavior.value = next)}
				/>
			</section>
			<section class="evm-doc__sec">
				<h3 class="evm-h">Repeats</h3>
				<EventRecurrenceField
					event={cadence.value}
					tz={tz}
					cadenceOnly
					onPatch={(next) => (cadence.value = { ...cadence.value, ...next })}
				/>
			</section>
			{refusal.value ? <Message severity="warning" size="sm">{refusal.value}</Message> : null}
			<div class="cal-rtn-form__foot">
				<Button
					type="button"
					variant="text"
					size="sm"
					onClick={() => (routineDialogOpen.value = false)}
				>
					Cancel
				</Button>
				<Button type="submit" variant="filled" size="sm" loading={busy.value} disabled={blank}>
					Create routine
				</Button>
			</div>
		</form>
	);
}

/**
 * RoutineDialog — name a routine, say whether it holds its time, and give it a cadence (Decision #389).
 * Mounted once by the body, and opened through {@link routineDialogOpen} from the lane and the event
 * modal. `Dialog` is the overlay family's own surface: portalled, stacked and trapped, above the modal
 * too. It takes the signal itself, because a raw `visible` only seeds it, and opens with the caret in
 * Name, because the dialog's first tabbable is otherwise its close button.
 */
export function RoutineDialog(props: RoutineDialogProps): JSX.Element {
	const nameRef = useRef<HTMLDivElement>(null);
	return (
		<Dialog
			visible={routineDialogOpen}
			header="New routine"
			width="28rem"
			initialFocusRef={nameRef}
		>
			{routineDialogOpen.value ? <RoutineForm {...props} nameRef={nameRef} /> : null}
		</Dialog>
	);
}

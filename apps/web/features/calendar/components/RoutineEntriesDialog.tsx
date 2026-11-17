import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { calendarTime } from "@projective/ui/calendar";
import { Dialog } from "@projective/ui/feedback";
import { Button, FormControl, MultiSelect, Select } from "@projective/ui/fields";
import type { CalendarEvent, Routine } from "@projective/types/scheduling";
import {
	openRoutines,
	requestOrganise,
	routineEntriesFor,
	routineEntriesOpen,
} from "../core/calendar-state.ts";
import { listRows } from "../core/event-series.ts";
import { entryOrganisable } from "../core/routine-actions.ts";
import { joinRoutine } from "../core/routine-view.ts";
import { agendaRowTitle } from "./AgendaRow.tsx";

/** Props for {@link RoutineEntriesDialog}. */
export interface RoutineEntriesDialogProps {
	/** Every entry on the page; those the reader may organise are offered, a series once. */
	events: readonly CalendarEvent[];
	routines: readonly Routine[];
	tz: string;
	now: number;
}

/** The form, remounted each time so a cancelled pick does not come back. */
function EntriesForm(
	{ events, routines, tz, now, fieldRef }: RoutineEntriesDialogProps & {
		fieldRef: RefObject<HTMLDivElement>;
	},
): JSX.Element {
	const asked = routineEntriesFor.peek();
	const routineId = useSignal<string>(
		routines.find((r) => r.id === asked)?.id ?? routines[0]?.id ?? "",
	);
	const picked = useSignal<string[]>([]);
	const routine = routines.find((r) => r.id === routineId.value) ?? null;
	const offered = listRows(
		events.filter((e) => entryOrganisable(e) && e.routineId !== routine?.id),
		now,
		null,
	);
	const count = picked.value.filter((id) => offered.some((e) => e.id === id)).length;

	function add(): void {
		if (!routine) return;
		for (const event of offered) {
			if (picked.value.includes(event.id)) requestOrganise(event, joinRoutine(event, routine));
		}
		if (!openRoutines.peek().includes(routine.id)) {
			openRoutines.value = [...openRoutines.peek(), routine.id];
		}
		routineEntriesOpen.value = false;
	}

	return (
		<form
			class="cal-rtn-form"
			onSubmit={(e) => {
				e.preventDefault();
				add();
			}}
		>
			<FormControl label="Routine">
				{({ id, describedBy }) => (
					<Select
						id={id}
						aria-describedby={describedBy}
						size="sm"
						value={routineId}
						options={routines.map((r) => ({ value: r.id, label: r.name }))}
					/>
				)}
			</FormControl>
			<div ref={fieldRef}>
				<FormControl label="Entries">
					{({ id, describedBy }) => (
						<MultiSelect
							id={id}
							aria-describedby={describedBy}
							size="sm"
							filter
							value={picked}
							placeholder={offered.length > 0 ? "Choose entries" : "Nothing left to add"}
							disabled={offered.length === 0}
							options={offered.map((e) => ({
								value: e.id,
								label: agendaRowTitle(e),
								description: calendarTime.fmtDayLabel(e.start, tz),
							}))}
						/>
					)}
				</FormControl>
			</div>
			<div class="cal-rtn-form__foot">
				<Button
					type="button"
					variant="text"
					size="sm"
					onClick={() => (routineEntriesOpen.value = false)}
				>
					Cancel
				</Button>
				<Button type="submit" variant="filled" size="sm" disabled={!routine || count === 0}>
					{count > 1 ? `Add ${count} entries` : "Add entry"}
				</Button>
			</div>
		</form>
	);
}

/**
 * RoutineEntriesDialog — gather existing entries into a routine at once (Decision #441), the lane's
 * right-click "Add entries to a routine". A series lists once and moves whole, as a drag moves it, and
 * each entry takes the routine's behaviour on joining. Mounted by the lane, opened through
 * {@link routineEntriesOpen}; a raw `visible` would only seed the `Dialog`, so it takes a signal.
 */
export function RoutineEntriesDialog(props: RoutineEntriesDialogProps): JSX.Element {
	const fieldRef = useRef<HTMLDivElement>(null);
	return (
		<Dialog
			visible={routineEntriesOpen}
			header="Add entries to a routine"
			width="28rem"
			initialFocusRef={fieldRef}
		>
			{routineEntriesOpen.value ? <EntriesForm {...props} fieldRef={fieldRef} /> : null}
		</Dialog>
	);
}

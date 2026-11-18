import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { calendarTime } from "@projective/ui/calendar";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button, Checkbox, FormControl, InputText } from "@projective/ui/fields";
import { type AvailabilityBehavior, ROUTINE_NAME_MAX } from "@projective/types/scheduling";
import { describeRepeat, fromRRule, repeatAnchor } from "../core/event-recurrence.ts";
import {
	assignRoutine,
	clearRoutine,
	type ImportGroup,
	type ImportPlan,
	mergeGroups,
	setIncluded,
	splitGroup,
	tallyPlan,
} from "../core/import-plan.ts";
import type { CalendarImport } from "../hooks/useCalendarImport.ts";
import { AvailabilityBehaviorField } from "./EventOrganiseFields.tsx";

/** Props for {@link CalendarImportReview}. */
export interface CalendarImportReviewProps {
	flow: CalendarImport;
	tz: string;
}

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** When one entry happens, in the Meta register. */
function whenOf(g: ImportGroup, tz: string): string {
	const first = g.items[0];
	const day = calendarTime.fmtDayLabel(first.start, tz);
	if (first.allDay) {
		const lastDay = calendarTime.fmtDayLabel(first.end - 1, tz);
		return lastDay === day ? `${day} · All day` : `${day} – ${lastDay} · All day`;
	}
	if (first.end <= first.start) return `${day} · ${calendarTime.fmtTime(first.start, tz)}`;
	return `${day} · ${calendarTime.fmtTime(first.start, tz)} – ${
		calendarTime.fmtTime(first.end, tz)
	}`;
}

/** How a series repeats, in one sentence: "Weekly on Monday", or "Repeats" for a rule beyond words. */
function repeatOf(g: ImportGroup, tz: string): string {
	const rule = g.rule ?? "";
	const draft = /BYDAY=[+-]?\d/i.test(rule) ? null : fromRRule(rule);
	return draft ? describeRepeat(draft, repeatAnchor(g.items[0].start, tz)) : "Repeats";
}

function seriesMeta(g: ImportGroup, tz: string): string {
	const first = g.items[0];
	const last = g.items[g.items.length - 1];
	const time = first.allDay ? "All day" : calendarTime.fmtTime(first.start, tz);
	return [
		repeatOf(g, tz),
		time,
		plural(g.items.length, "event", "events"),
		`${calendarTime.fmtDayLabel(first.start, tz)} – ${calendarTime.fmtDayLabel(last.start, tz)}`,
	].join(" · ");
}

const ORIGIN: Record<ImportGroup["origin"], string> = {
	file: "Repeats in the file",
	detected: "Found repeating",
	merged: "Merged",
	single: "",
};

/**
 * A checkbox driven by its parent's selection. `Checkbox` takes a raw boolean only as a seed, so
 * select-all and a merge that drops rows would leave the boxes showing the old state; a bound
 * signal kept in step with the prop is what makes it follow.
 */
function SelectBox(
	props: {
		checked: boolean;
		indeterminate?: boolean;
		onCheck: (on: boolean) => void;
		label?: string;
		ariaLabel?: string;
		disabled?: boolean;
	},
): JSX.Element {
	const bound = useSignal(props.checked);
	useEffect(() => {
		bound.value = props.checked;
	}, [props.checked]);
	return (
		<Checkbox
			class="cal-importrev__check"
			value={bound}
			indeterminate={props.indeterminate}
			onValueChange={props.onCheck}
			label={props.label}
			aria-label={props.ariaLabel}
			disabled={props.disabled}
		/>
	);
}

/** One group's row: a selection box, what it is, and the one-line facts about it. */
function GroupRow(
	{ group, plan, tz, checked, onCheck, disabled }: {
		group: ImportGroup;
		plan: ImportPlan;
		tz: string;
		checked: boolean;
		onCheck: (on: boolean) => void;
		disabled: boolean;
	},
): JSX.Element {
	const series = group.rule !== null && group.items.length > 1;
	const routine = plan.routines.find((r) => r.key === group.routine) ?? null;
	const facts = [
		series ? seriesMeta(group, tz) : whenOf(group, tz),
		series ? ORIGIN[group.origin] : "",
		group.duplicates === group.items.length
			? "Already on your calendar"
			: group.duplicates > 0
			? `${group.duplicates} already on your calendar`
			: "",
		routine ? `New routine: ${routine.name}` : "",
		group.included ? "" : "Left out",
	].filter(Boolean).join(" · ");
	return (
		<li
			class="cal-importrev__row"
			data-excluded={group.included ? undefined : "true"}
			data-checked={checked ? "true" : undefined}
		>
			<SelectBox
				checked={checked}
				onCheck={onCheck}
				ariaLabel={`Select ${group.items[0].title || "Untitled event"}`}
				disabled={disabled}
			/>
			<span class="cal-importrev__what">
				<span class="cal-importrev__title">{group.items[0].title || "Untitled event"}</span>
				<span class="cal-importrev__facts">{facts}</span>
			</span>
		</li>
	);
}

/**
 * CalendarImportReview — the review a larger calendar file gets before anything is saved (Decision
 * #442): every entry it will create, with repeats already merged into one repeating entry (the
 * file's own series, and runs of identical entries `import-plan.ts` found), and what is already on
 * the calendar already left out.
 *
 * The reader selects rows and merges them into a repeating entry, puts them in a new routine, splits
 * a series back into single entries, or leaves them out; then Import writes the plan through the event
 * door, saying how far it has got. A row is a selection box and two lines of text — the title, and
 * its facts as one Meta line (§B.11), nothing boxed or tagged. `Dialog` takes the signal itself.
 */
export function CalendarImportReview(props: CalendarImportReviewProps): JSX.Element {
	const { flow, tz } = props;
	const selected = useSignal<readonly string[]>([]);
	const routineName = useSignal("");
	const routineBehavior = useSignal<AvailabilityBehavior>("disruptive");
	const naming = useSignal(false);
	const refusal = useSignal<string | null>(null);

	const session = flow.session.value;
	const plan = session?.plan ?? null;
	const busy = session?.busy ?? false;
	const groups = plan?.groups ?? [];
	const picked = groups.filter((g) => selected.value.includes(g.id));
	const ids = picked.map((g) => g.id);
	const tally = plan ? tallyPlan(plan) : null;

	function apply(next: ImportPlan, keep: readonly string[] = []): void {
		flow.setPlan(next);
		selected.value = keep.filter((id) => next.groups.some((g) => g.id === id));
		refusal.value = null;
	}

	function merge(): void {
		if (!plan) return;
		const result = mergeGroups(plan, ids, tz);
		if (!result.ok) {
			refusal.value = result.message;
			return;
		}
		apply(result.plan);
	}

	function makeRoutine(): void {
		if (!plan) return;
		const result = assignRoutine(plan, ids, {
			name: routineName.value,
			behavior: routineBehavior.value,
		});
		if (!result.ok) {
			refusal.value = result.message;
			return;
		}
		naming.value = false;
		routineName.value = "";
		apply(result.plan);
	}

	function split(): void {
		if (!plan) return;
		let next = plan;
		for (const id of ids) next = splitGroup(next, id);
		apply(next);
	}

	const allOut = picked.length > 0 && picked.every((g) => !g.included);
	const anyRoutine = picked.some((g) => g.routine);
	const mergeable = picked.reduce((n, g) => n + g.items.length, 0) >= 2;
	const splittable = picked.some((g) => g.items.length > 1);
	const everyPicked = groups.length > 0 && picked.length === groups.length;
	const name = session?.preview.calendarName ?? "";

	const footer = (
		<div class="cal-importrev__foot">
			<p class="cal-importrev__tally" role="status" aria-live="polite">
				{busy && session
					? `Saving ${session.done} of ${plural(session.total, "event", "events")}…`
					: tally
					? [
						plural(tally.entries, "event", "events"),
						tally.series > 0 ? plural(tally.series, "repeating event", "repeating events") : "",
						tally.routines > 0 ? plural(tally.routines, "new routine", "new routines") : "",
					].filter(Boolean).join(" · ")
					: ""}
			</p>
			<Button variant="text" size="sm" onClick={flow.close}>
				{busy ? "Close" : "Cancel"}
			</Button>
			<Button
				variant="filled"
				size="sm"
				loading={busy}
				disabled={busy || !tally || tally.entries === 0}
				onClick={() => void flow.commit()}
			>
				{tally && tally.entries > 0
					? `Import ${plural(tally.entries, "event", "events")}`
					: "Import"}
			</Button>
		</div>
	);

	return (
		<Dialog
			visible={flow.reviewing}
			header="Review import"
			width="44rem"
			class="cal-importrev"
			footer={footer}
			onVisibleChange={(open) => {
				if (open) return;
				selected.value = [];
				naming.value = false;
				refusal.value = null;
				flow.close();
			}}
		>
			{plan && session
				? (
					<div class="cal-importrev__body">
						<p class="cal-importrev__summary">
							{[
								`${
									plural(session.preview.items.length + plan.copies, "event", "events")
								} in ${name}`,
								plan.groups.some((g) => g.origin === "file" || g.origin === "detected")
									? "repeats merged into repeating events"
									: "",
								plan.onCalendar.size > 0 ? `${plan.onCalendar.size} already on your calendar` : "",
								plan.copies > 0 ? plural(plan.copies, "copy left out", "copies left out") : "",
								plan.cancelled > 0
									? plural(plan.cancelled, "cancelled event left out", "cancelled events left out")
									: "",
							].filter(Boolean).join(" · ")}
						</p>
						{session.preview.warnings.length > 0
							? (
								<Message severity="warning" size="sm">
									{session.preview.warnings[0]}
									{session.preview.warnings.length > 1
										? ` And ${
											plural(session.preview.warnings.length - 1, "more note", "more notes")
										}.`
										: ""}
								</Message>
							)
							: null}
						{refusal.value || session.error
							? <Message severity="warning" size="sm">{refusal.value ?? session.error}</Message>
							: null}

						<div class="cal-importrev__tools" role="toolbar" aria-label="Selected entries">
							<SelectBox
								checked={everyPicked}
								indeterminate={picked.length > 0 && !everyPicked}
								onCheck={(on) => (selected.value = on ? groups.map((g) => g.id) : [])}
								label={picked.length > 0 ? `${picked.length} selected` : "Select all"}
								disabled={busy}
							/>
							<span class="cal-importrev__actions">
								<Button
									variant="text"
									size="sm"
									disabled={busy || !mergeable}
									onClick={merge}
								>
									Merge into repeating event
								</Button>
								<Button
									variant="text"
									size="sm"
									disabled={busy || picked.length === 0}
									onClick={() => {
										refusal.value = null;
										naming.value = true;
									}}
								>
									Put in a routine
								</Button>
								<Button variant="text" size="sm" disabled={busy || !splittable} onClick={split}>
									Import separately
								</Button>
								{anyRoutine
									? (
										<Button
											variant="text"
											size="sm"
											disabled={busy}
											onClick={() => apply(clearRoutine(plan, ids), ids)}
										>
											No routine
										</Button>
									)
									: null}
								<Button
									variant="text"
									size="sm"
									disabled={busy || picked.length === 0}
									onClick={() => apply(setIncluded(plan, ids, allOut), ids)}
								>
									{allOut ? "Include" : "Leave out"}
								</Button>
							</span>
						</div>

						{naming.value
							? (
								<form
									class="cal-importrev__routine"
									onSubmit={(e) => {
										e.preventDefault();
										makeRoutine();
									}}
								>
									<FormControl label="Routine name">
										{({ id, describedBy }) => (
											<InputText
												id={id}
												aria-describedby={describedBy}
												size="sm"
												value={routineName}
												maxLength={ROUTINE_NAME_MAX}
												placeholder={picked[0]?.items[0].title ?? "Gym, focused work"}
											/>
										)}
									</FormControl>
									<AvailabilityBehaviorField
										value={routineBehavior.value}
										onChange={(next) => (routineBehavior.value = next)}
									/>
									<div class="cal-importrev__routinefoot">
										<Button
											type="button"
											variant="text"
											size="sm"
											onClick={() => (naming.value = false)}
										>
											Cancel
										</Button>
										<Button
											type="submit"
											variant="outlined"
											size="sm"
											disabled={!routineName.value.trim()}
										>
											Put {plural(picked.length, "entry", "entries")} in it
										</Button>
									</div>
								</form>
							)
							: null}

						<ul class="cal-importrev__list" aria-label="Entries to import">
							{groups.map((g) => (
								<GroupRow
									key={g.id}
									group={g}
									plan={plan}
									tz={tz}
									checked={selected.value.includes(g.id)}
									disabled={busy}
									onCheck={(on) =>
										selected.value = on
											? [...selected.peek(), g.id]
											: selected.peek().filter((id) => id !== g.id)}
								/>
							))}
						</ul>
					</div>
				)
				: null}
		</Dialog>
	);
}

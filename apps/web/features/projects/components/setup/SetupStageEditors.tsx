import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useLayoutEffect, useRef } from "preact/hooks";
import { InputText, NumberInput, type Option, Textarea } from "@projective/ui/fields";
import { DndContext, DropIndicator, useSortable } from "@projective/ui/dnd";
import { Icon } from "@projective/ui/icons";
import { currencyExponent, toMinorUnits } from "@projective/types/finance";
import { ROLE_INSTRUCTIONS_MAX } from "../../types/projects-types.ts";
import type { StageSetup, StageStaffingRole, StageTask } from "../../types/projects-types.ts";
import { FieldGuard, fieldStatus } from "../../core/setup-validation.ts";
import { arrayMove, Field, newRowId } from "./setup-primitives.tsx";
import {
	COUNT_FIELD,
	minorUnit,
	MONEY_FIELD,
	ROLE_BONUS_HINT,
	ROLE_INSTRUCTIONS_PLACEHOLDER,
	roleBonusLabel,
	roleInstructionsLabel,
	toMajor,
} from "./setup-format.ts";

/**
 * SetupStageEditors — the list editors nested inside one stage's configuration: its default step
 * checklist, its named staffing roles, and the three-state NDA override it may carry.
 *
 * Shared by {@link StageFields} (a stage in the run) and the flat Details section (the root stage of an
 * engagement that is not broken into stages), so both surfaces edit a stage's lists with one control.
 */

// #region Stage sub-editors
/**
 * The DOM id of one step's input — the handle focus management works through.
 *
 * An id rather than a ref map, because `InputText` exposes no ref and the rows this list focuses are
 * frequently ones that did not exist a moment ago: pressing Enter creates a row and then focuses it,
 * so whatever is focused must be resolvable AFTER the render that created it. A ref collected during
 * the previous render is by definition a ref to the wrong set of rows.
 *
 * Scoped by stage as well as by task so the flat-details form (which renders this list for the root
 * stage) and a stage's own disclosure cannot mint the same id on one page.
 */
function taskInputId(stageId: string, taskId: string): string {
	return `psu-task-${stageId}-${taskId}`;
}

/** Strip the sortable's namespace back to the task id it wraps. */
const taskIdOf = (raw: string): string => String(raw).replace("task:", "");

/** One step: a grip, the text, and a remove control. */
function TaskRow(props: {
	stageId: string;
	task: StageTask;
	index: number;
	onText: (text: string) => void;
	onRemove: () => void;
	onKeyDown: (event: KeyboardEvent) => void;
}): JSX.Element {
	const { task, index } = props;
	const sortable = useSortable({
		id: `task:${task.id}`,
		data: { type: "task", accepts: ["task"] },
		roleDescription: "step",
	});

	return (
		<div
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="psu-task"
			data-dragging={sortable.isDragging.value || undefined}
			/*
			 * The keyboard rules are bound HERE, on the row, rather than on the control.
			 *
			 * `InputText` declares no `onKeyDown`, and `keydown` bubbles — so one listener on the row
			 * covers the input without the package growing a prop, and without this file depending on a
			 * handler that only works because a rest spread happens to forward it.
			 */
			onKeyDown={props.onKeyDown}
		>
			<button
				type="button"
				class="psu-task__grip"
				aria-label={`Reorder step ${index + 1}`}
				aria-roledescription={sortable.attributes["aria-roledescription"]}
				tabIndex={sortable.attributes.tabIndex}
				onPointerDown={sortable.listeners.onPointerDown}
				onKeyDown={sortable.listeners.onKeyDown}
			>
				<Icon name="grip" size="xs" />
			</button>
			<InputText
				id={taskInputId(props.stageId, task.id)}
				value={task.text}
				onValueChange={props.onText}
				block
				maxLength={240}
				placeholder={`Step ${index + 1}`}
				aria-label={`Step ${index + 1}`}
				status={task.text.trim() ? "default" : "required"}
			/>
			<button
				type="button"
				class="psu-stage__remove"
				aria-label={`Remove step ${index + 1}`}
				onClick={props.onRemove}
			>
				<Icon name="trash" />
			</button>
		</div>
	);
}

/**
 * The default checklist a ticket on a stage is seeded from.
 *
 * Written as a LIST EDITOR rather than as a column of text fields, because that is what somebody
 * typing a checklist expects it to be: Enter starts the next step, Backspace on an empty one removes
 * it, and the rows drag. Before this, Enter fell through to the form-wide "advance focus" rule and
 * landed on the row's own delete button — so the natural keystroke for "next item" put the reader one
 * space bar away from destroying the item they had just written.
 *
 * Order is meaningful — a checklist is a sequence of work, not a set — so the landing position is
 * drawn by the shared {@link DropIndicator} rather than left to a highlighted neighbour, which cannot
 * express before-or-after.
 */
export function TaskList(props: {
	stage: StageSetup;
	itemLabel: string;
	onPatch: (patch: Partial<StageSetup>) => void;
}): JSX.Element {
	const { stage } = props;
	const dragIndex = useSignal<number | null>(null);
	const overIndex = useSignal<number | null>(null);

	/**
	 * The step whose input should hold focus once this render has landed.
	 *
	 * A ref rather than a signal: consuming it must not itself schedule a render, and nothing outside
	 * the layout effect below ever reads it.
	 */
	const pendingFocus = useRef<string | null>(null);

	/*
	 * Focus is moved AFTER the DOM has been updated and BEFORE the browser paints.
	 *
	 * `useLayoutEffect` rather than `useEffect` for the second half of that: a row created by Enter
	 * would otherwise be painted unfocused for one frame and then focused, which on a slow frame reads
	 * as the caret jumping. No dependency array, because the request is consumed on whichever render
	 * follows the patch that raised it, and that render is not identified by any value in this scope.
	 */
	useLayoutEffect(() => {
		const id = pendingFocus.current;
		if (!id) return;
		pendingFocus.current = null;
		const el = document.getElementById(id);
		if (!(el instanceof HTMLInputElement)) return;
		el.focus();
		// Caret at the END, never a selection. After a Backspace-merge the reader is continuing a line
		// they already wrote, and selecting it would mean their next keystroke replaced it.
		const end = el.value.length;
		try {
			el.setSelectionRange(end, end);
		} catch {
			// Some input types refuse a selection range. Focus alone is the part that matters.
		}
	});

	const patchTask = (id: string, text: string) => {
		props.onPatch({ tasks: stage.tasks.map((t) => (t.id === id ? { ...t, text } : t)) });
	};

	const removeTask = (id: string) => {
		props.onPatch({ tasks: stage.tasks.filter((t) => t.id !== id) });
	};

	/** Append an empty step and put the caret in it — the "Add step" control's whole job. */
	const appendTask = () => {
		const id = newRowId("task");
		props.onPatch({ tasks: [...stage.tasks, { id, text: "" }] });
		pendingFocus.current = taskInputId(stage.id, id);
	};

	/**
	 * Enter inserts below; Backspace on an empty step removes it and steps back.
	 *
	 * **Enter inserts BELOW the current row, not at the end.** A checklist is written in order, and
	 * somebody who has gone back to expand step 2 means the new step to follow step 2 — appending it
	 * to the bottom would make the one keystroke that feels like "continue" the one that scatters the
	 * sequence.
	 *
	 * **Backspace only fires on an EMPTY step**, which is what makes it safe to make destructive: on a
	 * row with text it is an ordinary character delete and is left entirely alone. Focus then moves to
	 * the row ABOVE — the direction the reader was travelling — falling back to the row that took the
	 * deleted one's place when there is nothing above, so deleting the first step does not drop focus
	 * out of the list. Deleting the ONLY step leaves nothing to focus, and the "Add step" control is
	 * the next thing in the tab order, which is the correct place to land.
	 */
	const onRowKeyDown = (event: KeyboardEvent, index: number) => {
		const target = event.target;
		// The grip is a button inside the row and owns its own keys (the DnD keyboard sensor). Only the
		// text control's keys are this list's to interpret.
		if (!(target instanceof HTMLInputElement)) return;
		// A modified press is somebody asking for something else — leave it to the browser.
		if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.isComposing) return;

		if (event.key === "Enter") {
			event.preventDefault();
			const id = newRowId("task");
			const next = stage.tasks.slice();
			next.splice(index + 1, 0, { id, text: "" });
			props.onPatch({ tasks: next });
			pendingFocus.current = taskInputId(stage.id, id);
			return;
		}

		if (event.key === "Backspace" && target.value.length === 0) {
			event.preventDefault();
			const neighbour = stage.tasks[index - 1] ?? stage.tasks[index + 1] ?? null;
			removeTask(stage.tasks[index].id);
			if (neighbour) pendingFocus.current = taskInputId(stage.id, neighbour.id);
		}
	};

	// The seam is drawn on the side of the hovered row the dragged step would land on.
	const from = dragIndex.value;
	const over = overIndex.value;
	const seamBefore = from !== null && over !== null && from > over ? over : null;
	const seamAfter = from !== null && over !== null && from < over ? over : null;

	return (
		<Field
			label="Default task list"
			hint="Every ticket opened on this stage starts with these steps. Press Enter for the next one."
		>
			{
				/*
				 * `.psu-tasks` is named in `ENTER_OWNERS` (`core/setup-validation.ts`), which is what stops
				 * the form-wide advance-on-Enter rule from running first. That rule is a CAPTURE listener on
				 * the form root, so it fires before this row's own handler and would already have moved
				 * focus and called `preventDefault` — the opt-out is the only place the conflict can be
				 * resolved.
				 */
			}
			<div class="psu-tasks">
				<DndContext
					onDragStart={(e) => {
						dragIndex.value = stage.tasks.findIndex((t) => t.id === taskIdOf(String(e.active.id)));
					}}
					onDragOver={(e) => {
						overIndex.value = e.over === null
							? null
							: stage.tasks.findIndex((t) => t.id === taskIdOf(String(e.over)));
					}}
					onDragEnd={(e) => {
						const start = dragIndex.value;
						const target = e.over === null
							? null
							: stage.tasks.findIndex((t) => t.id === taskIdOf(String(e.over)));
						dragIndex.value = null;
						overIndex.value = null;
						if (e.canceled || start === null || target === null || target < 0 || start < 0) {
							return;
						}
						if (start === target) return;
						props.onPatch({ tasks: arrayMove(stage.tasks, start, target) });
					}}
				>
					<ul class="psu-tasks__list" role="list">
						{stage.tasks.map((task: StageTask, index: number) => (
							<li key={task.id} class="psu-tasks__slot">
								<DropIndicator active={seamBefore === index} />
								<TaskRow
									stageId={stage.id}
									task={task}
									index={index}
									onText={(text: string) =>
										patchTask(task.id, text)}
									onRemove={() =>
										removeTask(task.id)}
									onKeyDown={(event) => onRowKeyDown(event, index)}
								/>
								<DropIndicator active={seamAfter === index} />
							</li>
						))}
					</ul>
				</DndContext>
			</div>
			<button type="button" class="psu-add psu-add--sm" onClick={appendTask}>
				<Icon name="plus" />
				Add step
			</button>
		</Field>
	);
}

/**
 * Named roles this stage staffs.
 *
 * Distinct from the project-level roles a Direct Deliverable takes: these hang off one stage, and a
 * project may have several sets of them. An empty list is a real answer — the stage is then an
 * unnamed pool governed by its seat settings alone.
 */
export function StageRoleList(props: {
	stage: StageSetup;
	currency: string;
	onPatch: (patch: Partial<StageSetup>) => void;
}): JSX.Element {
	const { stage, currency } = props;
	const exponent = currencyExponent(currency);

	const patchRole = (id: string, patch: Partial<StageStaffingRole>) => {
		props.onPatch({ roles: stage.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
	};

	return (
		<Field
			label="Named roles"
			hint={`Leave empty to staff this stage from one open pool instead. ${ROLE_BONUS_HINT}`}
		>
			<ul class="psu-rows" role="list">
				{stage.roles.map((role: StageStaffingRole) => {
					const key = `stage:${stage.id}:role:${role.id}:name`;
					return (
						<li key={role.id} class="psu-rows__row psu-rows__row--wrap">
							<FieldGuard fieldKey={key} class="psu-rows__grow">
								<InputText
									value={role.name}
									onValueChange={(name: string) => patchRole(role.id, { name })}
									block
									maxLength={120}
									placeholder="e.g. Lead designer"
									aria-label="Role name"
									status={fieldStatus(key, role.name.trim() ? "default" : "required")}
								/>
							</FieldGuard>
							<NumberInput
								{...COUNT_FIELD}
								icon="members"
								value={role.quantity}
								onValueChange={(v: number | null) =>
									patchRole(role.id, { quantity: Math.max(1, Math.min(99, Math.round(v ?? 1))) })}
								min={1}
								max={99}
								aria-label={`How many ${role.name || "people"}`}
							/>
							<NumberInput
								{...MONEY_FIELD}
								value={toMajor(role.budgetCents, currency)}
								onValueChange={(v: number | null) =>
									patchRole(role.id, { budgetCents: toMinorUnits(v, currency) })}
								currency={currency}
								maxFractionDigits={exponent}
								minFractionDigits={exponent}
								precisionStep={minorUnit(currency)}
								aria-label={roleBonusLabel(role.name)}
							/>
							<button
								type="button"
								class="psu-stage__remove"
								aria-label={`Remove ${role.name || "role"}`}
								onClick={() =>
									props.onPatch({ roles: stage.roles.filter((r) => r.id !== role.id) })}
							>
								<Icon name="trash" />
							</button>
							<Textarea
								class="psu-rows__note"
								value={role.description}
								onValueChange={(description: string) => patchRole(role.id, { description })}
								rows={2}
								maxLength={ROLE_INSTRUCTIONS_MAX}
								placeholder={ROLE_INSTRUCTIONS_PLACEHOLDER}
								aria-label={roleInstructionsLabel(role.name)}
							/>
						</li>
					);
				})}
			</ul>
			<button
				type="button"
				class="psu-add psu-add--sm"
				onClick={() =>
					props.onPatch({
						roles: [...stage.roles, {
							id: newRowId("srole"),
							name: "",
							quantity: 1,
							description: "",
							budgetCents: null,
						}],
					})}
			>
				<Icon name="plus" />
				Add role
			</button>
		</Field>
	);
}

/**
 * The per-stage NDA override, as THREE states.
 *
 * `null` inherits the project's own term, which is not the same as "not required": a copied boolean
 * goes stale the moment the project-level term changes, and nothing would then say which of the two
 * the stage actually meant. So the control offers Inherit / Required / Not required, and Inherit is
 * what a stage nobody has thought about carries.
 */
export function ndaOverrideOptions(projectRequiresNda: boolean): Option[] {
	return [
		{
			value: "inherit",
			label: `Follow the project (${projectRequiresNda ? "NDA required" : "no NDA"})`,
		},
		{ value: "required", label: "Require an NDA for this stage" },
		{ value: "none", label: "No NDA for this stage" },
	];
}

/** The stored override as the option value the NDA `Select` binds — `null` reads as Inherit. */
export function ndaOverrideValue(value: boolean | null): string {
	if (value === null) return "inherit";
	return value ? "required" : "none";
}

/** The NDA `Select`'s option value back as the stored override — Inherit writes `null`. */
export function ndaOverrideFrom(value: string): boolean | null {
	if (value === "required") return true;
	if (value === "none") return false;
	return null;
}
// #endregion

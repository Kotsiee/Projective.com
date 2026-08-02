import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { DndContext, DropIndicator, useSortable } from "@projective/ui/dnd";
import { AvatarStack } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { TicketTask } from "../../types/projects-types.ts";
import { taskOps } from "../../core/ticket-model.ts";

/**
 * TaskListEditor — the ticket's steps, at both scopes: the ticket's own list and each stage's.
 * One component, because the two lists have identical semantics and a second implementation is how
 * they drift.
 *
 * Two rules govern it, and both are product rules rather than permissions detail:
 *
 *  1. **The list is structural, so the client owns it.** Steps are part of what the ticket asks for —
 *     writing them, ordering them and rewording them is composing the brief. A provider seat reads
 *     them; it does not edit them, and it is shown no affordance suggesting otherwise.
 *  2. **Nothing is ticked off here.** Completion is a delivery claim, and a claim needs the work
 *     attached to it — so a step is satisfied at the SUBMISSION level, where what satisfies it is
 *     uploaded and reviewable. A checkbox on this surface would let completion be asserted with
 *     nothing behind it, and would have no honest answer for whose face to show beside it.
 *
 * What the row shows instead is the OUTCOME: the step's state, and the faces of everyone whose
 * submission satisfied it. That is the fact a reader actually wants from a checklist they cannot
 * tick — not "is this done" alone, but "who did it".
 *
 * Order is meaningful — a task list is a sequence of work, not a set — so rows drag, and the landing
 * position is drawn by the shared {@link DropIndicator} rather than left to a highlighted neighbour.
 * Both indices come from the context's own drag lifecycle rather than from each row's `isOver`, so
 * nothing is computed during render.
 */
export interface TaskListEditorProps {
	tasks: TicketTask[];
	onChange: (next: TicketTask[]) => void;
	/** Placeholder on the composer row ("Add a step…"). */
	placeholder?: string;
	/** Names the list for assistive tech. */
	label: string;
	/**
	 * Whether the viewer may write the list. Client-side seats only — see rule 1. A viewer without it
	 * gets the static presentation with no grip, no remove and no add row.
	 */
	editable?: boolean;
	/**
	 * Hide the completion channel entirely. For a ticket being created, where no step CAN have been
	 * satisfied — an unbroken column of empty marks would be answering a question nobody asked.
	 */
	hideProgress?: boolean;
}

const idOf = (raw: string): string => raw.replace("task:", "");

/** The step's state and who satisfied it — a read-out on every presentation of this list. */
function TaskProgress(props: { task: TicketTask; hidden?: boolean }): JSX.Element | null {
	const { task } = props;
	if (props.hidden) return null;
	const names = task.completedBy.map((p) => p.name).join(", ");

	return (
		<span class="tkc-task__done" data-done={task.done ? "true" : undefined}>
			<span class="tkc-task__mark" aria-hidden="true">
				{task.done ? <Icon name="check" size="2xs" /> : null}
			</span>
			{task.completedBy.length > 0
				? (
					<Tooltip content={`Completed by ${names}`}>
						<span class="tkc-task__by" tabIndex={0}>
							<AvatarStack
								people={task.completedBy}
								max={3}
								size={18}
								ringColor="var(--surface)"
								aria-label={`Completed by ${names}`}
							/>
						</span>
					</Tooltip>
				)
				: null}
		</span>
	);
}

interface RowProps {
	task: TicketTask;
	hideProgress?: boolean;
	onText: (text: string) => void;
	onRemove: () => void;
}

function TaskRow(props: RowProps): JSX.Element {
	const sortable = useSortable({
		id: `task:${props.task.id}`,
		data: { type: "task", accepts: ["task"] },
		roleDescription: "task",
	});
	return (
		<div
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="tkc-task"
			data-dragging={sortable.isDragging.value || undefined}
		>
			<button
				type="button"
				class="tkc-task__grip"
				aria-label={`Reorder ${props.task.text}`}
				aria-roledescription={sortable.attributes["aria-roledescription"]}
				tabIndex={sortable.attributes.tabIndex}
				onPointerDown={sortable.listeners.onPointerDown}
				onKeyDown={sortable.listeners.onKeyDown}
			>
				<Icon name="grip" size="xs" />
			</button>
			<TaskProgress task={props.task} hidden={props.hideProgress} />
			<input
				class="tkc-task__text"
				value={props.task.text}
				data-done={props.task.done ? "true" : undefined}
				aria-label={`Task: ${props.task.text}`}
				onInput={(e) => props.onText((e.currentTarget as HTMLInputElement).value)}
			/>
			<button
				type="button"
				class="tkc-task__remove"
				aria-label={`Remove ${props.task.text}`}
				onClick={props.onRemove}
			>
				<Icon name="close" size="2xs" />
			</button>
		</div>
	);
}

export function TaskListEditor(props: TaskListEditorProps): JSX.Element {
	const {
		tasks,
		onChange,
		placeholder = "Add a step…",
		label,
		editable = true,
		hideProgress,
	} = props;
	const composerText = useSignal("");
	const dragIndex = useSignal<number | null>(null);
	const overIndex = useSignal<number | null>(null);

	const commitNew = () => {
		const next = taskOps.add(tasks, composerText.value);
		if (next !== tasks) {
			onChange(next);
			composerText.value = "";
		}
	};

	if (!editable) {
		if (tasks.length === 0) return <p class="tkc-tasks__empty">No steps listed.</p>;
		return (
			<ul class="tkc-tasks tkc-tasks--static" aria-label={label}>
				{tasks.map((t) => (
					<li key={t.id} class="tkc-task tkc-task--static" data-done={t.done ? "true" : undefined}>
						<TaskProgress task={t} hidden={hideProgress} />
						<span class="tkc-task__label">{t.text}</span>
					</li>
				))}
			</ul>
		);
	}

	// A seam is drawn on the side of the hovered row the dragged item would land on.
	const from = dragIndex.value;
	const over = overIndex.value;
	const seamBefore = from !== null && over !== null && from > over ? over : null;
	const seamAfter = from !== null && over !== null && from < over ? over : null;

	return (
		<div class="tkc-tasks-wrap">
			<DndContext
				onDragStart={(e) => {
					dragIndex.value = tasks.findIndex((t) => t.id === idOf(String(e.active.id)));
				}}
				onDragOver={(e) => {
					overIndex.value = e.over === null
						? null
						: tasks.findIndex((t) => t.id === idOf(String(e.over)));
				}}
				onDragEnd={(e) => {
					const start = dragIndex.value;
					const target = e.over === null
						? null
						: tasks.findIndex((t) => t.id === idOf(String(e.over)));
					dragIndex.value = null;
					overIndex.value = null;
					if (e.canceled || start === null || target === null || target < 0) return;
					onChange(taskOps.move(tasks, start, target));
				}}
			>
				<ul class="tkc-tasks" aria-label={label}>
					{tasks.map((t, i) => (
						<li key={t.id} class="tkc-task-slot">
							<DropIndicator active={seamBefore === i} />
							<TaskRow
								task={t}
								hideProgress={hideProgress}
								onText={(text) => onChange(taskOps.patch(tasks, t.id, { text }))}
								onRemove={() => onChange(taskOps.remove(tasks, t.id))}
							/>
							<DropIndicator active={seamAfter === i} />
						</li>
					))}
				</ul>
			</DndContext>
			<div class="tkc-tasks__new">
				<Icon name="plus" size="xs" class="tkc-tasks__newmark" />
				<input
					class="tkc-tasks__newinput"
					placeholder={placeholder}
					aria-label={`Add to ${label}`}
					value={composerText.value}
					onInput={(e) => (composerText.value = (e.currentTarget as HTMLInputElement).value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commitNew();
						}
					}}
					onBlur={commitNew}
				/>
			</div>
		</div>
	);
}

import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Tooltip } from "@projective/ui/feedback";
import { SelectButton } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { LaneSection } from "@projective/ui/navigation";
import {
	ALL_TASK_LISTS,
	filterTaskItems,
	type TaskLane,
	type TaskLaneList,
	taskLaneProgress,
	visibleTaskLists,
} from "../../core/task-lane.ts";
import { withTicketParam } from "../../core/ticket-link.ts";

/**
 * TaskListsSection — the Task's work at a glance: the ticket it is delivered through, and that ticket's
 * task lists, with a switcher between the lists and a quick filter down to what is still open.
 *
 * The lists are READ here, never ticked. Completion is a delivery claim, made at the submission level
 * where the work that satisfies a step is attached and reviewable (the ticket model's own rule), so a
 * checkbox in the lane would be a control offering something the lane cannot honestly do. The ticket
 * row opens the ticket itself through the `?tkv=` deep link — the one place those steps are worked.
 *
 * The switcher renders only when there is more than one list to switch between, and the filter only
 * when there is anything to filter: a control with a single option, or a filter over nothing, would be
 * rendered and do nothing (root CLAUDE.md §3 gate 11).
 */
export interface TaskListsSectionProps {
	lane: TaskLane;
	/** The current page — the ticket link writes `?tkv=` onto it, so the modal opens where the reader is. */
	path: string;
	open: boolean;
	onToggle: () => void;
}

export function TaskListsSection(
	{ lane, path, open, onToggle }: TaskListsSectionProps,
): JSX.Element {
	const selected = useSignal<string>(ALL_TASK_LISTS);
	const openOnly = useSignal<boolean>(false);

	const progress = taskLaneProgress(lane.lists);
	const shown = visibleTaskLists(lane.lists, selected.value);
	const switcher = lane.lists.length > 1
		? [
			{ label: "All", value: ALL_TASK_LISTS },
			...lane.lists.map((list) => ({ label: list.label, value: list.key })),
		]
		: null;
	const filterLabel = openOnly.value ? "Show every task" : "Show open tasks only";

	const actions = (
		<span class="task-lane__actions">
			{progress.total > 0 && (
				<Tooltip content={filterLabel} placement="bottom">
					<button
						type="button"
						class="task-lane__action"
						data-on={openOnly.value ? "true" : undefined}
						aria-pressed={openOnly.value}
						aria-label={filterLabel}
						onClick={() => (openOnly.value = !openOnly.value)}
					>
						<Icon name="filter" />
					</button>
				</Tooltip>
			)}
			{lane.boardHref && (
				<Tooltip content="Open task board" placement="bottom">
					<a class="task-lane__action" href={lane.boardHref} aria-label="Open task board">
						<Icon name="board" />
					</a>
				</Tooltip>
			)}
		</span>
	);

	return (
		<LaneSection
			id="task-lists"
			icon={<Icon name="ticket" />}
			label="Tasks"
			open={open}
			onToggle={onToggle}
			action={actions}
		>
			<div class="task-lane__tasks">
				{lane.ticket
					? (
						<TicketRow
							title={lane.ticket.title}
							statusLabel={lane.ticket.statusLabel}
							href={lane.ticket.slug ? withTicketParam(path, lane.ticket.slug) : null}
							done={progress.done}
							total={progress.total}
						/>
					)
					: (
						<p class="task-lane__note">
							No task ticket yet{lane.boardHref ? " — create it on the task board." : "."}
						</p>
					)}

				{switcher && (
					<SelectButton
						size="sm"
						fluid
						options={switcher}
						value={selected.value}
						aria-label="Task list"
						onValueChange={(next) => (selected.value = next as string)}
					/>
				)}

				{shown.map((list) => (
					<TaskListBlock
						key={list.key}
						list={list}
						openOnly={openOnly.value}
						labelled={lane.lists.length > 1}
					/>
				))}

				{lane.ticket && lane.lists.length === 0 && (
					<p class="task-lane__note">This task has no checklist.</p>
				)}
			</div>
		</LaneSection>
	);
}

/** The ticket that IS the Task — a link into it, with its status and overall progress. */
function TicketRow(
	{ title, statusLabel, href, done, total }: {
		title: string;
		statusLabel: string;
		href: string | null;
		done: number;
		total: number;
	},
): JSX.Element {
	const body = (
		<>
			<span class="task-lane__ticket-title">{title}</span>
			<span class="task-lane__ticket-meta">
				{statusLabel}
				{total > 0 && (
					<>
						<span aria-hidden="true">·</span>
						<span class="task-lane__count">{done} of {total} done</span>
					</>
				)}
			</span>
		</>
	);
	if (!href) return <div class="task-lane__ticket">{body}</div>;
	return (
		<a class="task-lane__ticket task-lane__ticket--link" href={href}>
			{body}
		</a>
	);
}

/** One task list — its label (when several are shown), then its steps under the quick filter. */
function TaskListBlock(
	{ list, openOnly, labelled }: { list: TaskLaneList; openOnly: boolean; labelled: boolean },
): JSX.Element {
	const items = filterTaskItems(list.items, openOnly);
	const headId = `task-list-${list.key.replace(/[^a-z0-9-]/gi, "-")}`;
	return (
		<section
			class="task-lane__list"
			aria-labelledby={labelled ? headId : undefined}
			aria-label={labelled ? undefined : list.label}
		>
			{labelled && (
				<p id={headId} class="task-lane__listhead">
					<span>{list.label}</span>
					<span class="task-lane__count">{list.done}/{list.total}</span>
				</p>
			)}
			{items.length === 0
				? <p class="task-lane__note">Every step in this list is done.</p>
				: (
					<ul class="task-lane__items">
						{items.map((item) => (
							<li key={item.id} class="task-lane__item" data-done={item.done ? "true" : undefined}>
								<span class="task-lane__mark" aria-hidden="true">
									{item.done ? <Icon name="check" size="2xs" /> : null}
								</span>
								<span class="task-lane__text">{item.text}</span>
								<span class="ui-visually-hidden">{item.done ? "(done)" : "(open)"}</span>
							</li>
						))}
					</ul>
				)}
		</section>
	);
}

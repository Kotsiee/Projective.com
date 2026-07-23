import type { JSX } from "preact";
import { Checkbox } from "@projective/ui/fields";
import type { ChecklistItem, TaskChecklist } from "../core/submission-tasks.ts";
import { checklistProgress } from "../core/submission-tasks.ts";

/**
 * TaskChecklistView — the interactive stage/ticket task checklist, shared VERBATIM between the right-side
 * Tasks panel (root task §6) and the freelancer's Pre-Submit modal (§5) so ticking a task in one is
 * reflected in the other (both bind the same checklist state owned by the explorer island). Renders two
 * grouped sections (Stage tasks · Ticket tasks) of `@projective/ui` {@link Checkbox}es; the ticket group
 * is omitted when empty (a one-off engagement). Presentational — the owning island holds the state and
 * runs {@link onToggle}.
 */
export interface TaskChecklistViewProps {
	checklist: TaskChecklist;
	onToggle: (id: string) => void;
	/** A compact variant (tighter spacing) for the modal's context sidebar. */
	compact?: boolean;
}

function Group(
	{ title, items, onToggle }: {
		title: string;
		items: ChecklistItem[];
		onToggle: (id: string) => void;
	},
): JSX.Element | null {
	if (items.length === 0) return null;
	return (
		<div class="subm-checklist__group">
			<h4 class="subm-checklist__grouptitle">{title}</h4>
			<ul class="subm-checklist__list">
				{items.map((item) => (
					<li key={item.id} class="subm-checklist__item" data-done={item.done ? "true" : undefined}>
						<Checkbox
							value={item.done}
							onValueChange={() =>
								onToggle(item.id)}
							label={item.label}
						/>
					</li>
				))}
			</ul>
		</div>
	);
}

export function TaskChecklistView(props: TaskChecklistViewProps): JSX.Element {
	const { checklist, onToggle, compact } = props;
	const { total, done } = checklistProgress(checklist);

	return (
		<div class="subm-checklist" data-compact={compact ? "true" : undefined}>
			<div class="subm-checklist__meta" role="status">
				{total === 0
					? "No tasks defined for this stage."
					: `${done} of ${total} ${total === 1 ? "task" : "tasks"} complete`}
			</div>
			<Group title="Stage tasks" items={checklist.stage} onToggle={onToggle} />
			<Group title="Ticket tasks" items={checklist.ticket} onToggle={onToggle} />
		</div>
	);
}

import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { LaneSection } from "@projective/ui/navigation";
import { TaskParty } from "./TaskParty.tsx";
import type { TaskCollaborator } from "../../core/task-lane.ts";

/** How many collaborators the lane lists before handing over to the Members view. */
const SHOWN = 5;

/**
 * TaskMembersSection — the Task's collaborators as a compact list: a face, a name, and the seat they
 * hold, the person working the Task marked "Assigned".
 *
 * Capped at a handful because the lane is a summary; the rest are one link away in the engagement's
 * Members view, and the link says how many there are rather than promising "more" of an unknown size.
 */
export interface TaskMembersSectionProps {
	/** The collaborators, already merged with the Task's assignee (`taskCollaborators`). */
	people: TaskCollaborator[];
	/** `/projects/{slug}/members` — where the full roster lives. */
	membersHref: string;
	open: boolean;
	onToggle: () => void;
}

export function TaskMembersSection(
	{ people, membersHref, open, onToggle }: TaskMembersSectionProps,
): JSX.Element {
	const hidden = people.length - SHOWN;
	return (
		<LaneSection
			id="task-members"
			icon={<Icon name="members" />}
			label="Members"
			open={open}
			onToggle={onToggle}
		>
			{people.length === 0
				? <p class="task-lane__note">Nobody has joined this task yet.</p>
				: (
					<ul class="task-lane__people">
						{people.slice(0, SHOWN).map((person) => (
							<li
								key={`${person.party.handle ?? person.party.name}:${person.role}`}
								class="task-lane__person"
							>
								<TaskParty party={person.party} size={24} />
								<span class="task-lane__role">{person.role}</span>
							</li>
						))}
					</ul>
				)}
			{hidden > 0 && (
				<a class="task-lane__more" href={membersHref}>
					View all {people.length} members
				</a>
			)}
		</LaneSection>
	);
}

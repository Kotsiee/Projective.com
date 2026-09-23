import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { profileHref } from "../../core/routing.ts";
import type { ProjectParty } from "../../types/projects-types.ts";

/**
 * TaskParty — one person as the Task lane names them: a small circular face and their name, linking to
 * their profile at the canonical `/@handle` when they have one (Decision #3). A party with no handle
 * renders as plain text rather than a link to nowhere.
 */
export interface TaskPartyProps {
	party: ProjectParty;
	/** Face diameter in px. */
	size?: number;
}

export function TaskParty({ party, size = 20 }: TaskPartyProps): JSX.Element {
	const face = (
		<Avatar image={party.avatar ?? undefined} label={party.name} size={size} shape="circle" />
	);
	if (!party.handle) {
		return (
			<span class="task-lane__party">
				{face}
				<span class="task-lane__party-name">{party.name}</span>
			</span>
		);
	}
	return (
		<a class="task-lane__party task-lane__party--link" href={profileHref(party.handle)}>
			{face}
			<span class="task-lane__party-name">{party.name}</span>
		</a>
	);
}

import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { ConfirmDialog } from "@projective/ui/feedback";
import type { ProjectMemberRow } from "../types/projects-types.ts";
import { removalNotices, removalTouchesMoney } from "../types/projects-types.ts";
import { roleMeta } from "../core/member-model.ts";

/**
 * RemoveMemberDialog — the confirmation a client sees before an active participant is removed from
 * the project, or unassigned from one stage.
 *
 * The consequences are `removalNotices`' — ONE implementation of `PRODUCT_SPEC.md` §Freelancer Removal
 * Mid-Ticket, read from the row's server-counted `impact` — so the dialog can never phrase the rule a
 * second way, and it says something true in the quiet case too ("no financial consequence" is
 * information, not the absence of a warning). The accept button carries `danger` severity because a
 * removal is irreversible for the seat; the copy carries the money.
 */
export interface RemoveMemberDialogProps {
	visible: Signal<boolean>;
	/** The row being removed, or `null` while the dialog is closed. */
	member: ProjectMemberRow | null;
	/** The stage name when the removal is stage-scoped (unassign), or `null` for the whole project. */
	stageName: string | null;
	onAccept: () => void;
	onReject: () => void;
}

export function RemoveMemberDialog(props: RemoveMemberDialogProps): JSX.Element {
	const { member, stageName } = props;
	const name = member?.party.name ?? "this member";
	const role = member ? roleMeta(member.role).label : "";
	const notices = removalNotices(member?.impact);
	const money = removalTouchesMoney(member?.impact);
	const scopeLine = stageName
		? `Unassign ${name} (${role}) from ${stageName}? They keep any other stage they hold, and lose access to this one.`
		: `Remove ${name}${
			role ? ` (${role})` : ""
		} from this project? They lose access to every channel and stage.`;

	return (
		<ConfirmDialog
			visible={props.visible}
			header={stageName ? "Unassign from stage" : "Remove member"}
			message={
				<div class="mem-remove">
					<p class="mem-remove__lead">{scopeLine}</p>
					<p class="mem-remove__label" data-money={money ? "true" : undefined}>
						{money ? "What happens to their work" : "Before you confirm"}
					</p>
					<ul class="mem-remove__notices">
						{notices.map((line) => <li key={line}>{line}</li>)}
					</ul>
				</div>
			}
			acceptLabel={stageName ? "Unassign" : "Remove"}
			rejectLabel="Keep them"
			acceptSeverity="danger"
			onAccept={props.onAccept}
			onReject={props.onReject}
		/>
	);
}

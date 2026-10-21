import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { Select } from "@projective/ui/fields";
import type { InviteRecipient, ParsedRecipient } from "@projective/types/invites";
import type {
	AssignableMemberRole,
	MemberInvite,
	MemberRole,
	MemberStageRef,
	ProjectMemberRow,
} from "../types/projects-types.ts";
import { OVERSIGHT_ROLES } from "../types/projects-types.ts";
import { ASSIGNABLE_ROLES } from "../core/member-model.ts";
import { handleSet, normaliseHandle } from "@features/share/core/people-picker.ts";
import { absoluteUrl } from "@features/share/core/share-request.ts";
import { UniversalInviteModal } from "@features/invites/components/UniversalInviteModal.tsx";
import { InviteLinkPanel } from "@features/invites/components/InviteLinkPanel.tsx";
import type { InviteSendOutcome } from "@features/invites/core/invite-queue.ts";
import { useStageInviteLink } from "../hooks/useStageInviteLink.ts";

/**
 * InviteShareModal — the Members tab's Invite, on the Universal Invite modal (Decision #318,
 * superseding #145's one-click-per-person layout).
 *
 * One field for `@handles` and emails (the text decides which), a staged list with a role per person,
 * and the stage's ask-to-join link underneath (`useStageInviteLink`, Decision #145 — a link asks, it
 * never seats). On a pipeline the invitation's scope — the whole project or one stage — is chosen
 * under the header, and the link follows it: a link always opens one stage.
 *
 * Persisted through the roster's `onInvite` (`POST /api/projects/[id]/invites`): each recipient is
 * one invitation at its own role, addressed as the field read it. Nobody on the roster is staged, and
 * anybody holding an open invitation to the chosen scope reads "Already invited".
 */
export interface InviteShareModalProps {
	open: Signal<boolean>;
	projectId: string;
	projectTitle: string;
	stages: MemberStageRef[];
	/** Whether the stage picker is offered (a pipeline with stages). */
	showStages: boolean;
	/** The routed stage, pre-selected and the link's stage on a stage page. */
	defaultStageId: string | null;
	viewerRole: MemberRole;
	members: readonly ProjectMemberRow[];
	invites: readonly MemberInvite[];
	onInvite: (recipients: InviteRecipient[], stageId: string | null) => Promise<InviteSendOutcome>;
}

export function InviteShareModal(props: InviteShareModalProps): JSX.Element {
	const { stages } = props;
	const stageId = useSignal<string | null>(props.defaultStageId);

	// A delegate staffs the project; only the owner's side may appoint another admin or manager.
	const delegate = props.viewerRole === "admin" || props.viewerRole === "manager";
	const roles = ASSIGNABLE_ROLES
		.filter((r) => !(delegate && OVERSIGHT_ROLES.has(r.value)))
		.map((r) => ({ id: r.value, name: r.label }));
	const pickStage = props.showStages && stages.length > 0;

	// The link opens one stage: the chosen one, or the engagement's only stage.
	const linkStage = stageId.value
		? stages.find((stage) => stage.id === stageId.value) ?? null
		: stages.length === 1
		? stages[0]
		: null;
	const link = useStageInviteLink(props.projectId, linkStage?.id ?? null, props.open.value);

	const memberHandles = handleSet(props.members.map((m) => m.party));
	const scopeName = stageId.value
		? stages.find((s) => s.id === stageId.value)?.name ?? props.projectTitle
		: props.projectTitle;

	function refuse(r: ParsedRecipient): string | null {
		if (r.type === "handle" && memberHandles.has(r.value)) return "Already on this project";
		const stage = stageId.peek();
		const invited = props.invites.some((invite) =>
			invite.status === "pending" && !invite.dismissedAt && invite.stageId === stage &&
			(r.type === "handle"
				? normaliseHandle(invite.handle) === r.value
				: invite.email.toLowerCase() === r.value)
		);
		return invited ? "Already invited" : null;
	}

	const current = link.link.value;

	return (
		<UniversalInviteModal
			open={props.open}
			targetType="project"
			targetId={props.projectId}
			targetName={scopeName}
			availableRoles={roles}
			defaultRoleId={"freelancer" satisfies AssignableMemberRole}
			onClose={() => {}}
			onSend={(recipients) => props.onInvite(recipients, stageId.peek())}
			refuse={refuse}
			suggest
			excludeHandles={memberHandles}
			scope={pickStage && (
				<>
					<span id="inv-scope-label">Invite to</span>
					<Select
						size="sm"
						options={[
							{ label: "Whole project", value: "" },
							...stages.map((s) => ({ label: s.name, value: s.id })),
						]}
						value={stageId.value ?? ""}
						onValueChange={(next) => (stageId.value = next || null)}
						panelWidth="auto"
						aria-labelledby="inv-scope-label"
						aria-label="Stage they are seated on"
					/>
				</>
			)}
			link={linkStage
				? (
					<InviteLinkPanel
						url={current ? absoluteUrl(current.path) : null}
						targetName={linkStage.name}
						hint="You accept or decline each request in Members › Requests."
						shareTitle={`Join ${linkStage.name} on ${props.projectTitle}`}
						shareText="You're invited to ask to join this stage on Projective."
						busy={link.busy.value}
						error={link.error.value}
						notice={link.notice.value}
						onCreate={() => void link.act("ensure")}
						onReset={() => void link.act("reset")}
						onRevoke={() => void link.act("revoke")}
					/>
				)
				: pickStage && (
					<p class="inv-link__hint">
						Choose a stage to share its invite link — a link always opens one stage.
					</p>
				)}
		/>
	);
}

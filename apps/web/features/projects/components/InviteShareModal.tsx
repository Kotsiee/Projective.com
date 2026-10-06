import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Button, Select } from "@projective/ui/fields";
import { Dialog } from "@projective/ui/feedback";
import type {
	AssignableMemberRole,
	MemberInvite,
	MemberRole,
	MemberStageRef,
	ProjectMemberRow,
} from "../types/projects-types.ts";
import { OVERSIGHT_ROLES } from "../types/projects-types.ts";
import { ASSIGNABLE_ROLES } from "../core/member-model.ts";
import { useContactSearch } from "@features/messaging/hooks/useContactSearch.ts";
import { handleSet, normaliseHandle, withoutHandles } from "@features/share/core/people-picker.ts";
import { QuickAddRail } from "@features/share/components/QuickAddRail.tsx";
import { UserSearchPopover } from "@features/share/components/UserSearchPopover.tsx";
import { useStageInviteLink } from "../hooks/useStageInviteLink.ts";
import { useInviteActions } from "../hooks/useInviteActions.ts";
import { InviteLinkSection } from "./InviteLinkSection.tsx";

/**
 * InviteShareModal — the Members tab's Invite surface (Decision #145), in the share modal's layout:
 * who the invitation makes them (role · stage), the stage's invite link, a search whose matches open
 * in a popover, and a Quick Add rail of the viewer's ranked contacts. Every person is invited with one
 * click and keeps their own outcome; nobody on the roster is suggested, and anybody holding an open
 * invitation to the chosen stage reads "Invited".
 *
 * Persisted through the roster's `onInvite` (`POST /api/projects/[id]/invites`) one address at a time:
 * an `@handle` is an identity-addressed invitation answered in-app, an email stays email-addressed.
 * The link is `useStageInviteLink` (`/api/projects/[id]/stages/[stageId]/invite-link`).
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
	onInvite: (
		addresses: string[],
		role: AssignableMemberRole,
		stageId: string | null,
	) => Promise<string | null>;
}

export function InviteShareModal(props: InviteShareModalProps): JSX.Element {
	// The body mounts on the first open (the suggestions load on demand) and then stays, so the close
	// transition keeps its content and a reopen keeps what was already loaded.
	const opened = useRef(false);
	if (props.open.value) opened.current = true;
	const scope = props.defaultStageId
		? props.stages.find((stage) => stage.id === props.defaultStageId)?.name
		: null;
	return (
		<Dialog
			visible={props.open}
			header={scope ? `Invite to ${scope}` : "Invite people"}
			width="40rem"
			class="mem-dialog invite-share-dialog"
			footer={
				<div class="mem-dialog__foot">
					<Button variant="filled" label="Done" onClick={() => (props.open.value = false)} />
				</div>
			}
		>
			{opened.current && <InviteShareBody {...props} active={props.open.value} />}
		</Dialog>
	);
}

/** The modal's content; `active` re-reads the stage link each time the modal opens. */
function InviteShareBody(props: InviteShareModalProps & { active: boolean }): JSX.Element {
	const { stages } = props;
	const role = useSignal<AssignableMemberRole>("freelancer");
	const stageId = useSignal<string | null>(props.defaultStageId);

	// A delegate staffs the project; only the owner's side may appoint another admin or manager.
	const delegate = props.viewerRole === "admin" || props.viewerRole === "manager";
	const roles = ASSIGNABLE_ROLES.filter((r) => !(delegate && OVERSIGHT_ROLES.has(r.value)));
	const pickStage = props.showStages && stages.length > 0;

	// The link opens one stage: the chosen one, or the engagement's only stage.
	const linkStage = stageId.value
		? stages.find((stage) => stage.id === stageId.value) ?? null
		: stages.length === 1
		? stages[0]
		: null;
	const link = useStageInviteLink(props.projectId, linkStage?.id ?? null, props.active);

	const memberHandles = handleSet(props.members.map((m) => m.party));
	const suggestions = useContactSearch({ limit: 20 });
	const rail = withoutHandles(suggestions.contacts.value, memberHandles);
	const actions = useInviteActions({
		invites: props.invites,
		role,
		stageId,
		onInvite: props.onInvite,
	});

	return (
		<div class="invite-share">
			<div class="invite-share__target" data-single={pickStage ? undefined : "true"}>
				<label class="mem-field">
					<span class="mem-field__label">Invite as</span>
					<Select
						fluid
						options={roles.map((r) => ({ label: r.label, value: r.value }))}
						value={role.value}
						onValueChange={(next) => (role.value = next as AssignableMemberRole)}
						aria-label="Role they join as"
					/>
				</label>
				{pickStage && (
					<label class="mem-field">
						<span class="mem-field__label">To</span>
						<Select
							fluid
							options={[
								{ label: "Whole project (no stage)", value: "" },
								...stages.map((s) => ({ label: s.name, value: s.id })),
							]}
							value={stageId.value ?? ""}
							onValueChange={(next) => (stageId.value = next || null)}
							aria-label="Stage they are seated on"
						/>
					</label>
				)}
			</div>

			{linkStage
				? (
					<InviteLinkSection
						state={link}
						stageName={linkStage.name}
						projectTitle={props.projectTitle}
					/>
				)
				: pickStage && (
					<p class="invite-share__hint">
						Choose a stage to share its invite link — a link always opens one stage.
					</p>
				)}

			<section class="invite-share__section" aria-labelledby="invite-share-search">
				<h3 class="invite-share__heading" id="invite-share-search">Add people</h3>
				<UserSearchPopover
					label="Search people to invite"
					placeholder="Search by name or @handle, or enter an email"
					actionLabel="Invite"
					doneLabel="Invited"
					busyLabel="Inviting…"
					hidden={(person) => {
						const handle = normaliseHandle(person.handle);
						return handle === null || memberHandles.has(handle);
					}}
					stateOf={actions.stateOfPerson}
					onAct={(person) => void actions.invitePerson(person)}
					emailAction={{
						label: (email) => `Invite ${email} by email`,
						stateOf: actions.stateOfEmail,
						onAct: (email) => void actions.inviteEmail(email),
					}}
				/>
			</section>

			<QuickAddRail
				heading="Quick add"
				people={rail}
				loading={suggestions.loading.value}
				error={suggestions.error.value}
				onRetry={suggestions.retry}
				actionLabel="Invite"
				doneLabel="Invited"
				stateOf={actions.stateOfPerson}
				onAct={(person) => void actions.invitePerson(person)}
				emptyNote="Everyone you work with is already here. Search above to find someone new."
			/>

			{actions.error.value && <p class="mem-dialog__error" role="alert">{actions.error.value}</p>}
		</div>
	);
}

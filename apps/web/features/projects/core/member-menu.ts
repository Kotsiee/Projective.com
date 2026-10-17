import type { MenuItem } from "@ui/types/mod.ts";
import {
	type MemberStagePicture,
	type MemberStageRef,
	type MemberViewerCaps,
	type ProjectMemberRow,
	TICKET_MANAGER_ROLES,
} from "../types/projects-types.ts";
import { profileHref } from "./routing.ts";

/** What the member kebab's model is built from. */
export interface MemberMenuInput {
	member: ProjectMemberRow;
	/** Channel scope on a STAGE channel — the stage actions name the routed stage directly. */
	stageChannel: boolean;
	/** The member's stages, scoped like the roster; `null` when stage seats do not apply to them. */
	picture: MemberStagePicture | null;
	caps: MemberViewerCaps;
	/** The row may be managed (a managing viewer, not their own row). */
	manageable: boolean;
	/**
	 * The engagement is billed to a business, so its admin/manager seats can be let manage tickets
	 * (Decision #294). Absent reads as `false`.
	 */
	businessClient?: boolean;
	onEdit: (member: ProjectMemberRow) => void;
	/** Let this admin/manager seat manage tickets for the business client, or stop them. */
	onTicketManager?: (member: ProjectMemberRow, allowed: boolean) => void;
	onInviteToStages: (member: ProjectMemberRow, stageIds: string[]) => void;
	onRemove: (member: ProjectMemberRow, stage: MemberStageRef | null) => void;
}

function inviteItems(input: MemberMenuInput, picture: MemberStagePicture): MenuItem[] {
	const { member, stageChannel } = input;
	const invite = (stage: MemberStageRef): MenuItem => ({
		key: `invite-${stage.id}`,
		label: stageChannel ? `Invite to ${stage.name}` : stage.name,
		icon: stageChannel ? "user-plus" : undefined,
		command: () => input.onInviteToStages(member, [stage.id]),
	});
	if (stageChannel) {
		if (picture.available.length > 0) return [invite(picture.available[0])];
		const waiting = picture.pending[0];
		if (!waiting) return [];
		return [{
			key: "invite-pending",
			label: `Invited to ${waiting.stage.name}`,
			icon: "user-plus",
			hint: "Waiting for their answer",
			disabled: true,
			disabledReason: "They have not answered this invitation yet.",
		}];
	}
	return [{
		key: "invite-to-stage",
		label: "Invite to stage",
		icon: "user-plus",
		items: picture.available.map(invite),
		emptyLabel: picture.pending.length > 0
			? "Every other stage has an open invitation"
			: "Already on every stage",
	}];
}

function removeStageItems(input: MemberMenuInput, picture: MemberStagePicture): MenuItem[] {
	const { member, stageChannel } = input;
	if (picture.held.length === 0) return [];
	const remove = (stage: MemberStageRef): MenuItem => ({
		key: `remove-${stage.id}`,
		label: stageChannel ? `Remove from ${stage.name}` : stage.name,
		icon: stageChannel ? "user-minus" : undefined,
		danger: true,
		command: () => input.onRemove(member, stage),
	});
	if (stageChannel) return [remove(picture.held[0])];
	return [{
		key: "remove-from-stage",
		label: "Remove from stage",
		icon: "user-minus",
		danger: true,
		items: picture.held.map(remove),
	}];
}

/**
 * The member kebab's menu model. In project scope the two stage actions cascade into a stage list
 * ("Invite to stage ›" · "Remove from stage ›"); on a stage channel they name that one stage. Only
 * actions the viewer may take are listed; "Open full profile" needs no permission.
 */
export function memberMenuModel(input: MemberMenuInput): MenuItem[] {
	const { member, caps, manageable, picture } = input;
	const handle = member.party.handle?.replace(/^@+/, "") ?? null;
	const model: MenuItem[] = [];
	if (handle) {
		model.push({
			key: "profile",
			label: "Open full profile",
			icon: "external-link",
			url: profileHref(handle),
			target: "_blank",
		});
	}
	if (manageable && caps.canEditRoles) {
		model.push({
			key: "role",
			label: "Change role",
			icon: "shield",
			command: () => input.onEdit(member),
		});
	}
	// Only a business client delegates its tickets, and only to an admin/manager seat (Decision #294).
	const onTicketManager = input.onTicketManager;
	if (
		manageable && caps.canEditRoles && input.businessClient === true && onTicketManager &&
		TICKET_MANAGER_ROLES.has(member.role)
	) {
		const granted = member.canManageTickets === true;
		model.push({
			key: "tickets",
			label: granted ? "Stop managing tickets" : "Let manage tickets",
			icon: "ticket",
			hint: granted ? undefined : "Write and edit tickets for you",
			command: () => onTicketManager(member, !granted),
		});
	}
	if (manageable && picture) {
		if (caps.canInvite) model.push(...inviteItems(input, picture));
		if (caps.canRemove) model.push(...removeStageItems(input, picture));
	}
	if (manageable && caps.canRemove) {
		model.push(
			{ key: "sep-remove", separator: true },
			{
				key: "remove",
				label: "Remove from project",
				icon: "trash",
				danger: true,
				command: () => input.onRemove(member, null),
			},
		);
	}
	return model;
}

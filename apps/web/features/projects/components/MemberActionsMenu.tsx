import type { JSX, RefObject, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { Popover } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { MemberViewerCaps, ProjectMemberRow } from "../types/projects-types.ts";
import { profileHref } from "../core/routing.ts";
import { ShieldIcon, UserMinusIcon, UserPlusIcon } from "./member-glyphs.tsx";

/**
 * MemberActionsMenu — the kebab on a roster card or row: the secondary actions on one participant. A
 * native-button trigger (a `Popover` anchors on a real element) opens a compact menu: open the full
 * profile in a new tab, change role (and stages, on a pipeline), the stage-channel quick Assign /
 * Unassign toggle, and Remove. Each item is a real control with an icon and a label; the menu closes
 * after a pick. The island renders it only for rows the viewer may act on, so every item shown is
 * permitted — but "Open full profile" needs no permission, so a non-managing viewer still gets it.
 */
export interface MemberActionsMenuProps {
	member: ProjectMemberRow;
	/** Channel scope on a STAGE channel — enables the quick Assign/Unassign toggle. */
	stageChannel: boolean;
	/** The routed stage name (for the quick-toggle label), or null. */
	stageName: string | null;
	/** Whether stages are a dimension on this engagement — decides the edit item's wording. */
	showStages: boolean;
	caps: MemberViewerCaps;
	/** The row may be managed (a managing viewer, not their own row). */
	manageable: boolean;
	onEdit: (member: ProjectMemberRow) => void;
	onQuickAssign: (member: ProjectMemberRow, assign: boolean) => void;
	onRemove: (member: ProjectMemberRow) => void;
}

interface ItemProps {
	icon: VNode;
	label: string;
	danger?: boolean;
	onClick: () => void;
}

function Item(props: ItemProps): JSX.Element {
	return (
		<button
			type="button"
			role="menuitem"
			class="mem-menu__item"
			data-danger={props.danger ? "true" : undefined}
			onClick={props.onClick}
		>
			<span class="mem-menu__icon" aria-hidden="true">{props.icon}</span>
			<span class="mem-menu__label">{props.label}</span>
		</button>
	);
}

export function MemberActionsMenu(props: MemberActionsMenuProps): JSX.Element | null {
	const { member, stageChannel, stageName, caps, manageable } = props;
	const open = useSignal(false);
	const handle = member.party.handle;
	const assigned = member.assignment === "contributor";
	const canEdit = manageable && (caps.canEditRoles || caps.canAssign);
	const quickAssignable = manageable && stageChannel && caps.canAssign &&
		(member.role === "freelancer" || member.role === "member");
	const canRemove = manageable && caps.canRemove;
	if (!handle && !canEdit && !quickAssignable && !canRemove) return null;

	const pick = (fn: () => void) => () => {
		open.value = false;
		fn();
	};

	return (
		<Popover
			open={open}
			placement="bottom-end"
			class="mem-menu-pop"
			trigger={(api) => (
				<button
					type="button"
					ref={api.ref as RefObject<HTMLButtonElement>}
					class="mem-iconbtn"
					aria-haspopup="menu"
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					aria-label={`More actions for ${member.party.name}`}
					onClick={api.toggle}
				>
					<Icon name="kebab" size="sm" />
				</button>
			)}
		>
			<div class="mem-menu" role="menu" aria-label={`Actions for ${member.party.name}`}>
				{handle && (
					<a
						role="menuitem"
						class="mem-menu__item"
						href={profileHref(handle)}
						target="_blank"
						rel="noopener"
						onClick={() => (open.value = false)}
					>
						<span class="mem-menu__icon" aria-hidden="true">
							<Icon name="external-link" size="sm" />
						</span>
						<span class="mem-menu__label">Open full profile</span>
					</a>
				)}
				{canEdit && (
					<Item
						icon={<ShieldIcon />}
						label={props.showStages ? "Change role & stages" : "Change role"}
						onClick={pick(() => props.onEdit(member))}
					/>
				)}
				{quickAssignable && (
					<Item
						icon={assigned ? <UserMinusIcon /> : <UserPlusIcon />}
						label={assigned
							? `Unassign from ${stageName ?? "stage"}`
							: `Assign to ${stageName ?? "stage"}`}
						onClick={pick(() => props.onQuickAssign(member, !assigned))}
					/>
				)}
				{canRemove && (
					<Item
						icon={<Icon name="trash" size="sm" />}
						label="Remove from project"
						danger
						onClick={pick(() => props.onRemove(member))}
					/>
				)}
			</div>
		</Popover>
	);
}

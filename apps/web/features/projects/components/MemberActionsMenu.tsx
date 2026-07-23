import type { JSX, RefObject, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { Popover } from "@projective/ui/feedback";
import type { MemberViewerCaps, ProjectMemberRow } from "../types/projects-types.ts";
import { KebabIcon, TrashIcon } from "./glyphs.tsx";
import { ShieldIcon, UserMinusIcon, UserPlusIcon } from "./member-glyphs.tsx";

/**
 * MemberActionsMenu — the per-row management menu for admins / owners / managers (task §2). A kebab
 * trigger opens a compact Popover whose items render directly in `ui-popover__content` (matching the
 * feed card / profile-lane menu idiom): Edit member (role + stage assignments), a channel-stage quick
 * Assign/Unassign toggle, and Remove from project. Each item is a real button with an icon + label; the
 * menu closes after a pick. Rendered only for a manageable, non-self row (the island gates on
 * {@link MemberViewerCaps} + `isViewer`), so every item here is already permitted.
 */
export interface MemberActionsMenuProps {
	member: ProjectMemberRow;
	/** Channel scope on a STAGE channel — enables the quick Assign/Unassign toggle. */
	stageChannel: boolean;
	/** The routed stage name (for the quick-toggle label), or null. */
	stageName: string | null;
	caps: MemberViewerCaps;
	onEdit: (member: ProjectMemberRow) => void;
	onQuickAssign: (member: ProjectMemberRow, assign: boolean) => void;
	onRemove: (member: ProjectMemberRow) => void;
}

/** One menu row. */
function Item(
	props: { icon: VNode; label: string; onClick: () => void; danger?: boolean },
): JSX.Element {
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

export function MemberActionsMenu(props: MemberActionsMenuProps): JSX.Element {
	const { member, stageChannel, stageName, caps } = props;
	const open = useSignal(false);
	const assigned = member.assignment === "contributor";
	// The quick toggle is meaningful for a hired contributor / team seat on a stage channel.
	const quickAssignable = stageChannel && caps.canAssign &&
		(member.role === "freelancer" || member.role === "member");

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
					class="mem-iconbtn mem-row__kebab"
					aria-haspopup="menu"
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					aria-label={`Manage ${member.party.name}`}
					onClick={api.toggle}
				>
					{KebabIcon}
				</button>
			)}
		>
			<div class="mem-menu" role="menu" aria-label={`Actions for ${member.party.name}`}>
				{(caps.canEditRoles || caps.canAssign) && (
					<Item
						icon={ShieldIcon}
						label="Edit member"
						onClick={pick(() => props.onEdit(member))}
					/>
				)}
				{quickAssignable && (
					<Item
						icon={assigned ? UserMinusIcon : UserPlusIcon}
						label={assigned
							? `Unassign from ${stageName ?? "stage"}`
							: `Assign to ${stageName ?? "stage"}`}
						onClick={pick(() => props.onQuickAssign(member, !assigned))}
					/>
				)}
				{caps.canRemove && (
					<Item
						icon={TrashIcon}
						label="Remove from project"
						danger
						onClick={pick(() => props.onRemove(member))}
					/>
				)}
			</div>
		</Popover>
	);
}

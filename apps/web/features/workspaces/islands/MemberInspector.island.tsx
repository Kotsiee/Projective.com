import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Drawer } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { useMediaQuery } from "@projective/ui/navigation";
import {
	permissionFacets,
	type WorkspaceDetail,
	type WorkspaceMember,
} from "@projective/types/workspace";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextPanelInflow,
	selectionPanelOpen,
} from "@web/features/shell/core/context-panel-state.ts";
import { liveDetail, publishDetail } from "../core/workspace-state.ts";
import { actionInputFor, memberAbilities, membersTierProps } from "../core/members-model.ts";
import { inspectedMember, MEMBER_SHEET_CLASS } from "../core/member-inspector-model.ts";
import {
	adoptAddressedMember,
	clearSelectedMember,
	memberEditing,
	memberSheetOpen,
	representSelection,
	requestMemberAct,
	selectedMember,
	selectMember,
} from "../core/member-inspector-state.ts";
import { MemberDetailPanel } from "../components/MemberDetailPanel.tsx";
import { MemberEditForm } from "../components/MemberEditForm.tsx";

/** Props for {@link MemberInspector}. */
export interface MemberInspectorProps {
	/** The entity, as the server read it for this request. */
	workspace: WorkspaceDetail;
	/** The handle `?member=` named, or `null`. */
	member?: string | null;
}

/**
 * MemberInspector — one member of a team or business, inspected beside the Members body
 * (Decision #322). The middle-nav PANEL body on the Members module: from 1280px it docks in the frame
 * with no scrim, the canvas giving it its width; below that the same body slides over in a right-hand
 * `Drawer` with its backdrop. A pick in the table, the cards or the org chart opens it
 * (`selectedMember`); Close, Escape, the drawer's dismissal and dragging the docked panel shut all
 * clear that one selection and hand focus back to what opened it.
 *
 * It shows the dossier ({@link MemberDetailPanel}) and, for a viewer the rank rule lets edit, the
 * edit form in its place ({@link MemberEditForm}). A save republishes the server's detail, which the
 * body adopts; a terminal act is handed to the body, which owns its confirmation.
 */
export default function MemberInspector(props: MemberInspectorProps): JSX.Element {
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const mounted = useSignal(false);
	const ws = liveDetail.value?.id === props.workspace.id ? liveDetail.value : props.workspace;
	const handle = mounted.value ? selectedMember.value : props.member ?? null;
	const member = inspectedMember(ws.members, handle);
	const docked = !mounted.value || inflow;
	const shown = useRef<WorkspaceMember | null>(member);
	if (member) shown.current = member;

	useEffect(() => {
		if (props.member && inspectedMember(props.workspace.members, props.member)) {
			adoptAddressedMember(props.member);
		} else if (props.member) {
			clearSelectedMember(false);
		}
		mounted.value = true;
	}, []);

	useEffect(() => {
		if (mounted.peek()) representSelection(contextPanelInflow());
	}, [inflow]);

	useEffect(() => {
		if (mounted.peek() && selectedMember.peek() !== null && !member) clearSelectedMember();
	}, [member?.id ?? null, ws]);

	const wasDocked = useRef(false);
	useSignalEffect(() => {
		const open = selectionPanelOpen.value;
		const before = wasDocked.current;
		wasDocked.current = open;
		if (before && !open && selectedMember.peek() !== null && contextPanelInflow()) {
			clearSelectedMember();
		}
	});

	const actor = ws.members.find((m) => m.id === ws.viewerMemberId) ??
		ws.members.find((m) => m.isSelf) ?? null;

	function body(target: WorkspaceMember | null, idBase: string, sheet: boolean): JSX.Element | null {
		if (!target) return null;
		return (
			<InspectorBody
				key={target.id}
				workspace={ws}
				member={target}
				actor={actor}
				idBase={idBase}
				sheet={sheet}
			/>
		);
	}

	return (
		<>
			<aside
				class="wsp-inspector"
				aria-label={member ? `Member: ${member.name}` : "Member"}
				onKeyDown={(event) => {
					if (event.key === "Escape" && member && !event.defaultPrevented) {
						event.preventDefault();
						clearSelectedMember();
					}
				}}
			>
				{docked && member && (
					<>
						<div class="wsp-inspector__bar">
							<span class="wsp-inspector__bar-title">
								{memberEditing.value ? "Edit member" : "Member"}
							</span>
							<Button
								{...membersTierProps(5)}
								size="sm"
								iconOnly
								icon={<Icon name="close" />}
								label="Close member details"
								aria-label="Close member details"
								onClick={() => clearSelectedMember()}
							/>
						</div>
						{body(member, "wsp-insp-docked", false)}
					</>
				)}
			</aside>
			{!docked && shown.current && (
				<Drawer
					visible={memberSheetOpen}
					position="right"
					header={memberEditing.value ? "Edit member" : shown.current.name}
					class={MEMBER_SHEET_CLASS}
					onVisibleChange={(open) => {
						if (!open && selectedMember.peek() !== null) clearSelectedMember();
					}}
				>
					{body(member ?? shown.current, "wsp-insp-sheet", true)}
				</Drawer>
			)}
		</>
	);
}

// #region Body
interface InspectorBodyProps {
	workspace: WorkspaceDetail;
	member: WorkspaceMember;
	actor: WorkspaceMember | null;
	idBase: string;
	sheet: boolean;
}

function InspectorBody(props: InspectorBodyProps): JSX.Element {
	const { workspace: ws, member, actor, idBase, sheet } = props;
	const abilities = memberAbilities(actionInputFor(actor, member, ws.viewerCapabilities));
	const facets = useMemo(
		() => permissionFacets(member, ws.kind, ws.roles, member.roleId),
		[member, ws],
	);

	if (memberEditing.value && abilities.edit) {
		return (
			<MemberEditForm
				workspace={ws}
				member={member}
				viewerIsOwner={actor?.rolePreset === "owner"}
				idBase={idBase}
				onSaved={(next) => {
					publishDetail(next);
					memberEditing.value = false;
				}}
				onCancel={() => (memberEditing.value = false)}
			/>
		);
	}

	return (
		<MemberDetailPanel
			workspace={ws}
			member={member}
			abilities={abilities}
			facets={facets}
			idBase={idBase}
			onMessage={() => globalThis.location.assign(`/messages/dm-${member.handle}`)}
			onEdit={() => (memberEditing.value = true)}
			onSelect={(next) => selectMember(next)}
			onAct={(act) => {
				if (sheet) clearSelectedMember(false);
				requestMemberAct(act, member.id, sheet);
			}}
		/>
	);
}
// #endregion

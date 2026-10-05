import type { JSX, VNode } from "preact";
import type { Signal } from "@preact/signals";
import { styleVars } from "@ui/core/style.ts";
import type { MemberInvite, MemberRequest, ProjectMemberRow } from "../types/projects-types.ts";
import type { MemberContext, MemberSection } from "../core/member-sections.ts";
import { gridColWidth, listRowHeight, viewMode, zoom } from "../core/member-view-state.ts";
import { InviteCard, RequestCard, RosterCard } from "./MemberSectionCards.tsx";
import { InvitesTable, MembersTable, RequestsTable } from "./MemberTable.tsx";

/**
 * MemberWorkspace — the zoom-reactive body of the Members tab: the active section's cards (above the
 * zoom's centre marker) or its table (below it), or that section's empty state. It reads
 * {@link viewMode}/{@link zoom} HERE rather than at the island root, so a `Ctrl`+wheel or slider tick
 * re-renders only the workspace — the bars, the dialogs and the preview stay untouched (the File
 * Explorer's `WorkspaceView` contract).
 */
export interface MemberWorkspaceProps {
	section: MemberSection;
	context: MemberContext;
	showWorkload: boolean;
	members: ProjectMemberRow[];
	requests: MemberRequest[];
	invites: MemberInvite[];
	/** Any search or filter is narrowing the active section. */
	filtered: boolean;
	/** The roster is one stage's — the empty copy names the stage. */
	stageScoped: boolean;
	busy: ReadonlySet<string>;
	sortKey: Signal<string>;
	sortDir: Signal<"asc" | "desc">;
	onSort: (key: string) => void;
	memberActions: (member: ProjectMemberRow) => VNode | null;
	requestActions: (request: MemberRequest) => VNode | null;
	inviteActions: (invite: MemberInvite) => VNode | null;
	removable: (invite: MemberInvite) => boolean;
	onOpenMember: (member: ProjectMemberRow) => void;
	onOpenRequest: (request: MemberRequest) => void;
	onOpenInvite: (invite: MemberInvite) => void;
	onAccept: (request: MemberRequest) => void;
	onReject: (request: MemberRequest) => void;
	onRevoke: (invite: MemberInvite) => void;
	onDismiss: (invite: MemberInvite) => void;
	onRemoveInvitee: (invite: MemberInvite) => void;
}

/** The section's empty-state copy, distinguishing "nothing matches" from "nothing yet". */
function emptyCopy(p: MemberWorkspaceProps): { title: string; note: string } {
	const where = p.stageScoped ? "this stage" : "this project";
	if (p.filtered) {
		return { title: "Nothing matches", note: "Try clearing the search or filters." };
	}
	switch (p.section) {
		case "requests":
			return {
				title: "No open requests",
				note:
					`When someone applies to ${where}, their request waits here for you to accept or decline.`,
			};
		case "invitations":
			return {
				title: "No invitations yet",
				note: `People you invite to ${where} appear here with where each invitation stands.`,
			};
		default:
			return { title: "No members yet", note: "Nobody has access to this space yet." };
	}
}

function Empty(p: MemberWorkspaceProps): JSX.Element {
	const copy = emptyCopy(p);
	return (
		<div class="fx-empty" role="status">
			<p class="fx-empty__title">{copy.title}</p>
			<p class="fx-empty__note">{copy.note}</p>
		</div>
	);
}

export function MemberWorkspace(p: MemberWorkspaceProps): JSX.Element {
	const grid = viewMode.value === "grid";
	const sort = { sortKey: p.sortKey, sortDir: p.sortDir, onSort: p.onSort };
	const rowHeight = listRowHeight(zoom.value);
	const gridStyle = styleVars({ "--mem-col": `${gridColWidth(zoom.value)}px` });

	if (p.section === "requests") {
		if (p.requests.length === 0) return <Empty {...p} />;
		return grid
			? (
				<div class="mem-grid" style={gridStyle}>
					{p.requests.map((r) => (
						<RequestCard
							key={r.id}
							request={r}
							busy={p.busy.has(r.id)}
							actions={p.requestActions(r)}
							onAccept={p.onAccept}
							onReject={p.onReject}
							onOpen={p.onOpenRequest}
						/>
					))}
				</div>
			)
			: (
				<RequestsTable
					{...sort}
					rowHeight={rowHeight}
					requests={p.requests}
					busy={p.busy}
					renderActions={p.requestActions}
					onAccept={p.onAccept}
					onReject={p.onReject}
					onOpen={p.onOpenRequest}
				/>
			);
	}

	if (p.section === "invitations") {
		if (p.invites.length === 0) return <Empty {...p} />;
		return grid
			? (
				<div class="mem-grid" style={gridStyle}>
					{p.invites.map((invite) => (
						<InviteCard
							key={invite.id}
							invite={invite}
							showStages={p.context.showStages}
							busy={p.busy.has(invite.id)}
							removable={p.removable(invite)}
							actions={p.inviteActions(invite)}
							onRevoke={p.onRevoke}
							onDismiss={p.onDismiss}
							onRemove={p.onRemoveInvitee}
							onOpen={p.onOpenInvite}
						/>
					))}
				</div>
			)
			: (
				<InvitesTable
					{...sort}
					rowHeight={rowHeight}
					invites={p.invites}
					showStages={p.context.showStages}
					busy={p.busy}
					removable={p.removable}
					renderActions={p.inviteActions}
					onRevoke={p.onRevoke}
					onDismiss={p.onDismiss}
					onRemove={p.onRemoveInvitee}
					onOpen={p.onOpenInvite}
				/>
			);
	}

	if (p.members.length === 0) return <Empty {...p} />;
	return grid
		? (
			<div class="mem-grid" style={gridStyle}>
				{p.members.map((m) => (
					<RosterCard
						key={m.id}
						member={m}
						context={p.context}
						showWorkload={p.showWorkload}
						actions={p.memberActions(m)}
						onOpen={p.onOpenMember}
					/>
				))}
			</div>
		)
		: (
			<MembersTable
				{...sort}
				rowHeight={rowHeight}
				members={p.members}
				context={p.context}
				showWorkload={p.showWorkload}
				renderActions={p.memberActions}
				onOpen={p.onOpenMember}
			/>
		);
}

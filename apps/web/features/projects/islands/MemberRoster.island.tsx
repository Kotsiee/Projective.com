import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/members.css";
import { Button, InputText, MultiSelect, Select } from "@projective/ui/fields";
import { ConfirmDialog, Tooltip } from "@projective/ui/feedback";
import type {
	MemberInvite,
	MemberRole,
	MemberRosterPage,
	MemberRosterParams,
	MemberScope,
	ProjectMemberRow,
} from "../types/projects-types.ts";
import { MembersService } from "../core/MembersService.ts";
import {
	activeFilterCount,
	filterMembers,
	type MemberSortKey,
	ROLE_FILTER_OPTIONS,
	roleMeta,
	sortMembers,
} from "../core/member-model.ts";
import { MemberTable } from "../components/MemberTable.tsx";
import { MemberCard } from "../components/MemberCard.tsx";
import { MemberActionsMenu } from "../components/MemberActionsMenu.tsx";
import { MemberEditDialog } from "../components/MemberEditDialog.tsx";
import { MemberInviteModal } from "../components/MemberInviteModal.tsx";
import { MembersIcon } from "../components/detail-glyphs.tsx";
import { SearchIcon } from "../components/glyphs.tsx";
import { GridIcon, ListIcon, UserPlusIcon } from "../components/member-glyphs.tsx";
import { IS_DEV } from "@web/utils/dev.ts";
import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";

/**
 * MemberRoster — the Members tab workspace (the single island the `/projects/[…]/members` routes
 * mount). THIN: first paint is the SSR-resolved {@link MemberRosterPage}; the island owns the view
 * state and refines the bounded roster CLIENT-side (search · role · stage filter · sort · grid⇄table)
 * with no round-trip. It re-fetches through the thin {@link MembersService} only when the DEV Context
 * Switcher changes the simulated acting-member role, project type, or pending-invite state (task §4) —
 * mirroring the `/projects` lane's dev-seam integration.
 *
 * The management surfaces (row actions menu · Edit member · Invite / Pending invitations · Remove
 * confirmation) are gated on the server-derived {@link MemberRosterPage.viewerCaps}, so a freelancer /
 * observer never sees them. Every mutation is OPTIMISTIC — persistence lands with the live members
 * backend behind `PROJECTS_BACKEND_LIVE` (root CLAUDE.md §10). Dumb island: no DB/Supabase, no @server.
 */
export interface MemberRosterProps {
	/**
	 * Which space is being read. `channel`/`project` are the engagement scopes; `conversation` is the
	 * global inbox (`/messages/[conversationId]/members`) — the same roster over a conversation's
	 * participants, routed to `/api/messaging/members` by the shared {@link MembersService}.
	 */
	scope: MemberScope;
	/** The project id — or, in `conversation` scope, the conversation id. */
	projectId: string;
	/** The channel id in channel scope (the conversation id in conversation scope). */
	channelId?: string;
	initial: MemberRosterPage | null;
}

/** Map the DEV Context Switcher seam onto the roster's simulation params (dev-only; `null` in prod). */
function seamToParams(
	s: DevSeamState | null,
	projectId: string,
	channelId: string | null,
): MemberRosterParams {
	if (!s?.enabled) return { projectId, channelId };
	return {
		projectId,
		channelId,
		simViewer: s.memberRole,
		simProjectType: s.projectType,
		simPendingInvites: s.pendingInvites,
	};
}

export default function MemberRoster(props: MemberRosterProps): JSX.Element {
	const { projectId, channelId, initial } = props;

	// #region State
	const page = useSignal<MemberRosterPage | null>(initial);
	const members = useSignal<ProjectMemberRow[]>(initial?.members ?? []);
	const invites = useSignal<MemberInvite[]>(initial?.invites ?? []);
	const loading = useSignal(false);

	const query = useSignal("");
	const roleFilter = useSignal<string[]>([]);
	const stageFilter = useSignal("");
	const viewMode = useSignal<"table" | "cards">("table");
	const sortKey = useSignal<MemberSortKey>("role");
	const sortDir = useSignal<"asc" | "desc">("asc");

	const editOpen = useSignal(false);
	const editMember = useSignal<ProjectMemberRow | null>(null);
	const inviteOpen = useSignal(false);
	const removeOpen = useSignal(false);
	const removeMember = useSignal<ProjectMemberRow | null>(null);

	const reqId = useRef(0);
	const searchTimer = useRef<number | null>(null);
	const devKey = useRef<string | null>(null);
	// #endregion

	// #region DEV seam re-simulation (tree-shaken out of production)
	async function refetch(params: MemberRosterParams & { scope?: MemberScope }): Promise<void> {
		const my = ++reqId.current;
		loading.value = true;
		const res = await MembersService.list(params);
		if (my !== reqId.current) return;
		loading.value = false;
		if (res.ok && res.data) {
			page.value = res.data.page;
			members.value = res.data.page.members;
			invites.value = res.data.page.invites;
		}
	}

	useEffect(() => {
		if (!IS_DEV) return;
		const chan = channelId ?? null;
		const keyOf = (s: DevSeamState | null) =>
			s?.enabled ? `${s.memberRole}|${s.projectType}|${s.pendingInvites}` : null;
		const apply = (s: DevSeamState | null) => {
			const key = keyOf(s);
			if (key === devKey.current) return; // an unrelated seam tweak — no roster re-simulation
			devKey.current = key;
			void refetch(seamToParams(s, projectId, chan));
		};
		const initialSeam = readDevSeam();
		devKey.current = keyOf(initialSeam);
		if (initialSeam?.enabled) void refetch(seamToParams(initialSeam, projectId, chan));
		return subscribeDevSeam(apply);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	// #endregion

	// #region Derived
	const roster = page.value;
	const caps = roster?.viewerCaps ??
		{ canManage: false, canInvite: false, canAssign: false, canEditRoles: false, canRemove: false };
	const stages = roster?.stages ?? [];
	const stageChannel = roster?.scope === "channel" && roster?.channelKind === "stage";
	const filter = {
		query: query.value,
		roles: roleFilter.value as MemberRole[],
		stage: stageFilter.value,
	};
	const filtered = sortMembers(filterMembers(members.value, filter), sortKey.value, sortDir.value);
	const filterCount = activeFilterCount(filter);
	// #endregion

	// #region Handlers — filtering
	function onSearch(v: string): void {
		if (searchTimer.current) clearTimeout(searchTimer.current);
		// Debounce only the signal write so typing stays smooth on a long roster.
		searchTimer.current = setTimeout(() => (query.value = v), 120) as unknown as number;
	}
	function onSort(key: MemberSortKey): void {
		if (sortKey.value === key) sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
		else {
			sortKey.value = key;
			sortDir.value = "asc";
		}
	}
	// #endregion

	// #region Handlers — management (optimistic)
	function openEdit(m: ProjectMemberRow): void {
		editMember.value = m;
		editOpen.value = true;
	}
	function saveEdit(id: string, role: MemberRole, stageNames: string[]): void {
		members.value = members.value.map((m) =>
			m.id === id ? { ...m, role, assignedStages: [...stageNames] } : m
		);
	}
	function quickAssign(m: ProjectMemberRow, assign: boolean): void {
		members.value = members.value.map((r) =>
			r.id === m.id ? { ...r, assignment: assign ? "contributor" : "observer" } : r
		);
	}
	function askRemove(m: ProjectMemberRow): void {
		removeMember.value = m;
		removeOpen.value = true;
	}
	function confirmRemove(): void {
		const id = removeMember.value?.id;
		if (id) members.value = members.value.filter((m) => m.id !== id);
		removeMember.value = null;
	}

	function invite(emails: string[], role: MemberRole, stageId: string | null): void {
		const stage = stageId ? stages.find((s) => s.id === stageId) ?? null : null;
		const inviter = members.value.find((m) => m.id === roster?.viewerId)?.party.name ?? "You";
		const now = Date.now();
		const added: MemberInvite[] = emails.map((email, i) => ({
			id: `inv-new-${now}-${i}`,
			email,
			role,
			stageId: stage?.id ?? null,
			stageName: stage?.name ?? null,
			invitedBy: inviter,
			invitedAt: new Date(now).toISOString(),
			invitedLabel: "Just now",
			status: "pending",
		}));
		invites.value = [...added, ...invites.value];
	}
	function resendInvite(id: string): void {
		invites.value = invites.value.map((inv) =>
			inv.id === id ? { ...inv, status: "pending", invitedLabel: "Just now" } : inv
		);
	}
	function cancelInvite(id: string): void {
		invites.value = invites.value.filter((inv) => inv.id !== id);
	}
	// #endregion

	if (!roster) {
		return (
			<section class="mem-root">
				<div class="mem-empty" role="status">
					<p class="mem-empty__title">Members unavailable</p>
					<p class="mem-empty__note">This engagement's roster couldn't be loaded.</p>
				</div>
			</section>
		);
	}

	const renderActions = (m: ProjectMemberRow) =>
		caps.canManage && !m.isViewer
			? (
				<MemberActionsMenu
					member={m}
					stageChannel={stageChannel}
					stageName={roster.channelName}
					caps={caps}
					onEdit={openEdit}
					onQuickAssign={quickAssign}
					onRemove={askRemove}
				/>
			)
			: null;

	const isEmpty = filtered.length === 0;
	const contextLine = roster.scope === "conversation"
		? `Everyone in this conversation`
		: roster.scope === "channel"
		? `People with access to ${roster.channelName ?? "this channel"}`
		: `Everyone in ${roster.projectTitle}`;

	return (
		<section
			class="mem-root"
			data-loading={loading.value ? "true" : undefined}
			aria-label="Members"
		>
			{/* Header — identity + count + primary Invite action (task §3) */}
			<header class="mem-head">
				<div class="mem-head__id">
					<span class="mem-head__icon" aria-hidden="true">{MembersIcon}</span>
					<div class="mem-head__text">
						<h2 class="mem-head__title">
							Members
							<span class="mem-head__count">{roster.total}</span>
						</h2>
						<p class="mem-head__sub">{contextLine}</p>
					</div>
				</div>
				{caps.canInvite && (
					<Button
						variant="filled"
						icon={UserPlusIcon}
						label="Invite"
						onClick={() => (inviteOpen.value = true)}
					/>
				)}
			</header>

			{/* Toolbar — search · role filter · stage filter · view toggle (task §2.1) */}
			<div class="mem-toolbar">
				<div class="mem-toolbar__search">
					<InputText
						type="search"
						variant="bare"
						size="sm"
						block
						placeholder="Search by name, handle, or email…"
						aria-label="Search members"
						onValueChange={onSearch}
						start={
							<span class="mem-toolbar__searchicon" aria-hidden="true">
								{SearchIcon}
							</span>
						}
					/>
				</div>
				<span class="mem-toolbar__spacer" />
				<MultiSelect
					class="ui-field--bare"
					size="sm"
					display="chip"
					placeholder="All roles"
					aria-label="Filter by role"
					options={ROLE_FILTER_OPTIONS.map((r) => ({ label: r.label, value: r.value }))}
					value={roleFilter}
				/>
				{stages.length > 0 && (
					<Select
						class="ui-field--bare"
						size="sm"
						placeholder="All stages"
						aria-label="Filter by stage"
						options={[
							{ label: "All stages", value: "" },
							...stages.map((s) => ({ label: s.name, value: s.name })),
						]}
						value={stageFilter}
					/>
				)}
				<div class="mem-viewtoggle" role="group" aria-label="Roster layout">
					<Tooltip content="Table view">
						<button
							type="button"
							class="mem-iconbtn"
							data-on={viewMode.value === "table" ? "true" : undefined}
							aria-pressed={viewMode.value === "table"}
							aria-label="Table view"
							onClick={() => (viewMode.value = "table")}
						>
							{ListIcon}
						</button>
					</Tooltip>
					<Tooltip content="Card view">
						<button
							type="button"
							class="mem-iconbtn"
							data-on={viewMode.value === "cards" ? "true" : undefined}
							aria-pressed={viewMode.value === "cards"}
							aria-label="Card view"
							onClick={() => (viewMode.value = "cards")}
						>
							{GridIcon}
						</button>
					</Tooltip>
				</div>
			</div>

			{/* Roster body */}
			{isEmpty
				? (
					<div class="mem-empty" role="status">
						<p class="mem-empty__title">No members match</p>
						<p class="mem-empty__note">
							{filterCount > 0
								? "Try clearing the search or filters."
								: "Nobody has access to this space yet."}
						</p>
					</div>
				)
				: viewMode.value === "table"
				? (
					<MemberTable
						members={filtered}
						scope={roster.scope}
						stageChannel={stageChannel}
						sortKey={sortKey}
						sortDir={sortDir}
						onSort={onSort}
						renderActions={renderActions}
						showActions={caps.canManage}
					/>
				)
				: (
					<div class="mem-grid">
						{filtered.map((m) => (
							<MemberCard
								key={m.id}
								member={m}
								scope={roster.scope}
								stageChannel={stageChannel}
								actions={renderActions(m)}
							/>
						))}
					</div>
				)}

			{/* Management surfaces (task §2.2 / §3) */}
			<MemberEditDialog
				open={editOpen}
				member={editMember.value}
				stages={stages}
				onSave={saveEdit}
				onClose={() => (editMember.value = null)}
			/>
			<MemberInviteModal
				open={inviteOpen}
				stages={stages}
				invites={invites.value}
				defaultStageId={stageChannel ? roster.channelId : null}
				onInvite={invite}
				onResend={resendInvite}
				onCancel={cancelInvite}
				onClose={() => {}}
			/>
			<ConfirmDialog
				visible={removeOpen}
				header="Remove member"
				message={removeMember.value
					? `Remove ${removeMember.value.party.name} (${
						roleMeta(removeMember.value.role).label
					}) from this project? They'll lose access to all its channels and stages.`
					: ""}
				acceptLabel="Remove"
				rejectLabel="Cancel"
				acceptSeverity="danger"
				onAccept={confirmRemove}
				onReject={() => (removeMember.value = null)}
			/>
		</section>
	);
}

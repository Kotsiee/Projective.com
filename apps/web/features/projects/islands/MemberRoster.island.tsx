import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/members.css";
import { Button, InputText, MultiSelect, Select } from "@projective/ui/fields";
import { Toast, Tooltip, useToast } from "@projective/ui/feedback";
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
	sortMembers,
} from "../core/member-model.ts";
import { MemberTable } from "../components/MemberTable.tsx";
import { MemberCard } from "../components/MemberCard.tsx";
import { MemberActionsMenu } from "../components/MemberActionsMenu.tsx";
import { MemberEditDialog } from "../components/MemberEditDialog.tsx";
import { MemberInviteModal } from "../components/MemberInviteModal.tsx";
import { InvitationList } from "../components/InvitationList.tsx";
import { RemoveMemberDialog } from "../components/RemoveMemberDialog.tsx";
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
 * The management surfaces (row actions menu · Edit member · Invite / Pending invitations · the
 * Invitations list · Remove confirmation) are gated on the server-derived
 * {@link MemberRosterPage.viewerCaps}, so a freelancer / observer never sees them. Edit and the stage
 * quick-toggle remain OPTIMISTIC; the invitation acts (cancel · dismiss) and a removal go through the
 * thin {@link MembersService} to the fat service, which applies them on the live path and records them
 * in the write store on the stub path — the local list follows the SERVER's answer, never precedes it,
 * because a removal moves escrow and a row that disappeared before the write landed would be a
 * removal the client believes happened. Dumb island: no DB/Supabase, no @server.
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
	/** The stage a pending removal is scoped to — an accepted stage invitation unassigns; a kebab removes. */
	const removeStage = useSignal<{ id: string; name: string } | null>(null);
	/** Invitation ids with a write in flight — their control is disabled until the server answers. */
	const busyInvites = useSignal<ReadonlySet<string>>(new Set<string>());
	const removing = useRef(false);
	/** Mounted only once there is something to say, and never beside a stack another island put up. */
	const toastMounted = useSignal(false);
	const toast = useToast();

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
	function say(severity: "success" | "danger" | "warning", summary: string): void {
		if (!document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({ severity, summary, life: 4000 });
	}
	function markBusy(id: string, on: boolean): void {
		const next = new Set(busyInvites.value);
		if (on) next.add(id);
		else next.delete(id);
		busyInvites.value = next;
	}

	/** Open the consequence-aware confirmation for a member — from their kebab, or from an accepted invitation. */
	function askRemove(m: ProjectMemberRow, stage: { id: string; name: string } | null = null): void {
		removeMember.value = m;
		removeStage.value = stage;
		removeOpen.value = true;
	}
	/**
	 * Apply a confirmed removal. The list follows the SERVER's answer: on a whole-project removal the row
	 * leaves; on a stage-scoped one it loses that stage, and leaves THIS roster only when this roster is
	 * that stage's. Every accepted invitation the removal undid leaves the Invitations list with it.
	 */
	async function confirmRemove(): Promise<void> {
		const target = removeMember.value;
		const stage = removeStage.value;
		if (!target || removing.current) return;
		removing.current = true;
		const res = await MembersService.removeMember({
			projectId,
			memberId: target.id,
			stageId: stage?.id ?? null,
		});
		removing.current = false;
		removeMember.value = null;
		removeStage.value = null;
		if (!res.ok || !res.data) {
			say("danger", res.message ?? "That member could not be removed.");
			return;
		}
		const here = roster?.stageId;
		if (res.data.removedFrom === "project" || (stage && here && stage.id === here)) {
			members.value = members.value.filter((m) => m.id !== target.id);
		} else if (stage) {
			members.value = members.value.map((m) =>
				m.id === target.id
					? { ...m, assignedStages: m.assignedStages.filter((name) => name !== stage.name) }
					: m
			);
		}
		invites.value = invites.value.filter((inv) =>
			!(inv.status === "accepted" && inv.memberId === target.id &&
				(res.data!.removedFrom === "project" || inv.stageId === stage?.id))
		);
		say("success", res.message ?? "Removed.");
	}

	/** The roster row an accepted invitation brought in, when this roster can see them. */
	function memberOf(inv: MemberInvite): ProjectMemberRow | null {
		if (!inv.memberId) return null;
		return members.value.find((m) => m.id === inv.memberId) ?? null;
	}
	function removeInvitee(inv: MemberInvite): void {
		const m = memberOf(inv);
		if (!m) return;
		const stage = inv.stageId && inv.stageName ? { id: inv.stageId, name: inv.stageName } : null;
		askRemove(m, stage);
	}
	async function cancelInviteRow(inv: MemberInvite): Promise<void> {
		if (busyInvites.value.has(inv.id)) return;
		markBusy(inv.id, true);
		const res = await MembersService.cancelInvite(projectId, inv.id);
		markBusy(inv.id, false);
		if (!res.ok) {
			say("danger", res.message ?? "The invitation could not be cancelled.");
			return;
		}
		invites.value = invites.value.filter((row) => row.id !== inv.id);
		say("success", res.message ?? "Invitation cancelled.");
	}
	async function dismissInviteRow(inv: MemberInvite): Promise<void> {
		if (busyInvites.value.has(inv.id)) return;
		markBusy(inv.id, true);
		const res = await MembersService.dismissInvite(projectId, inv.id);
		markBusy(inv.id, false);
		if (!res.ok) {
			say("danger", res.message ?? "The invitation could not be dismissed.");
			return;
		}
		invites.value = invites.value.filter((row) => row.id !== inv.id);
		say("success", res.message ?? "Invitation dismissed.");
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
	/** The modal's Cancel control routes through the same server write as the list's. */
	function cancelInvite(id: string): void {
		const inv = invites.value.find((row) => row.id === id);
		if (!inv) return;
		if (inv.status === "pending") void cancelInviteRow(inv);
		else void dismissInviteRow(inv);
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

			{/* Invitations — every record for THIS scope, with its lifecycle badge and one action (task §2.2) */}
			{caps.canInvite && roster.scope !== "conversation" && (
				<InvitationList
					invites={invites.value}
					caps={caps}
					stageScoped={stageChannel}
					canRemove={(inv) => memberOf(inv) !== null && !memberOf(inv)?.isViewer}
					onCancel={(inv) => void cancelInviteRow(inv)}
					onDismiss={(inv) => void dismissInviteRow(inv)}
					onRemove={removeInvitee}
					busy={busyInvites.value}
				/>
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
			<RemoveMemberDialog
				visible={removeOpen}
				member={removeMember.value}
				stageName={removeStage.value?.name ?? null}
				onAccept={() => void confirmRemove()}
				onReject={() => {
					removeMember.value = null;
					removeStage.value = null;
				}}
			/>
			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</section>
	);
}

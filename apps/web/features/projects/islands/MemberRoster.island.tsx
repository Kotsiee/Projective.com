import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/fx-toolbar.css";
import "../styles/file-explorer.css";
import "../styles/members.css";
import "../styles/member-stages.css";
import { Toast, useToast } from "@projective/ui/feedback";
import { useIsMobile } from "@projective/ui/hooks";
import type {
	MemberInvite,
	MemberRequest,
	MemberRole,
	MemberRosterPage,
	MemberRosterParams,
	MemberScope,
	MemberStagePicture,
	MemberStageRef,
	ProjectMemberRow,
} from "../types/projects-types.ts";
import { AssignableMemberRole, memberStagePicture } from "../types/projects-types.ts";
import { MembersService } from "../core/MembersService.ts";
import { RequestService } from "../core/RequestService.ts";
import {
	filterInvites,
	filterMembers,
	filterRequests,
	INVITE_SORT_OPTIONS,
	MEMBER_SORT_OPTIONS,
	type MemberSortKey,
	type QueueSortKey,
	REQUEST_SORT_OPTIONS,
	sortInvites,
	sortMembers,
	sortRequests,
} from "../core/member-model.ts";
import {
	memberContextFor,
	type MemberSection,
	memberSectionHref,
	memberSectionsFor,
	sessionSeatLine,
} from "../core/member-sections.ts";
import { type ChatTarget, openMemberChat } from "../core/member-chat.ts";
import { inviteOpen, membersZoom, setInviteAvailable } from "../core/member-view-state.ts";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import { ProfileService } from "@web/features/profile/core/ProfileService.ts";
import { MemberSectionBar } from "../components/MemberSectionBar.tsx";
import { MemberToolbar } from "../components/MemberToolbar.tsx";
import { MemberWorkspace } from "../components/MemberWorkspace.tsx";
import { MessageButton } from "../components/MemberSectionCards.tsx";
import { MemberActionsMenu } from "../components/MemberActionsMenu.tsx";
import { MemberEditDialog } from "../components/MemberEditDialog.tsx";
import { MemberInviteModal } from "../components/MemberInviteModal.tsx";
import { RemoveMemberDialog } from "../components/RemoveMemberDialog.tsx";
import { MemberStagePanel } from "../components/MemberStagePanel.tsx";
import { PendingStageInvites } from "../components/PendingStageInvites.tsx";
import { useStageInvites } from "../hooks/useStageInvites.ts";
import {
	MemberPreviewModal,
	type PreviewSubject,
	type ProfileLoad,
} from "../components/MemberPreviewModal.tsx";
import { IS_DEV } from "@web/utils/dev.ts";
import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";

/**
 * MemberRoster — the Members tab workspace (the single island every `…/members` route mounts through
 * `MembersView`), in the File / Submissions explorer anatomy: a sticky bar group (the section tabs
 * above the shared `.fx-toolbar`), then the zoom-driven body — profile cards above the zoom's centre
 * marker, a table below it — with the footer rig (`MemberViewControlRig`) owning the zoom and Invite.
 *
 * **Three sections, one address each.** Members is the roster; Requests holds open applications with
 * Accept / Reject; Invitations holds what the project sent with the one act its state admits. The
 * section is URL state (`?view=`, resolved server-side into `initialSection`) and a tab switch rewrites
 * the address in place, so it survives a reload and can be linked.
 *
 * **Writes.** Accept, Reject, Revoke and Dismiss are OPTIMISTIC: the record leaves its queue at once,
 * and returns to where it was if the server refuses. A removal is not — it moves escrow, so the list
 * follows the server's answer rather than preceding it (Decision #116). After any write the roster is
 * re-read in the background, so a confirmed applicant appears among the members as the server seats
 * them. Stage seats are offered by invitation (the kebab's "Invite to stage ›", the preview's Stages
 * section) and accepted by the freelancer; they are never granted here (Decision #139). Invitations
 * (`MembersService.invite`) and role changes (`MembersService.updateRole`) are persisted and NOT
 * optimistic — the roster shows them once the server answers, so a reload reads back the same list.
 *
 * THIN: no DB, no `@server`; it refines the bounded roster client-side and reaches the server through
 * the thin `MembersService` / `RequestService`.
 */
export interface MemberRosterProps {
	/**
	 * Which space is being read. `channel`/`project` are the engagement scopes; `conversation` is the
	 * global inbox (`/messages/[conversationId]/members`), routed to `/api/messaging/members`.
	 */
	scope: MemberScope;
	/** The project id — or, in `conversation` scope, the conversation id. */
	projectId: string;
	/** The channel id in channel scope (the conversation id in conversation scope). */
	channelId?: string;
	initial: MemberRosterPage | null;
	/** The section the address selected, already resolved against what the viewer may see. */
	initialSection: MemberSection;
}

const PANEL_ID = "mem-section-panel";

/** Map the DEV Context Switcher seam onto the roster's simulation params (dev-only; plain in prod). */
function seamToParams(
	s: DevSeamState | null,
	scope: MemberScope,
	projectId: string,
	channelId: string | null,
): MemberRosterParams & { scope: MemberScope } {
	if (!s?.enabled) return { scope, projectId, channelId };
	return {
		scope,
		projectId,
		channelId,
		simViewer: s.memberRole,
		simProjectType: s.projectType,
		simPendingInvites: s.pendingInvites,
		simPendingRequests: s.pendingRequests,
	};
}

/** Put a record back where it was — the rollback of an optimistic removal. */
function restoreAt<T>(list: T[], item: T, index: number): T[] {
	const next = [...list];
	next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
	return next;
}

export default function MemberRoster(props: MemberRosterProps): JSX.Element {
	const { scope, projectId, channelId, initial } = props;

	// #region State
	const page = useSignal<MemberRosterPage | null>(initial);
	const members = useSignal<ProjectMemberRow[]>(initial?.members ?? []);
	const invites = useSignal<MemberInvite[]>(initial?.invites ?? []);
	const requests = useSignal<MemberRequest[]>(initial?.requests ?? []);
	const loading = useSignal(false);
	const seam = useSignal<DevSeamState | null>(null);

	const section = useSignal<MemberSection>(props.initialSection);
	const query = useSignal("");
	const roleFilter = useSignal<string[]>([]);
	const stageFilter = useSignal("");
	const memberSortKey = useSignal<string>("role");
	const memberSortDir = useSignal<"asc" | "desc">("asc");
	const requestSortKey = useSignal<string>("date");
	const requestSortDir = useSignal<"asc" | "desc">("desc");
	const inviteSortKey = useSignal<string>("date");
	const inviteSortDir = useSignal<"asc" | "desc">("desc");

	/** Record ids with a write in flight — their controls hold until the server answers. */
	const busy = useSignal<ReadonlySet<string>>(new Set<string>());

	const previewOpen = useSignal(false);
	const previewSubject = useSignal<PreviewSubject | null>(null);
	const profiles = useSignal<ReadonlyMap<string, ProfileLoad>>(new Map());

	const editOpen = useSignal(false);
	const editMember = useSignal<ProjectMemberRow | null>(null);
	const removeOpen = useSignal(false);
	const removeMember = useSignal<ProjectMemberRow | null>(null);
	/** The stage a pending removal is scoped to — an accepted stage invitation unassigns; a kebab removes. */
	const removeStage = useSignal<{ id: string; name: string } | null>(null);
	const removing = useRef(false);
	/** Mounted only once there is something to say, and never beside a stack another island put up. */
	const toastMounted = useSignal(false);
	const toast = useToast();
	const mobile = useIsMobile();

	const stageInvites = useStageInvites(projectId, invites, say);

	const reqId = useRef(0);
	const devKey = useRef<string | null>(null);
	const workspaceRef = useRef<HTMLDivElement>(null);
	// #endregion

	// #region Reads
	async function refetch(): Promise<void> {
		const my = ++reqId.current;
		loading.value = true;
		const res = await MembersService.list(
			seamToParams(seam.value, scope, projectId, channelId ?? null),
		);
		if (my !== reqId.current) return;
		loading.value = false;
		if (res.ok && res.data) {
			const next = res.data.page;
			page.value = next;
			members.value = next.members;
			invites.value = next.invites;
			requests.value = next.requests;
		}
	}

	useEffect(() => {
		if (!IS_DEV) return;
		const keyOf = (s: DevSeamState | null) =>
			s?.enabled
				? `${s.memberRole}|${s.projectType}|${s.pendingInvites}|${s.pendingRequests}|${s.serviceType}`
				: null;
		const apply = (s: DevSeamState | null) => {
			seam.value = s;
			const key = keyOf(s);
			if (key === devKey.current) return;
			devKey.current = key;
			void refetch();
		};
		const initialSeam = readDevSeam();
		seam.value = initialSeam;
		devKey.current = keyOf(initialSeam);
		if (initialSeam?.enabled) void refetch();
		return subscribeDevSeam(apply);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useCtrlWheelZoom(workspaceRef, membersZoom);
	// #endregion

	// #region Derived
	const roster = page.value;
	const caps = roster?.viewerCaps ??
		{ canManage: false, canInvite: false, canAssign: false, canEditRoles: false, canRemove: false };
	const canInvite = !!roster && caps.canInvite && roster.scope !== "conversation";

	useEffect(() => {
		setInviteAvailable(canInvite);
		return () => setInviteAvailable(false);
	}, [canInvite]);
	// #endregion

	if (!roster) {
		return (
			<section class="mem-explorer" data-scope={scope}>
				<div class="fx-empty" role="status">
					<p class="fx-empty__title">Members unavailable</p>
					<p class="fx-empty__note">This roster couldn't be loaded.</p>
				</div>
			</section>
		);
	}

	const sections = memberSectionsFor(roster);
	const active = sections.includes(section.value) ? section.value : "members";
	const context = memberContextFor(roster, seam.value?.enabled ? seam.value.serviceType : null);
	const showWorkload = roster.scope !== "conversation" && context.session === null;
	const stages = roster.stages;
	const filter = {
		query: query.value,
		roles: roleFilter.value as MemberRole[],
		stage: context.showStages ? stageFilter.value : "",
	};
	const filtered = !!(filter.query || filter.roles.length || filter.stage);

	const sortFor = {
		members: { key: memberSortKey, dir: memberSortDir, options: MEMBER_SORT_OPTIONS },
		requests: { key: requestSortKey, dir: requestSortDir, options: REQUEST_SORT_OPTIONS },
		invitations: { key: inviteSortKey, dir: inviteSortDir, options: INVITE_SORT_OPTIONS },
	}[active];

	const shownMembers = sortMembers(
		filterMembers(members.value, filter),
		memberSortKey.value as MemberSortKey,
		memberSortDir.value,
	);
	const shownRequests = sortRequests(
		filterRequests(requests.value, filter),
		requestSortKey.value as QueueSortKey,
		requestSortDir.value,
	);
	const shownInvites = sortInvites(
		filterInvites(invites.value, filter),
		inviteSortKey.value as QueueSortKey,
		inviteSortDir.value,
	);

	// #region Handlers — navigation + preview
	function selectSection(next: MemberSection): void {
		section.value = next;
		globalThis.history?.replaceState(
			globalThis.history.state,
			"",
			memberSectionHref(globalThis.location.href, next),
		);
	}

	function onSort(key: string): void {
		if (sortFor.key.value === key) sortFor.dir.value = sortFor.dir.value === "asc" ? "desc" : "asc";
		else {
			sortFor.key.value = key;
			sortFor.dir.value = "asc";
		}
	}

	function handleOf(subject: PreviewSubject): string | null {
		const raw = subject.kind === "member"
			? subject.member.party.handle
			: subject.kind === "request"
			? subject.request.applicant.handle
			: subject.invite.handle;
		return raw ? raw.replace(/^@+/, "") : null;
	}

	function setProfile(handle: string, load: ProfileLoad): void {
		const next = new Map(profiles.value);
		next.set(handle, load);
		profiles.value = next;
	}

	async function loadProfile(handle: string): Promise<void> {
		const known = profiles.value.get(handle);
		if (known && (known.state === "loaded" || known.state === "loading")) return;
		setProfile(handle, { state: "loading" });
		const res = await ProfileService.overview(handle);
		setProfile(
			handle,
			res.ok && res.data ? { state: "loaded", profile: res.data.profile } : { state: "error" },
		);
	}

	function openPreview(subject: PreviewSubject): void {
		previewSubject.value = subject;
		previewOpen.value = true;
		const handle = handleOf(subject);
		if (handle) void loadProfile(handle);
	}

	function message(target: ChatTarget): void {
		previewOpen.value = false;
		openMemberChat(target, mobile);
	}
	// #endregion

	// #region Handlers — writes
	function say(severity: "success" | "danger" | "warning", summary: string): void {
		if (!document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({ severity, summary, life: 4000 });
	}
	function markBusy(id: string, on: boolean): void {
		const next = new Set(busy.value);
		if (on) next.add(id);
		else next.delete(id);
		busy.value = next;
	}
	function closePreviewOf(id: string): void {
		const s = previewSubject.value;
		const shown = s?.kind === "request" ? s.request.id : s?.kind === "invite" ? s.invite.id : null;
		if (shown === id) previewOpen.value = false;
	}

	async function decide(request: MemberRequest, accept: boolean): Promise<void> {
		if (busy.value.has(request.id)) return;
		const index = requests.value.findIndex((r) => r.id === request.id);
		markBusy(request.id, true);
		closePreviewOf(request.id);
		requests.value = requests.value.filter((r) => r.id !== request.id);
		const res = accept
			? await RequestService.acceptApplication(request.id)
			: await RequestService.rejectApplication(request.id);
		markBusy(request.id, false);
		if (!res.ok) {
			requests.value = restoreAt(requests.value, request, index);
			say("danger", res.message ?? "That request could not be answered.");
			return;
		}
		say(
			"success",
			accept
				? `${request.applicant.name} is in — fund their seat from your wallet.`
				: `${request.applicant.name}'s request was declined.`,
		);
		void refetch();
	}

	async function answerInvite(invite: MemberInvite, act: "cancel" | "dismiss"): Promise<void> {
		if (busy.value.has(invite.id)) return;
		const index = invites.value.findIndex((row) => row.id === invite.id);
		markBusy(invite.id, true);
		closePreviewOf(invite.id);
		invites.value = invites.value.filter((row) => row.id !== invite.id);
		const res = act === "cancel"
			? await MembersService.cancelInvite(projectId, invite.id)
			: await MembersService.dismissInvite(projectId, invite.id);
		markBusy(invite.id, false);
		if (!res.ok) {
			invites.value = restoreAt(invites.value, invite, index);
			say(
				"danger",
				res.message ??
					(act === "cancel"
						? "The invitation could not be revoked."
						: "The invitation could not be dismissed."),
			);
			return;
		}
		say(
			"success",
			res.message ?? (act === "cancel" ? "Invitation revoked." : "Invitation dismissed."),
		);
	}

	function openEdit(m: ProjectMemberRow): void {
		editMember.value = m;
		editOpen.value = true;
	}
	/**
	 * Persist a role change, then apply the SERVER's role to the row. Not optimistic: a role decides
	 * what the person may do, so the roster shows a role only once the database holds it.
	 */
	async function saveEdit(id: string, role: MemberRole): Promise<string | null> {
		const parsed = AssignableMemberRole.safeParse(role);
		if (!parsed.success) return "That role cannot be granted here.";
		const res = await MembersService.updateRole(projectId, id, parsed.data);
		if (!res.ok || !res.data) return res.message ?? "That role could not be changed.";
		const saved = res.data.role;
		members.value = members.value.map((m) => m.id === id ? { ...m, role: saved } : m);
		say("success", res.message ?? "Role updated.");
		return null;
	}

	/** Open the consequence-aware confirmation — from a kebab, or from an accepted invitation. */
	function askRemove(m: ProjectMemberRow, stage: MemberStageRef | null = null): void {
		previewOpen.value = false;
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
		const removedFrom = res.data.removedFrom;
		const here = roster?.stageId;
		if (removedFrom === "project" || (stage && here && stage.id === here)) {
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
				(removedFrom === "project" || inv.stageId === stage?.id))
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

	/**
	 * Send invitations, then fold the rows the SERVER issued into the Invitations section — the queue a
	 * reload reads back. Addresses the server refused (a cooldown, a duplicate, the outbound ceiling)
	 * are reported once, by count and first reason; a send refused outright returns its sentence to the
	 * modal, which keeps the draft open.
	 */
	async function invite(
		addresses: string[],
		role: AssignableMemberRole,
		stageId: string | null,
	): Promise<string | null> {
		const res = await MembersService.invite(projectId, { addresses, role, stageId });
		if (!res.ok || !res.data) return res.message ?? "Those invitations could not be sent.";
		const issued = res.data.invites;
		const fresh = new Set(issued.map((inv) => inv.id));
		invites.value = [...issued, ...invites.value.filter((inv) => !fresh.has(inv.id))];
		selectSection("invitations");
		const refused = res.data.refused;
		if (refused.length > 0) {
			say(
				"warning",
				`${res.message ?? "Some invitations were sent."} ${refused[0].address}: ${
					refused[0].message
				}`,
			);
		} else {
			say("success", res.message ?? "Invitation sent.");
		}
		return null;
	}
	// #endregion

	// #region Stage seats
	const scopedStages: MemberStageRef[] = context.stageChannel && roster.stageId
		? stages.filter((s) => s.id === roster.stageId)
		: stages;
	/** Stage seats apply to a freelancer the viewer can address; a task engagement has none to offer. */
	function pictureOf(m: ProjectMemberRow): MemberStagePicture | null {
		if (!context.showStages || m.role !== "freelancer" || !m.party.handle || m.isViewer) {
			return null;
		}
		return memberStagePicture(m, scopedStages, invites.value);
	}
	function inviteToStages(m: ProjectMemberRow, stageIds: string[]): void {
		void stageInvites.invite(m, stageIds);
	}
	function cancelStageInvite(inv: MemberInvite): void {
		void answerInvite(inv, "cancel");
	}
	const memberPending = (m: ProjectMemberRow, compact: boolean) => {
		const picture = caps.canInvite ? pictureOf(m) : null;
		if (!picture || picture.pending.length === 0) return null;
		return (
			<PendingStageInvites
				pending={picture.pending}
				compact={compact}
				canCancel={caps.canInvite}
				busy={busy.value}
				onCancel={cancelStageInvite}
			/>
		);
	};
	// #endregion

	// #region Row slots
	const chatTargetOf = (party: { name: string; handle: string | null; avatar: string | null }) => ({
		name: party.name,
		handle: party.handle,
		avatar: party.avatar,
	});

	const memberActions = (m: ProjectMemberRow) => (
		<>
			{!m.isViewer && <MessageButton target={chatTargetOf(m.party)} onMessage={message} />}
			<MemberActionsMenu
				member={m}
				stageChannel={context.stageChannel}
				picture={pictureOf(m)}
				caps={caps}
				manageable={caps.canManage && !m.isViewer}
				onEdit={openEdit}
				onInviteToStages={inviteToStages}
				onRemove={askRemove}
			/>
		</>
	);
	const requestActions = (r: MemberRequest) => (
		<MessageButton target={chatTargetOf(r.applicant)} onMessage={message} />
	);
	const inviteActions = (inv: MemberInvite) => (
		<MessageButton
			target={{ name: inv.handle ?? inv.email, handle: inv.handle ?? null, avatar: null }}
			onMessage={message}
		/>
	);
	const removable = (inv: MemberInvite) => {
		const m = memberOf(inv);
		return caps.canRemove && m !== null && !m.isViewer;
	};
	// #endregion

	// #region Context line
	const seatLine = sessionSeatLine(roster, context.session);
	const pendingInvites = invites.value.filter((inv) => inv.status === "pending").length;
	const answered = invites.value.length - pendingInvites;
	const meta = active === "requests"
		? (requests.value.length > 0 ? `${requests.value.length} awaiting a decision` : null)
		: active === "invitations"
		? (invites.value.length > 0
			? [
				pendingInvites > 0 ? `${pendingInvites} pending` : "",
				answered > 0 ? `${answered} answered` : "",
			]
				.filter(Boolean).join(" · ")
			: null)
		: [`${roster.total} ${roster.total === 1 ? "person" : "people"}`, seatLine ?? ""]
			.filter(Boolean).join(" · ");
	// #endregion

	const tabs = sections.length > 1;
	const placeholder = active === "requests"
		? "Search requests…"
		: active === "invitations"
		? "Search invitations…"
		: "Search by name, handle or email…";
	const previewHandle = previewSubject.value ? handleOf(previewSubject.value) : null;
	const previewLoad: ProfileLoad = previewHandle
		? profiles.value.get(previewHandle) ?? { state: "idle" }
		: { state: "idle" };
	const previewBusy = previewSubject.value?.kind === "request" &&
		busy.value.has(previewSubject.value.request.id);
	const shownSubject = previewSubject.value;
	const previewMember = shownSubject?.kind === "member"
		? members.value.find((m) => m.id === shownSubject.member.id) ?? null
		: null;
	const previewPicture = previewMember && caps.canManage ? pictureOf(previewMember) : null;
	const stagePanel = previewMember && previewPicture && (caps.canInvite || caps.canRemove)
		? (
			<MemberStagePanel
				member={previewMember}
				picture={previewPicture}
				canInvite={caps.canInvite}
				canRemove={caps.canRemove}
				busy={busy.value}
				sending={stageInvites.sending.value.has(previewMember.id)}
				onInvite={inviteToStages}
				onCancel={cancelStageInvite}
				onRemove={askRemove}
			/>
		)
		: null;

	return (
		<section
			class="mem-explorer"
			data-scope={scope}
			data-loading={loading.value ? "true" : undefined}
			aria-label="Members"
		>
			<div class="mem-bar">
				<MemberSectionBar
					sections={sections}
					active={active}
					onSelect={selectSection}
					openRequests={requests.value.length}
					panelId={PANEL_ID}
					meta={meta || null}
				/>
				<MemberToolbar
					query={query}
					placeholder={placeholder}
					roleFilter={roleFilter}
					showRoles={active !== "requests"}
					stageFilter={stageFilter}
					stages={stages}
					showStages={context.showStages}
					sortKey={sortFor.key}
					sortDir={sortFor.dir}
					sortOptions={sortFor.options}
				/>
			</div>

			<div
				class="fx-workspace mem-workspace"
				ref={workspaceRef}
				id={tabs ? PANEL_ID : undefined}
				role={tabs ? "tabpanel" : undefined}
				aria-labelledby={tabs ? `${PANEL_ID}-tab-${active}` : undefined}
			>
				<MemberWorkspace
					section={active}
					context={context}
					showWorkload={showWorkload}
					members={shownMembers}
					requests={shownRequests}
					invites={shownInvites}
					filtered={filtered}
					stageScoped={context.stageChannel}
					busy={busy.value}
					sortKey={sortFor.key}
					sortDir={sortFor.dir}
					onSort={onSort}
					memberActions={memberActions}
					memberPending={memberPending}
					requestActions={requestActions}
					inviteActions={inviteActions}
					removable={removable}
					onOpenMember={(member) => openPreview({ kind: "member", member })}
					onOpenRequest={(request) => openPreview({ kind: "request", request })}
					onOpenInvite={(inv) => openPreview({ kind: "invite", invite: inv })}
					onAccept={(r) => void decide(r, true)}
					onReject={(r) => void decide(r, false)}
					onRevoke={(inv) => void answerInvite(inv, "cancel")}
					onDismiss={(inv) => void answerInvite(inv, "dismiss")}
					onRemoveInvitee={removeInvitee}
				/>
			</div>

			<MemberPreviewModal
				open={previewOpen}
				subject={previewSubject.value}
				context={context}
				showWorkload={showWorkload}
				load={previewLoad}
				busy={previewBusy}
				stagePanel={stagePanel}
				onMessage={message}
				onAccept={(r) => void decide(r, true)}
				onReject={(r) => void decide(r, false)}
				onClose={() => (previewSubject.value = null)}
			/>
			<MemberEditDialog
				open={editOpen}
				member={editMember.value}
				onSave={saveEdit}
				onClose={() => (editMember.value = null)}
			/>
			{canInvite && (
				<MemberInviteModal
					open={inviteOpen}
					stages={stages}
					showStages={context.showStages}
					defaultStageId={context.stageChannel ? roster.stageId : null}
					onInvite={invite}
				/>
			)}
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

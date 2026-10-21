import type { JSX } from "preact";
import { batch, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import "@web/features/projects/styles/fx-toolbar.css";
import "@web/features/projects/styles/file-explorer.css";
import "@web/features/projects/styles/members.css";
import "../styles/workspace.css";
import { Grid } from "@projective/ui/layout";
import { MetaLine } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { ConfirmDialog, Toast, useToast } from "@projective/ui/feedback";
import {
	activeMembers,
	kindCopy,
	type PermissionFacet,
	permissionFacets,
	workspaceBase,
	type WorkspaceDetail,
	workspaceHref,
	type WorkspaceInvite,
	type WorkspaceJoinRequest,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { UserAvatarStack } from "@web/components/UserAvatar.tsx";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import { MemberSectionBar } from "@web/features/projects/components/MemberSectionBar.tsx";
import { MemberToolbar } from "@web/features/projects/components/MemberToolbar.tsx";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	membersViewFor,
	openInvite,
	publishDetail,
	selectModuleView,
	viewOr,
} from "../core/workspace-state.ts";
import {
	MEMBERS_CHART,
	MEMBERS_PEOPLE,
	type MembersSection,
	membersSectionOf,
	membersSectionsFor,
	membersSectionView,
	subViewSearch,
	subViewsFor,
} from "../core/sub-views.ts";
import { peopleReading, peopleZoom, rememberPeopleReading } from "../core/view-state.ts";
import { filterMembers, sortMembers } from "../core/workspace-model.ts";
import {
	actionInputFor,
	grantableRoles,
	inviteCounts,
	memberAbilities,
	type MemberAction,
	memberMenu,
	memberProfileHref,
	membersHeaderItems,
	showsSpending,
	showsStake,
	spendingFact,
} from "../core/members-model.ts";
import { afterPanelLeaves } from "../core/overlay-handoff.ts";
import { MemberCard } from "../components/MemberCard.tsx";
import { MemberTable } from "../components/MemberTable.tsx";
import { OrgChart } from "../components/OrgChart.tsx";
import { type InviteAction, InviteQueue } from "../components/InviteQueue.tsx";
import { JoinRequestQueue } from "../components/JoinRequestQueue.tsx";
import { OwnershipTransfer } from "../components/OwnershipTransfer.tsx";
import MemberDrawer from "./MemberDrawer.island.tsx";
import InviteModal from "./InviteModal.island.tsx";

/**
 * MembersScreen — the Members module (Teams work order C2): who is in the entity, what they may do,
 * how loaded they are, and the invitations waiting on an answer.
 *
 * **It is the project roster's anatomy** (Decision #319, `MemberRoster` on `/projects/:p/members`):
 * a sticky bar group — the project's own `MemberSectionBar` (the section tabs, and on its end the
 * seats line — a business also its manager headroom — and the members' faces) over its own
 * `MemberToolbar` (search and a role filter over this entity's roles; the table sorts by its own
 * header, Decision #224) — then the body, then the footer rig owning the view controls.
 *
 * **Sections, one address each** (`core/sub-views.ts`): Members is the bare URL; Invitations is
 * `?view=pending` and is offered to an `invite_members` holder only; Requests is recorded for its
 * queue. A section is a sub-view value, so a tab switch writes the one `?view=` in place.
 *
 * **Members is read three ways.** The People zoom (the footer rig's `ViewZoomRig`) reads it as the
 * `DataTable` (the default, Decision #224) or the card grid; the rig's Org chart toggle (`?view=chart`)
 * turns the whole body into the org chart canvas, with this bar floating over it — its search and role
 * filter then pick people out on the chart. Leaving Members for a queue and coming back returns to the
 * reading the reader left, and so does the header band's Members tab (`peopleReading`).
 *
 * **The rank rule decides every action** (`core/members-model.ts`): a row's menu and the drawer offer
 * only what the viewer may do — an action they cannot perform is absent, not disabled. Removing and
 * leaving are confirmed; the owner steps back only through the ownership transfer. When the drawer
 * asks for one of those dialogs, the screen waits for the drawer to leave and puts focus back on the
 * row (or card) that opened it before the dialog opens (`core/overlay-handoff.ts`), so closing the
 * dialog returns the keyboard reader to their place rather than to the page's top.
 *
 * Every mutation resolves to the re-read `WorkspaceDetail` and replaces the whole projection, so a
 * change the server clamped or refused cannot survive on screen as something the reader believes.
 */

export interface MembersScreenProps {
	workspace: WorkspaceDetail;
	/** The resolved `?view=` sub-view — `people`, `pending` (the invitation queue) or `chart`. */
	view?: string | null;
	/** Which module routed here: `members` or the dedicated `invitations` module. */
	module?: "members" | "invitations";
}

/** The body region the section tabs control. */
const PANEL_ID = "wsp-members-panel";

export default function MembersScreen(props: MembersScreenProps): JSX.Element {
	const detail = useSignal<WorkspaceDetail>(props.workspace);
	const search = useSignal("");
	/** The role filter — role ids; empty filters nothing. */
	const roleFilter = useSignal<string[]>([]);
	const busyId = useSignal<string | null>(null);
	/** A refused approval or decline, by join request id — shown under its row. */
	const requestErrors = useSignal<Record<string, string>>({});
	/** Mounted only once there is something to say, and never beside a stack another island put up. */
	const toastMounted = useSignal(false);
	const toast = useToast();
	/** The member whose drawer is open (kept while it animates out). */
	const openMember = useSignal<WorkspaceMember | null>(null);
	const drawerOpen = useSignal(false);
	/** Bumped on every open, so a reopened drawer starts from the saved member, never a stale draft. */
	const drawerSeq = useSignal(0);
	/** Set while the owner is handing the owner seat over. */
	const transferFor = useSignal<WorkspaceMember | null>(null);
	const confirmLeave = useSignal(false);
	const confirmRemove = useSignal(false);
	const removing = useSignal<WorkspaceMember | null>(null);
	const peopleRef = useRef<HTMLDivElement>(null);
	/** The bar group — it floats over the org chart, which fits the chart clear of it. */
	const barRef = useRef<HTMLDivElement>(null);
	/** What had focus when the drawer opened — where a drawer → dialog hand-off parks focus. */
	const opener = useRef<HTMLElement | null>(null);
	/** Cancels a hand-off still waiting for the drawer to leave. */
	const handoff = useRef<(() => void) | null>(null);

	// `Ctrl`+wheel / pinch over the people scales them on People's own zoom; it also restores it.
	useCtrlWheelZoom(peopleRef, peopleZoom);

	// A hand-off still waiting when the screen goes away must not open anything.
	useEffect(() => () => handoff.current?.(), []);

	// `?invite=1` — the bands on modules that do not mount the invite dialog link here with it, so their
	// Invite lands on the dialog rather than on a page the reader must search. `?member=<handle>` — the
	// lane search's person hit — opens that member's drawer.
	useEffect(() => {
		const url = new URL(globalThis.location.href);
		const invite = url.searchParams.get("invite") === "1";
		const handle = url.searchParams.get("member");
		if (!invite && !handle) return;
		url.searchParams.delete("invite");
		url.searchParams.delete("member");
		globalThis.history.replaceState(null, "", `${url.pathname}${url.search}`);
		if (invite && detail.peek().viewerCapabilities.includes("invite_members")) openInvite();
		const member = handle ? detail.peek().members.find((m) => m.handle === handle) : undefined;
		if (member) openDrawer(member);
	}, []);

	const ws = detail.value;
	const copy = kindCopy(ws.kind);
	const caps = ws.viewerCapabilities;
	const canInvite = caps.includes("invite_members");
	const stake = showsStake(ws.kind, caps);
	/** A business's Spending column — only for a viewer the read gave every envelope (BU7). */
	const spending = showsSpending(ws);

	/** The viewer's own row — the actor the rank rule is evaluated against. */
	const actor = ws.members.find((m) => m.id === ws.viewerMemberId) ??
		ws.members.find((m) => m.isSelf) ?? null;
	const active = activeMembers(ws.members);

	const view = viewOr(props.view ?? null);
	/** Every Members sub-view this viewer is offered — the sections, and the address each writes. */
	const subViews = subViewsFor("members", ws.kind, caps);
	const sections = membersSectionsFor(subViews);
	/** The dedicated `/invitations` module is the Invitations section under its own address. */
	const section: MembersSection = props.module === "invitations"
		? "invitations"
		: membersSectionOf(view);
	/** The queue the viewer sees, split as the seat count splits it (lapsed ones hold no seat). */
	const queue = inviteCounts(ws.invites, Date.now());
	const presentation = membersViewFor(view);
	const charted = section === "members" && presentation === "chart";
	const tabs = sections.length > 1;

	// The reading on screen is the one the header band's Members tab returns to (Decision #319).
	useEffect(() => {
		if (props.module === "invitations" || section !== "members") return;
		rememberPeopleReading(charted ? MEMBERS_CHART : MEMBERS_PEOPLE);
	}, [section, charted]);

	const roleIds = roleFilter.value;
	const people = filterMembers(active, { search: search.value })
		.filter((m) => roleIds.length === 0 || roleIds.includes(m.roleId));
	/** Who the bar picks out on the org chart — `null` while it filters nothing. */
	const peopleKey = people.map((m) => m.id).join(",");
	const filtering = search.value.trim() !== "" || roleIds.length > 0;
	const matches = useMemo(
		() => (filtering ? new Set(people.map((m) => m.id)) : null),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[filtering, peopleKey],
	);
	/** The chart's people, in the order its siblings read: by authority, then name. */
	const chartPeople = useMemo(() => sortMembers(active, "role"), [ws]);
	/** The role filter offers the roles somebody holds — a filter that can only empty the list is noise. */
	const roleOptions = useMemo(() => {
		const held = new Set(active.map((m) => m.roleId));
		return ws.roles.filter((r) => held.has(r.id)).map((r) => ({ label: r.name, value: r.id }));
	}, [ws]);

	/** Per-member facets from the SSOT, resolved once per detail rather than per presentation. */
	const facetsById = useMemo(() => {
		const out: Record<string, readonly PermissionFacet[]> = {};
		for (const m of ws.members) out[m.id] = permissionFacets(m, ws.kind, ws.roles, m.roleId);
		return out;
	}, [ws]);

	// #region Actions
	/** Replace the whole projection from a server response, and republish it to the bands. */
	function adopt(next: WorkspaceDetail): void {
		detail.value = next;
		publishDetail(next);
	}

	/** Leave the console for the roster — the viewer is no longer a member of this entity. */
	function leaveConsole(): void {
		globalThis.location.assign(workspaceBase(ws.kind));
	}

	function openDrawer(member: WorkspaceMember): void {
		const active = globalThis.document?.activeElement;
		opener.current = active instanceof HTMLElement && active !== globalThis.document.body
			? active
			: null;
		batch(() => {
			openMember.value = member;
			drawerSeq.value = drawerSeq.peek() + 1;
			drawerOpen.value = true;
		});
	}

	/** Say what the last thing did — the project roster's toast, at the bottom of the page. */
	function say(severity: "success" | "danger", summary: string): void {
		if (!globalThis.document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({ severity, summary, life: 4000 });
	}

	async function removeMember(member: WorkspaceMember): Promise<void> {
		busyId.value = member.id;
		const res = await WorkspaceService.updateMember({
			kind: ws.kind,
			workspaceId: ws.id,
			memberId: member.id,
			remove: true,
		});
		busyId.value = null;
		if (!res.ok) {
			say("danger", res.errors?.member ?? res.message ?? "Could not update that member.");
			return;
		}
		// `null` means the caller removed themselves — there is no console left for them to see.
		if (!res.data) {
			leaveConsole();
			return;
		}
		adopt(res.data);
		say("success", `${member.name} is no longer in ${ws.name}.`);
	}

	function onAction(action: MemberAction, member: WorkspaceMember): void {
		switch (action) {
			case "open":
				openDrawer(member);
				return;
			case "profile":
				globalThis.location.assign(memberProfileHref(member.handle));
				return;
			case "message":
				globalThis.location.assign(`/messages/dm-${member.handle}`);
				return;
			case "transfer":
				transferFor.value = member;
				return;
			case "leave":
				confirmLeave.value = true;
				return;
			case "remove":
				batch(() => {
					removing.value = member;
					confirmRemove.value = true;
				});
				return;
		}
	}

	/**
	 * Focus what opened the drawer — the element focused when it opened, else the member's table row (a
	 * menu item that opened it is gone by now).
	 */
	function refocusOpener(member: WorkspaceMember): void {
		const before = opener.current;
		if (before?.isConnected) {
			before.focus();
			return;
		}
		peopleRef.current?.querySelector<HTMLElement>(
			`.ui-dt__row[data-key="${CSS.escape(member.id)}"]`,
		)?.focus();
	}

	/**
	 * Open a dialog the drawer asked for once the drawer has left (Decision #123's hand-off): the drawer
	 * closed itself on the press, so wait for its panel to leave the DOM, park focus on its opener, then
	 * open — the dialog then hands focus back to that opener when it closes.
	 */
	function fromDrawer(member: WorkspaceMember, open: () => void): void {
		handoff.current?.();
		handoff.current = afterPanelLeaves({
			gone: () => !globalThis.document.querySelector(".wsp-mdrawer"),
			refocus: () => refocusOpener(member),
			then: () => {
				handoff.current = null;
				open();
			},
		});
	}

	/** A row's menu — only what the viewer may do on it. */
	function menuFor(member: WorkspaceMember) {
		return memberMenu(member, memberAbilities(actionInputFor(actor, member, caps)), onAction, {
			onCopied: (ok) => {
				if (ok) say("success", `Link to ${member.name}'s profile copied.`);
				else say("danger", "Could not copy the link.");
			},
		});
	}

	/**
	 * Approve (seat them, at the chosen role) or decline a request that arrived through the invite link
	 * (Decision #318). A refused approval — the seats, the manager cap, a team's freelancer-only rule —
	 * keeps the row with the server's sentence under it.
	 */
	async function onJoinRequest(
		request: WorkspaceJoinRequest,
		accept: boolean,
		roleId: string,
	): Promise<void> {
		busyId.value = request.id;
		const res = await WorkspaceService.respondJoinRequest({
			kind: ws.kind,
			workspaceId: ws.id,
			requestId: request.id,
			accept,
			roleId: accept ? roleId : undefined,
		});
		busyId.value = null;
		const who = request.name || `@${request.handle}`;
		if (!res.ok || !res.data) {
			const text = res.message ?? `Could not ${accept ? "approve" : "decline"} ${who}'s request.`;
			requestErrors.value = { ...requestErrors.value, [request.id]: text };
			return;
		}
		const { [request.id]: _gone, ...rest } = requestErrors.value;
		requestErrors.value = rest;
		adopt(res.data);
		say("success", accept ? `${who} joined ${ws.name}.` : `${who}'s request was declined.`);
	}

	async function onInviteAction(action: InviteAction, invite: WorkspaceInvite): Promise<void> {
		busyId.value = invite.id;
		const res = await WorkspaceService.inviteAction({
			kind: ws.kind,
			workspaceId: ws.id,
			inviteId: invite.id,
			action,
		});
		busyId.value = null;
		if (!res.ok || !res.data) {
			say(
				"danger",
				res.message ?? `Could not ${action === "revoke" ? "withdraw" : "resend"} that invitation.`,
			);
			return;
		}
		adopt(res.data);
		const who = invite.name || invite.email || `@${invite.handle}`;
		say(
			"success",
			action === "revoke"
				? `The invitation to ${who} was withdrawn.`
				: `The invitation to ${who} was sent again.`,
		);
	}

	/**
	 * Switch section in place — a queue's own `?view=`, or Members at the reading the reader left. On
	 * the dedicated `/invitations` address, Members is another module, so the tab goes there.
	 */
	function selectSection(next: MembersSection): void {
		const value = membersSectionView(next, peopleReading.peek());
		if (props.module !== "invitations") {
			selectModuleView(value, subViews);
			return;
		}
		if (next === "invitations") return;
		globalThis.location.assign(
			`${workspaceHref(ws.kind, ws.handle, "members")}${subViewSearch("", subViews, value)}`,
		);
	}
	// #endregion

	/** The open member as the latest detail holds them — gone when they left. */
	const drawerMember = openMember.value
		? ws.members.find((m) => m.id === openMember.value?.id) ?? null
		: null;

	/** The section bar's end: the seats line (and a business's manager headroom), then the faces. */
	const meta = (
		<span class="wsp-members__meta">
			<MetaLine
				as="span"
				size="sm"
				items={membersHeaderItems({
					seats: ws.seats,
					activeCount: active.length,
					invites: queue,
					seesQueue: canInvite,
					managers: ws.managers,
				})}
			/>
			<UserAvatarStack
				people={active.map((m) => ({ name: m.name, avatar: m.avatar || null }))}
				max={5}
				size="sm"
				aria-label={`${active.length} ${active.length === 1 ? "member" : "members"}: ${
					active.map((m) => m.name).join(", ")
				}`}
			/>
		</span>
	);

	return (
		<div class="wsp" data-kind={ws.kind}>
			<section
				class="mem-explorer wsp-members"
				data-reading={charted ? MEMBERS_CHART : undefined}
				aria-label={props.module === "invitations" ? "Invitations" : "Members"}
			>
				{/* #region The bar group — the project roster's section bar over its toolbar */}
				<div class="mem-bar wsp-members__bar" ref={barRef}>
					<MemberSectionBar
						sections={sections}
						active={section}
						onSelect={selectSection}
						openRequests={ws.joinRequests.length}
						panelId={PANEL_ID}
						meta={meta}
					/>
					{section === "members" && (
						<MemberToolbar
							query={search}
							placeholder="Search by name, handle or title…"
							roleFilter={roleFilter}
							showRoles={roleOptions.length > 1}
							roleOptions={roleOptions}
						/>
					)}
				</div>
				{/* #endregion */}

				{/* #region The body — a queue, the people, or the org chart canvas */}
				<div
					ref={peopleRef}
					class="fx-workspace mem-workspace wsp-members__body"
					id={PANEL_ID}
					role={tabs ? "tabpanel" : "region"}
					aria-labelledby={tabs ? `${PANEL_ID}-tab-${section}` : undefined}
					aria-label={tabs ? undefined : "Members"}
				>
					{section === "invitations"
						? (
							<InviteQueue
								invites={ws.invites}
								roles={ws.roles}
								canManage={canInvite}
								busyId={busyId.value}
								onAction={(a, i) => void onInviteAction(a, i)}
							/>
						)
						: section === "requests"
						? (
							<JoinRequestQueue
								requests={ws.joinRequests}
								roles={grantableRoles(ws.roles, ws.viewerCapabilities)}
								busyId={busyId.value}
								errors={requestErrors.value}
								onRespond={(r, accept, roleId) => void onJoinRequest(r, accept, roleId)}
							/>
						)
						: charted
						? (
							<OrgChart
								members={chartPeople}
								roles={ws.roles}
								matches={matches}
								onAction={onAction}
								overlayRef={barRef}
							/>
						)
						: people.length === 0
						? (
							<p class="wsp-people__empty">
								Nobody matches that. {canInvite && (
									<Button
										variant="link"
										label="Invite someone"
										onClick={() => openInvite()}
									/>
								)}
							</p>
						)
						: presentation === "cards"
						? (
							<Grid
								minChildWidth={`${peopleZoom.gridColWidth(peopleZoom.displayZoom.value)}px`}
								fit="exact"
								maxCols={4}
								gap="var(--space-4)"
							>
								{sortMembers(people, "role").map((m) => (
									<MemberCard
										key={m.id}
										member={m}
										kind={ws.kind}
										roles={ws.roles}
										facets={facetsById[m.id] ?? []}
										menu={menuFor(m)}
										showStake={stake}
										envelope={spendingFact(ws, m.id)}
										onOpen={() => openDrawer(m)}
										onMessage={() => onAction("message", m)}
									/>
								))}
							</Grid>
						)
						: (
							<MemberTable
								kind={ws.kind}
								members={people}
								roles={ws.roles}
								facetsById={facetsById}
								menuFor={menuFor}
								showStake={stake}
								showSpending={spending}
								envelopes={ws.spend?.limits}
								onOpen={openDrawer}
							/>
						)}
				</div>
				{/* #endregion */}
			</section>

			{/* Overlays — all BodyPortal-mounted by their own components (the glass-blur fixed trap). */}
			{drawerMember && (
				<MemberDrawer
					key={`${drawerMember.id}:${drawerSeq.value}`}
					workspace={ws}
					member={drawerMember}
					actor={actor}
					visible={drawerOpen}
					onUpdated={adopt}
					onTransfer={(m) => fromDrawer(m, () => (transferFor.value = m))}
					onLeave={(m) => fromDrawer(m, () => (confirmLeave.value = true))}
					onRemove={(m) => fromDrawer(m, () => onAction("remove", m))}
				/>
			)}

			{canInvite && <InviteModal workspace={ws} onUpdated={adopt} />}

			<ConfirmDialog
				visible={confirmLeave}
				header={`Leave ${ws.name}?`}
				message={`You will lose access to ${ws.name} straight away. Your work stays on record — nothing is deleted — and an admin can invite you back.`}
				acceptLabel={`Leave ${copy.noun}`}
				rejectLabel="Stay"
				acceptSeverity="danger"
				onAccept={() => {
					if (actor) void removeMember(actor);
				}}
			/>

			<ConfirmDialog
				visible={confirmRemove}
				header={`Remove ${removing.value?.name ?? "this member"}?`}
				message={`They lose access to ${ws.name} straight away. Their work stays on record — nothing is deleted — and you can invite them back.`}
				acceptLabel="Remove"
				rejectLabel="Keep them"
				acceptSeverity="danger"
				onAccept={() => {
					const member = removing.peek();
					if (member) void removeMember(member);
				}}
			/>

			{transferFor.value && (
				<OwnershipTransfer
					workspace={ws}
					leaving={transferFor.value}
					onClose={() => {
						transferFor.value = null;
					}}
					onTransferred={(next) => {
						transferFor.value = null;
						if (next) adopt(next);
						else leaveConsole();
					}}
				/>
			)}

			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</div>
	);
}

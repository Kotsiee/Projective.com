import type { JSX } from "preact";
import { batch, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Grid } from "@projective/ui/layout";
import { MetaLine } from "@projective/ui/display";
import { Button, InputText } from "@projective/ui/fields";
import { ConfirmDialog, InlineNotice } from "@projective/ui/feedback";
import {
	activeMembers,
	kindCopy,
	type PermissionFacet,
	permissionFacets,
	workspaceBase,
	type WorkspaceDetail,
	type WorkspaceInvite,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { UserAvatarStack } from "@web/components/UserAvatar.tsx";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { membersViewFor, openInvite, publishDetail, viewOr } from "../core/workspace-state.ts";
import { MEMBERS_QUEUE, SUB_VIEW_PANEL_ID, subViewLabel, subViewsFor } from "../core/sub-views.ts";
import { bandHasHubStrip } from "../core/hub-tabs.ts";
import { peopleZoom } from "../core/view-state.ts";
import { filterMembers, sortMembers } from "../core/workspace-model.ts";
import {
	actionInputFor,
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
import { MemberCard, SearchIcon } from "../components/MemberCard.tsx";
import { MemberTable } from "../components/MemberTable.tsx";
import { OrgChart } from "../components/OrgChart.tsx";
import { type InviteAction, InviteQueue } from "../components/InviteQueue.tsx";
import { OwnershipTransfer } from "../components/OwnershipTransfer.tsx";
import MemberDrawer from "./MemberDrawer.island.tsx";
import InviteModal from "./InviteModal.island.tsx";

/**
 * MembersScreen — the Members module (Teams work order C2): who is in the entity, what they may do,
 * how loaded they are, and the invitations waiting on an answer.
 *
 * **The head** is the section title, a MetaLine of the plan's seats (a business: its head-count and
 * its manager headroom against the plan, "1 of 2 managers") and the pending invitations (tabular),
 * and an `AvatarStack` of the active members (five faces, then a count).
 *
 * **The sub-views are the registry's** (`core/sub-views.ts`): People · Invitations · Org chart render
 * as the header band's view toolbar, and this island is the one region it controls. People is one dataset read
 * two ways on the People zoom — the `DataTable` (the default, Decision #224) or the card grid — and
 * the org chart is a third reading of the same people.
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

/** A line the screen says about the last thing that happened. */
interface ScreenNotice {
	tone: "error" | "info";
	text: string;
}

export default function MembersScreen(props: MembersScreenProps): JSX.Element {
	const detail = useSignal<WorkspaceDetail>(props.workspace);
	const search = useSignal("");
	const busyId = useSignal<string | null>(null);
	const notice = useSignal<ScreenNotice | null>(null);
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
	const showPending = view === MEMBERS_QUEUE || props.module === "invitations";
	/** The queue the viewer sees, split as the seat count splits it (lapsed ones hold no seat). */
	const queue = inviteCounts(ws.invites, Date.now());
	const presentation = membersViewFor(view);
	/**
	 * The header band's in-place tabs over this body — on the Members module only, and not where the
	 * band draws the Roster hub's link strip, which names no panel.
	 */
	const hubStrip = bandHasHubStrip({
		kind: ws.kind,
		handle: ws.handle,
		capabilities: caps,
		module: props.module ?? "members",
		view,
	});
	const subViews = props.module === "invitations" || hubStrip
		? []
		: subViewsFor("members", ws.kind, caps);
	const panel = subViews.length > 0
		? {
			id: SUB_VIEW_PANEL_ID,
			role: "region" as const,
			"aria-label": subViewLabel(subViews, view),
		}
		: {};

	const people = filterMembers(active, { search: search.value });

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

	async function removeMember(member: WorkspaceMember): Promise<void> {
		batch(() => {
			busyId.value = member.id;
			notice.value = null;
		});
		const res = await WorkspaceService.updateMember({
			kind: ws.kind,
			workspaceId: ws.id,
			memberId: member.id,
			remove: true,
		});
		busyId.value = null;
		if (!res.ok) {
			notice.value = {
				tone: "error",
				text: res.errors?.member ?? res.message ?? "Could not update that member.",
			};
			return;
		}
		// `null` means the caller removed themselves — there is no console left for them to see.
		if (!res.data) {
			leaveConsole();
			return;
		}
		adopt(res.data);
		notice.value = { tone: "info", text: `${member.name} is no longer in ${ws.name}.` };
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
				notice.value = ok
					? { tone: "info", text: `Link to ${member.name}'s profile copied.` }
					: { tone: "error", text: "Could not copy the link." };
			},
		});
	}

	async function onInviteAction(action: InviteAction, invite: WorkspaceInvite): Promise<void> {
		batch(() => {
			busyId.value = invite.id;
			notice.value = null;
		});
		const res = await WorkspaceService.inviteAction({
			kind: ws.kind,
			workspaceId: ws.id,
			inviteId: invite.id,
			action,
		});
		busyId.value = null;
		if (!res.ok || !res.data) {
			notice.value = {
				tone: "error",
				text: res.message ??
					`Could not ${action === "revoke" ? "withdraw" : "resend"} that invitation.`,
			};
			return;
		}
		adopt(res.data);
		const who = invite.name || invite.email || `@${invite.handle}`;
		notice.value = {
			tone: "info",
			text: action === "revoke"
				? `The invitation to ${who} was withdrawn.`
				: `The invitation to ${who} was sent again.`,
		};
	}
	// #endregion

	/** The open member as the latest detail holds them — gone when they left. */
	const drawerMember = openMember.value
		? ws.members.find((m) => m.id === openMember.value?.id) ?? null
		: null;

	return (
		<div class="wsp" data-kind={ws.kind}>
			<div class="wsp__stack" {...panel}>
				<section
					class="wsp-band wsp-band--head"
					data-i={0}
					aria-label={props.module === "invitations" ? "Invitations" : "Members"}
				>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<div class="wsp-mhead">
								<MetaLine
									items={membersHeaderItems({
										seats: ws.seats,
										activeCount: active.length,
										invites: queue,
										seesQueue: canInvite,
										managers: ws.managers,
									})}
								/>
							</div>
							<UserAvatarStack
								people={active.map((m) => ({ name: m.name, avatar: m.avatar || null }))}
								max={5}
								size="sm"
								aria-label={`${active.length} ${active.length === 1 ? "member" : "members"}: ${
									active.map((m) => m.name).join(", ")
								}`}
							/>
						</div>
					</div>
				</section>

				{notice.value && (
					<section class="wsp-band wsp-band--plain">
						<div class="wsp-band__inner">
							<InlineNotice
								align="start"
								assertive={notice.value.tone === "error"}
								text={notice.value.text}
							/>
						</div>
					</section>
				)}

				<section class="wsp-band wsp-band--page wsp-band--tail">
					<div class="wsp-band__inner">
						{showPending
							? (
								<InviteQueue
									invites={ws.invites}
									roles={ws.roles}
									canManage={canInvite}
									busyId={busyId.value}
									onAction={(a, i) => void onInviteAction(a, i)}
								/>
							)
							: presentation === "chart"
							? <OrgChart members={active} roles={ws.roles} onAction={onAction} />
							: (
								<div class="wsp-people">
									<div class="wsp-people__bar">
										<InputText
											class="wsp-people__search"
											value={search}
											placeholder={`Search ${copy.noun} members`}
											aria-label="Search members"
											start={<SearchIcon />}
											block
										/>
									</div>

									<div class="wsp-people__body" ref={peopleRef}>
										{people.length === 0
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
													minChildWidth={`${
														peopleZoom.gridColWidth(peopleZoom.displayZoom.value)
													}px`}
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
								</div>
							)}
					</div>
				</section>
			</div>

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
		</div>
	);
}

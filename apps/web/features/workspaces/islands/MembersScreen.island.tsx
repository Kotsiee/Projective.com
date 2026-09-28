import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Grid } from "@projective/ui/layout";
import { InputText } from "@projective/ui/fields";
import { ConfirmDialog, Message } from "@projective/ui/feedback";
import { styleVars } from "@ui/core/style.ts";
import {
	activeMembers,
	isLastOwner,
	kindCopy,
	mayManageMember,
	type PermissionFacet,
	permissionFacets,
	workspaceBase,
	type WorkspaceDetail,
	type WorkspaceInvite,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { membersView, openInvite, publishDetail } from "../core/workspace-state.ts";
import { gridColWidth, workspaceZoom, zoom } from "../core/view-state.ts";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import {
	filterMembers,
	MEMBER_SORTS,
	type MemberSort,
	sortMembers,
} from "../core/workspace-model.ts";
import {
	type MemberAction,
	MemberCard,
	type MemberGuards,
	SearchIcon,
} from "../components/MemberCard.tsx";
import { MemberTable } from "../components/MemberTable.tsx";
import { OrgChart } from "../components/OrgChart.tsx";
import { type InviteAction, InviteQueue } from "../components/InviteQueue.tsx";
import MemberDrawer from "./MemberDrawer.island.tsx";
import InviteModal from "./InviteModal.island.tsx";
import { OwnershipTransfer } from "../components/OwnershipTransfer.tsx";
import { cloneGlyph, MembersGlyph } from "../core/workspace-glyphs.tsx";

/**
 * MembersScreen — the roster, its three presentations, and the outgoing invitation queue.
 *
 * **The three views are one dataset seen three ways**, not three features: cards for scanning people,
 * a table for comparing them, an org chart for reading reporting lines. The switch lives in the footer
 * band (via the `membersView` signal) because it is chrome, so this island only reads it.
 *
 * **Permissions are presented, never recomputed.** `permissionFacets()` and `mayManageMember()` come
 * from the SSOT and the server's `viewerCapabilities` is the input — the roster row, the drawer, the
 * matrix and the database must give one answer.
 *
 * **A refused action always names a route forward.** The owner's standing changes only by transfer, so
 * their row offers the transfer (to them) instead of Remove; the viewer's own row offers Leave.
 *
 * Every mutation resolves to the re-read `WorkspaceDetail` and replaces the whole projection, so a
 * change the server clamped or refused cannot survive on screen as something the reader believes.
 */

export interface MembersScreenProps {
	workspace: WorkspaceDetail;
	/** The resolved `?view=` sub-view — `all` (the roster) or `pending` (the invitation queue). */
	view?: string | null;
	/** Which module routed here: `members` or the dedicated `invitations` module. */
	module?: "members" | "invitations";
}

export default function MembersScreen(props: MembersScreenProps): JSX.Element {
	const detail = useSignal<WorkspaceDetail>(props.workspace);
	const search = useSignal("");
	const sort = useSignal<MemberSort>("role");
	const selected = useSignal<ReadonlySet<string>>(new Set());
	const busyId = useSignal<string | null>(null);
	const notice = useSignal<string | null>(null);
	const info = useSignal<string | null>(null);
	/** The member whose drawer is open. */
	const openMember = useSignal<WorkspaceMember | null>(null);
	/** Set while the owner is handing the owner seat over. */
	const transferFor = useSignal<WorkspaceMember | null>(null);
	/** Open while the viewer confirms leaving the entity. */
	const confirmLeave = useSignal(false);
	const peopleRef = useRef<HTMLDivElement>(null);

	// `Ctrl`+wheel / pinch over the people collection scales it, the same gesture the roster and the
	// File Explorer answer. The org-chart override is off this axis, so the gesture never fights it.
	useCtrlWheelZoom(peopleRef, workspaceZoom);

	// `?invite=1` — the footer band and the lane on modules that do not mount the invite modal link here
	// with it, so their Invite control lands on the modal rather than on a page the reader must search.
	useEffect(() => {
		const url = new URL(globalThis.location.href);
		if (url.searchParams.get("invite") !== "1") return;
		url.searchParams.delete("invite");
		globalThis.history.replaceState(null, "", `${url.pathname}${url.search}`);
		if (detail.value.viewerCapabilities.includes("invite_members")) openInvite();
	}, []);

	const ws = detail.value;
	const copy = kindCopy(ws.kind);
	const held = new Set(ws.viewerCapabilities);
	const canManage = held.has("manage_roles");
	const canInvite = held.has("invite_members");

	/** The viewer's own row — the actor every guard is evaluated against. */
	const actor = useComputed(() =>
		ws.members.find((m) => m.id === ws.viewerMemberId) ?? ws.members.find((m) => m.isSelf) ?? null
	);

	const showPending = (props.view ?? "all") === "pending" || props.module === "invitations";

	const visible = useComputed(() => {
		const active = activeMembers(ws.members);
		return sortMembers(filterMembers(active, { search: search.value }), sort.value);
	});

	/** Per-member facets + guards, resolved once per render rather than per presentation. */
	const facetsById = useComputed<Record<string, readonly PermissionFacet[]>>(() => {
		const out: Record<string, readonly PermissionFacet[]> = {};
		for (const m of ws.members) {
			out[m.id] = permissionFacets(m, ws.kind, ws.roles, m.roleId);
		}
		return out;
	});

	const guardsById = useComputed<Record<string, MemberGuards>>(() => {
		const out: Record<string, MemberGuards> = {};
		const a = actor.value;
		for (const m of ws.members) {
			out[m.id] = {
				manageable: a ? mayManageMember(a, m, ws.kind) : false,
				lastOwner: isLastOwner(m, ws.members),
			};
		}
		return out;
	});

	/** Replace the whole projection from a server response, and republish it to the bands. */
	function adopt(next: WorkspaceDetail): void {
		detail.value = next;
		publishDetail(next);
		selected.value = new Set();
	}

	/** Leave the console for the roster — the viewer is no longer a member of this entity. */
	function leaveConsole(): void {
		globalThis.location.assign(workspaceBase(ws.kind));
	}

	async function removeMember(member: WorkspaceMember): Promise<void> {
		busyId.value = member.id;
		notice.value = null;
		info.value = null;
		const res = await WorkspaceService.updateMember({
			kind: ws.kind,
			workspaceId: ws.id,
			memberId: member.id,
			remove: true,
		});
		busyId.value = null;
		if (!res.ok) {
			notice.value = res.errors?.member ?? res.message ?? "Could not update that member.";
			return;
		}
		openMember.value = null;
		// `null` means the caller removed themselves — there is no console left for them to see.
		if (!res.data) {
			leaveConsole();
			return;
		}
		adopt(res.data);
		info.value = member.isSelf ? null : `${member.name} is no longer in ${ws.name}.`;
	}

	function onAction(action: MemberAction, member: WorkspaceMember): void {
		switch (action) {
			case "open":
				openMember.value = member;
				return;
			case "profile":
				globalThis.location.assign(`/@${member.handle}`);
				return;
			case "message":
				globalThis.location.assign(`/messages/dm-${member.handle}`);
				return;
			case "transfer":
				// Only the owner can hand the seat over; the menu offers it on their own row alone.
				if (member.isSelf) transferFor.value = member;
				return;
			case "leave":
				confirmLeave.value = true;
				return;
			case "remove":
				void removeMember(member);
				return;
		}
	}

	async function onInviteAction(action: InviteAction, invite: WorkspaceInvite): Promise<void> {
		busyId.value = invite.id;
		notice.value = null;
		info.value = null;
		const res = await WorkspaceService.inviteAction({
			kind: ws.kind,
			workspaceId: ws.id,
			inviteId: invite.id,
			action,
		});
		busyId.value = null;
		if (!res.ok || !res.data) {
			notice.value = res.message ??
				`Could not ${action === "revoke" ? "withdraw" : "resend"} that invitation.`;
			return;
		}
		adopt(res.data);
		const who = invite.name || invite.email || `@${invite.handle}`;
		info.value = action === "revoke"
			? `The invitation to ${who} was withdrawn.`
			: `The invitation to ${who} was sent again.`;
	}

	/** How many invitations are awaiting an answer. Empty unless the viewer may invite. */
	const pendingCount = ws.invites.length;

	return (
		<div class="wsp" data-kind={ws.kind}>
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" style={styleVars({ "--wsp-i": 0 })}>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title">{showPending ? "Invitations" : "Members"}</h1>
							<p class="wsp-pagehead__note">
								{showPending
									? `People invited to ${ws.name} who have not answered yet. Each invitation lasts 14 days; resending it starts a fresh window.`
									: `Everyone in ${ws.name}, what they may do, and how loaded they are.`}
							</p>
						</div>
					</div>
				</section>

				{(notice.value || info.value) && (
					<section class="wsp-band wsp-band--plain">
						<div class="wsp-band__inner">
							<div class="wsp-error">
								<Message
									class="wsp-error__alert"
									severity={notice.value ? "danger" : "success"}
									variant="subtle"
									text={notice.value ?? info.value ?? ""}
								/>
							</div>
						</div>
					</section>
				)}

				{showPending
					? (
						<section class="wsp-band wsp-band--page wsp-band--tail">
							<div class="wsp-band__inner">
								<InviteQueue
									invites={ws.invites}
									roles={ws.roles}
									canManage={canInvite}
									busyId={busyId.value}
									onAction={(a, i) => void onInviteAction(a, i)}
								/>
							</div>
						</section>
					)
					: (
						<section class="wsp-band wsp-band--page wsp-band--tail">
							<div class="wsp-band__inner">
								<div class="wsp-people">
									<div class="wsp-people__bar">
										<InputText
											class="wsp-people__search"
											value={search}
											onValueChange={(v) => {
												search.value = v;
											}}
											placeholder={`Search ${copy.noun} members`}
											aria-label="Search members"
											start={<SearchIcon />}
											block
										/>
										<span class="wsp-people__spacer" />
										<label class="wsp-people__count">
											<span class="wsp-idhead__metaitem">
												<span aria-hidden="true">{cloneGlyph(MembersGlyph)}</span>
												{visible.value.length} of {activeMembers(ws.members).length}
											</span>
										</label>
										<select
											class="wsp-select wsp-select--compact"
											aria-label="Sort members"
											value={sort.value}
											onChange={(e) => {
												sort.value = (e.target as HTMLSelectElement).value as MemberSort;
											}}
										>
											{MEMBER_SORTS.map((s) => (
												<option key={s.value} value={s.value}>{s.label}</option>
											))}
										</select>
									</div>

									{pendingCount > 0 && (
										<p class="wsp-people__group-head">
											<span class="wsp-people__group-title">
												{pendingCount === 1
													? "1 invitation awaiting an answer"
													: `${pendingCount} invitations awaiting an answer`}
											</span>
											<a class="wsp-band__action" href="?view=pending">Review</a>
										</p>
									)}

									<div class="wsp-people__body" ref={peopleRef}>
										{visible.value.length === 0
											? (
												<p class="wsp-pagehead__meta">
													Nobody matches that. {canInvite && (
														<button
															type="button"
															class="wsp-propose__link"
															onClick={() => openInvite()}
														>
															Invite someone
														</button>
													)}
												</p>
											)
											: membersView.value === "cards"
											? (
												<Grid
													minChildWidth={`${gridColWidth(zoom.value)}px`}
													maxCols={4}
													gap="var(--space-4)"
												>
													{visible.value.map((m) => (
														<MemberCard
															key={m.id}
															member={m}
															kind={ws.kind}
															roles={ws.roles}
															facets={facetsById.value[m.id] ?? []}
															guards={guardsById.value[m.id] ??
																{ manageable: false, lastOwner: false }}
															onAction={onAction}
														/>
													))}
												</Grid>
											)
											: membersView.value === "table"
											? (
												<MemberTable
													members={visible.value}
													roles={ws.roles}
													facetsById={facetsById.value}
													guardsById={guardsById.value}
													selected={selected.value}
													onSelect={(id, next) => {
														const s = new Set(selected.value);
														if (next) s.add(id);
														else s.delete(id);
														selected.value = s;
													}}
													onSelectAll={(next) => {
														selected.value = next
															? new Set(visible.value.map((m) => m.id))
															: new Set();
													}}
													onAction={onAction}
												/>
											)
											: (
												<OrgChart
													members={visible.value}
													roles={ws.roles}
													onAction={onAction}
												/>
											)}
									</div>
								</div>
							</div>
						</section>
					)}
			</div>

			{/* Overlays — all BodyPortal-mounted by their own components (the glass-blur fixed trap). */}
			{openMember.value && (
				<MemberDrawer
					workspace={ws}
					member={openMember.value}
					actor={actor.value}
					canManage={canManage}
					onClose={() => {
						openMember.value = null;
					}}
					onUpdated={adopt}
					onTransfer={(m) => {
						openMember.value = null;
						transferFor.value = m;
					}}
				/>
			)}

			<InviteModal workspace={ws} onUpdated={adopt} />

			<ConfirmDialog
				visible={confirmLeave}
				header={`Leave ${ws.name}?`}
				message={`You will lose access to ${ws.name} straight away. Your work stays on record — nothing is deleted — and an admin can invite you back.`}
				acceptLabel={`Leave ${copy.noun}`}
				rejectLabel="Stay"
				acceptSeverity="danger"
				onAccept={() => {
					const self = actor.value;
					if (self) void removeMember(self);
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

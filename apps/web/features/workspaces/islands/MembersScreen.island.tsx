import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import "../styles/workspace.css";
import { Grid } from "@projective/ui/layout";
import { InputText } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { styleVars } from "@ui/core/style.ts";
import {
	activeMembers,
	isLastOwner,
	kindCopy,
	mayManageMember,
	type PermissionFacet,
	permissionFacets,
	type WorkspaceDetail,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { membersView, openInvite, publishDetail } from "../core/workspace-state.ts";
import {
	filterMembers,
	MEMBER_SORTS,
	type MemberSort,
	partitionInvites,
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
import { type InviteAction, InviteQueue, type InviteView } from "../components/InviteQueue.tsx";
import MemberDrawer from "./MemberDrawer.island.tsx";
import InviteModal from "./InviteModal.island.tsx";
import { OwnershipTransfer } from "../components/OwnershipTransfer.tsx";
import { cloneGlyph, MembersGlyph } from "../core/workspace-glyphs.tsx";

/**
 * MembersScreen — the roster, its three presentations, and the pending queue.
 *
 * **The three views are one dataset seen three ways**, not three features: cards for scanning people,
 * a table for comparing them, an org chart for reading reporting lines. The switch lives in the footer
 * band (via the `membersView` signal) because it is chrome, so this island only reads it.
 *
 * **Permissions are presented, never recomputed.** `permissionFacets()` and `mayManageMember()` come
 * from the SSOT and the server's `viewerCapabilities` is the input — the whole reason the fat service
 * returns an effective set is that the roster row, the drawer, the matrix and the server guard must
 * give one answer. A second local implementation of `role ∪ granted − revoked` is how a permission UI
 * starts lying.
 *
 * **A refused action always names a route forward.** The last owner cannot be demoted or removed, so
 * that path opens an ownership TRANSFER rather than showing an error: the user's goal (leave, or hand
 * over) is legitimate, only their chosen mechanism was not.
 *
 * Every mutation resolves to a refreshed `WorkspaceDetail` and replaces the whole projection, so a
 * change the server clamped or refused cannot survive on screen as something the reader believes.
 */

export interface MembersScreenProps {
	workspace: WorkspaceDetail;
	/** The resolved `?view=` sub-view — `all` / `pending` / `roles` for members. */
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
	/** The member whose drawer is open. */
	const openMember = useSignal<WorkspaceMember | null>(null);
	/** The member whose removal/demotion needs an ownership transfer first. */
	const transferFor = useSignal<WorkspaceMember | null>(null);

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

	async function removeMember(member: WorkspaceMember): Promise<void> {
		busyId.value = member.id;
		notice.value = null;
		const res = await WorkspaceService.updateMember({
			workspaceId: ws.id,
			memberId: member.id,
			remove: true,
		});
		busyId.value = null;
		if (!res.ok || !res.data) {
			notice.value = res.message ?? "Could not update that member.";
			return;
		}
		adopt(res.data.workspace);
		openMember.value = null;
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
				transferFor.value = member;
				return;
			case "remove": {
				// The last owner is redirected into a transfer instead of refused — the goal is valid.
				if (guardsById.value[member.id]?.lastOwner) {
					transferFor.value = member;
					return;
				}
				void removeMember(member);
				return;
			}
		}
	}

	async function onInviteAction(action: InviteAction, invite: { id: string }): Promise<void> {
		busyId.value = invite.id;
		notice.value = null;
		// Approving a join request and revoking/declining an invitation are the same shape to the server:
		// a yes-or-no decision on one pending row. `resend` re-sends and is likewise a positive decision.
		const accept = action === "approve" || action === "resend";
		const res = await WorkspaceService.respondInvite(invite.id, accept);
		busyId.value = null;
		if (!res.ok) {
			notice.value = res.message ?? "Could not answer that invitation.";
			return;
		}
		// The response carries a roster, not a detail, so re-read the console projection for this entity.
		const fresh = await WorkspaceService.detail(ws.kind, ws.id);
		if (fresh.ok && fresh.data) adopt(fresh.data.workspace);
	}

	const invites = useComputed(() => partitionInvites(ws.invites));
	/** How many rows are awaiting somebody's decision, in either direction. */
	const pendingCount = useComputed(() => invites.value.sent.length + invites.value.requests.length);
	const inviteView: InviteView = showPending ? "requests" : "sent";

	return (
		<div class="wsp" data-kind={ws.kind}>
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" style={styleVars({ "--wsp-i": 0 })}>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title">
								{showPending ? "Invitations and requests" : "Members"}
							</h1>
							<p class="wsp-pagehead__note">
								{showPending
									? "People we have asked to join, and people asking to join us. Two different questions — the direction tells you which."
									: `Everyone in ${ws.name}, what they may do, and how loaded they are.`}
							</p>
						</div>
					</div>
				</section>

				{notice.value && (
					<section class="wsp-band wsp-band--plain">
						<div class="wsp-band__inner">
							<div class="wsp-error">
								<Message
									class="wsp-error__alert"
									severity="danger"
									variant="subtle"
									text={notice.value}
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
									view={inviteView}
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
											class="wsp-people__view"
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

									{pendingCount.value > 0 && (
										<p class="wsp-people__group-head">
											<span class="wsp-people__group-title">
												{pendingCount.value === 1
													? "1 person awaiting a decision"
													: `${pendingCount.value} people awaiting a decision`}
											</span>
											<a class="wsp-band__action" href="?view=pending">Review</a>
										</p>
									)}

									<div class="wsp-people__body">
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
												<Grid minChildWidth="17rem" maxCols={4} gap="var(--space-4)">
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

			{transferFor.value && (
				<OwnershipTransfer
					workspace={ws}
					leaving={transferFor.value}
					onClose={() => {
						transferFor.value = null;
					}}
					onTransferred={(next) => {
						transferFor.value = null;
						adopt(next);
					}}
				/>
			)}
		</div>
	);
}

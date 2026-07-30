import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import "../styles/workspace.css";
import { Drawer, Tooltip } from "@projective/ui/feedback";
import { Avatar } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import {
	CAPABILITY_LABEL,
	CONSEQUENTIAL,
	isLastOwner,
	kindCopy,
	mayGrant,
	mayManageMember,
	type PermissionFacet,
	permissionFacets,
	roleLabel,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { shortDate } from "../core/workspace-model.ts";
import { ConditionalIcon, LockIcon, TickIcon } from "../components/MemberCard.tsx";

/**
 * MemberDrawer — layer 3 of the permission model: this person's overrides on top of their role.
 *
 * **The drawer's one job is to make a difference legible.** A member's effective set is
 * `role ∪ granted − revoked`, and the failure mode of every permission UI is showing only the final
 * answer — a reader then cannot tell whether "may withdraw funds" comes from the role (so changing the
 * role removes it) or from an override on this person (so it does not). Every row therefore carries
 * BOTH the outcome and its provenance, marked `+` for a grant and `−` for a revocation against the
 * baseline, straight from the SSOT's `permissionFacets()`.
 *
 * **Consequential capabilities are surfaced, not buried.** Binding the entity to a seat, spending,
 * withdrawing and changing roles sit in their own group above the rest, because a list of eighteen
 * alphabetised checkboxes hides exactly the four that matter.
 *
 * **A refused change names a route forward.** Demoting or removing the last owner opens an ownership
 * transfer instead of erroring: the intent is legitimate, only the mechanism was not. And a capability
 * the ACTOR does not themselves hold is shown disabled with the reason in its tooltip
 * (`mayGrant`) — a permission surface must never be a privilege-escalation ladder.
 */

export interface MemberDrawerProps {
	workspace: WorkspaceDetail;
	member: WorkspaceMember;
	/** The viewer's own member row — every guard is evaluated against it. */
	actor: WorkspaceMember | null;
	canManage: boolean;
	onClose: () => void;
	onUpdated: (next: WorkspaceDetail) => void;
	/** Route the last owner into an ownership transfer rather than a dead-end refusal. */
	onTransfer: (member: WorkspaceMember) => void;
}

export default function MemberDrawer(props: MemberDrawerProps): JSX.Element {
	const { workspace: ws, member, actor } = props;
	const copy = kindCopy(ws.kind);

	/** Pending role change, or `null` while the member's saved role stands. */
	const draftRoleId = useSignal<string | null>(null);
	/** Pending override edits, keyed by capability: `true` grant, `false` revoke, absent = baseline. */
	const draftOverrides = useSignal<Record<string, boolean | undefined>>({});
	const saving = useSignal(false);
	const error = useSignal<string | null>(null);

	const effectiveRoleId = useComputed(() => draftRoleId.value ?? member.roleId);

	/**
	 * Facets recomputed against the DRAFT, so the list previews what saving would do rather than what
	 * the server currently thinks. The preview and the save read the same SSOT function.
	 */
	const facets = useComputed<readonly PermissionFacet[]>(() => {
		const granted = new Set(member.overrides.granted);
		const revoked = new Set(member.overrides.revoked);
		for (const [cap, state] of Object.entries(draftOverrides.value)) {
			const c = cap as WorkspaceCapability;
			granted.delete(c);
			revoked.delete(c);
			if (state === true) granted.add(c);
			else if (state === false) revoked.add(c);
		}
		return permissionFacets(
			{
				rolePreset: member.rolePreset,
				overrides: { granted: [...granted], revoked: [...revoked] },
			},
			ws.kind,
			ws.roles,
			effectiveRoleId.value,
		);
	});

	const manageable = actor ? mayManageMember(actor, member, ws.kind) : false;
	const lastOwner = isLastOwner(member, ws.members);
	const dirty = useComputed(() =>
		draftRoleId.value !== null || Object.keys(draftOverrides.value).length > 0
	);

	/** Toggle one capability between baseline, granted and revoked. */
	function cycle(facet: PermissionFacet): void {
		if (!props.canManage || !manageable) return;
		if (!actor || !mayGrant(actor, facet.capability, ws.kind)) return;

		const next = { ...draftOverrides.value };
		const current = next[facet.capability];
		// Cycle relative to the ROLE baseline, so "clear the override" is always reachable in one step.
		if (current === undefined) next[facet.capability] = !facet.fromRole;
		else if (current === !facet.fromRole) next[facet.capability] = facet.fromRole;
		else delete next[facet.capability];
		draftOverrides.value = next;
		error.value = null;
	}

	async function save(): Promise<void> {
		if (!dirty.value) return;
		saving.value = true;
		error.value = null;

		const granted: WorkspaceCapability[] = [];
		const revoked: WorkspaceCapability[] = [];
		for (const f of facets.value) {
			if (f.override === "grant") granted.push(f.capability);
			if (f.override === "revoke") revoked.push(f.capability);
		}

		const res = await WorkspaceService.updateMember({
			workspaceId: ws.id,
			memberId: member.id,
			roleId: draftRoleId.value ?? undefined,
			granted,
			revoked,
		});
		saving.value = false;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "Could not save those permissions.";
			return;
		}
		draftRoleId.value = null;
		draftOverrides.value = {};
		props.onUpdated(res.data.workspace);
		props.onClose();
	}

	/** Split the list so the four that matter are not buried among the eighteen that do not. */
	const consequential = useComputed(() =>
		facets.value.filter((f) => CONSEQUENTIAL.includes(f.capability))
	);
	const ordinary = useComputed(() =>
		facets.value.filter((f) => !CONSEQUENTIAL.includes(f.capability))
	);

	/** One permission row. */
	function Row(facet: PermissionFacet): JSX.Element {
		const blocked = !actor || !mayGrant(actor, facet.capability, ws.kind);
		const editable = props.canManage && manageable && !blocked;
		const reason = blocked
			? "You cannot grant a permission you do not hold yourself."
			: !manageable
			? "You need a higher role than theirs to change this."
			: facet.override === "grant"
			? "Granted to this person on top of their role."
			: facet.override === "revoke"
			? "Revoked from this person, against their role."
			: facet.fromRole
			? `Comes from the ${roleLabel(member.rolePreset)} role.`
			: "Not granted by their role.";

		return (
			<li class="wsp-mdrawer__perm" key={facet.capability}>
				<Tooltip content={reason} placement="left">
					<button
						type="button"
						class="wsp-mdrawer__perm-mark"
						data-state={facet.effective ? "allowed" : "denied"}
						aria-pressed={facet.effective}
						aria-label={`${CAPABILITY_LABEL[facet.capability]} — ${
							facet.effective ? "allowed" : "not allowed"
						}`}
						disabled={!editable}
						onClick={() => cycle(facet)}
					>
						{facet.effective ? <TickIcon /> : editable ? <ConditionalIcon /> : <LockIcon />}
					</button>
				</Tooltip>
				<span class="wsp-mdrawer__perm-label">{CAPABILITY_LABEL[facet.capability]}</span>
				{facet.override && (
					<Tooltip
						content={facet.override === "grant"
							? "Granted on top of their role"
							: "Revoked from their role"}
						placement="left"
					>
						<span class="wsp-mdrawer__perm-ovr" data-sign={facet.override}>
							<span class="wsp-override__sign" aria-hidden="true">
								{facet.override === "grant" ? "+" : "−"}
							</span>
							<span class="wsp-mdrawer__perm-flag">
								{facet.override === "grant" ? "granted" : "revoked"}
							</span>
						</span>
					</Tooltip>
				)}
			</li>
		);
	}

	return (
		<Drawer
			visible
			position="right"
			class="wsp-mdrawer"
			header={member.name}
			onVisibleChange={(open) => {
				if (!open) props.onClose();
			}}
		>
			<div class="wsp-mdrawer__head">
				<Avatar
					class="wsp-mdrawer__avatar"
					image={member.avatar}
					alt=""
					label={member.name}
					shape="circle"
					size="lg"
				/>
				<div class="wsp-mdrawer__ident">
					<p class="wsp-mdrawer__name">{member.name}</p>
					<a class="wsp-mdrawer__handle" href={`/@${member.handle}`}>@{member.handle}</a>
					<p class="wsp-mdrawer__meta">
						{member.title ? `${member.title} · ` : ""}
						Joined {shortDate(member.joinedAt)}
					</p>
				</div>
			</div>

			{/* #region Role (layers 1–2) */}
			<section class="wsp-mdrawer__section">
				<h3 class="wsp-mdrawer__section-title">Role</h3>
				<p class="wsp-mdrawer__section-note">
					A role is a named bundle of permissions. Changing it moves every permission that came from
					it — the overrides below stay.
				</p>
				<select
					class="wsp-people__view"
					aria-label="Role"
					disabled={!props.canManage || !manageable}
					value={effectiveRoleId.value}
					onChange={(e) => {
						draftRoleId.value = (e.target as HTMLSelectElement).value;
						error.value = null;
					}}
				>
					{ws.roles.map((r) => (
						<option key={r.id} value={r.id}>
							{r.name}
							{r.preset ? "" : " (custom)"}
						</option>
					))}
				</select>
			</section>
			{/* #endregion */}

			{/* #region Overrides (layer 3) */}
			<section class="wsp-mdrawer__section">
				<h3 class="wsp-mdrawer__section-title">What they may do here</h3>
				<p class="wsp-mdrawer__section-note">
					Their effective permissions. A <span class="wsp-override__sign">+</span> or{" "}
					<span class="wsp-override__sign">−</span> marks where this person differs from their role.
				</p>

				<h4 class="wsp-mdrawer__section-title">Consequential</h4>
				<ul class="wsp-mdrawer__perms">{consequential.value.map(Row)}</ul>

				<h4 class="wsp-mdrawer__section-title">Everything else</h4>
				<ul class="wsp-mdrawer__perms">{ordinary.value.map(Row)}</ul>
			</section>
			{/* #endregion */}

			{ws.kind === "business" && member.spendLimitMinor !== null && (
				<section class="wsp-mdrawer__section">
					<h3 class="wsp-mdrawer__section-title">Spend envelope</h3>
					<p class="wsp-mdrawer__limit">
						Their ceiling and contributions are edited on the spend policy, where they sit beside
						everyone else's — a limit only means something relative to the others.
					</p>
				</section>
			)}

			{/* #region Terminal actions */}
			<section class="wsp-mdrawer__section wsp-mdrawer__danger">
				{lastOwner
					? (
						<p class="wsp-mdrawer__lastowner">
							<span class="wsp-mdrawer__lastowner-text">
								They are the last owner of this{" "}
								{copy.noun}. Ownership has to go somewhere before they can leave.
							</span>
							<button
								type="button"
								class="wsp-mdrawer__lastowner-link"
								onClick={() => props.onTransfer(member)}
							>
								Transfer ownership…
							</button>
						</p>
					)
					: (
						<p class="wsp-mdrawer__danger-text">
							Removing somebody keeps the record of their work — nothing is deleted.
						</p>
					)}
			</section>
			{/* #endregion */}

			{error.value && <p class="wsp-create__error" role="alert">{error.value}</p>}

			<div class="wsp-mdrawer__actions">
				<Button variant="text" label="Close" onClick={props.onClose} />
				<Button
					variant="filled"
					label={saving.value ? "Saving…" : "Save permissions"}
					disabled={!dirty.value || saving.value}
					onClick={save}
				/>
			</div>
		</Drawer>
	);
}

import type { JSX } from "preact";
import {
	batch,
	type Signal,
	signal,
	useComputed,
	useSignal,
	useSignalEffect,
} from "@preact/signals";
import { useMemo } from "preact/hooks";
import "../styles/workspace.css";
import { MetaLine } from "@projective/ui/display";
import { Drawer, InlineNotice } from "@projective/ui/feedback";
import { Button, FormControl, InputText, Select, ToggleSwitch } from "@projective/ui/fields";
import {
	capabilitiesForKind,
	kindCopy,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { shortDate } from "../core/workspace-model.ts";
import {
	actionInputFor,
	assignableRoles,
	draftFacets,
	drawerFooter,
	drawerTerminal,
	managerOptions,
	memberAbilities,
	type MemberDraft,
	memberDraftOf,
	memberPatch,
	membersTierProps,
	NOBODY,
	type OverrideDraft,
	permissionGroups,
	type PermissionRow,
	roleName,
	roleOptions,
	roleText,
	showsStake,
	stakePercent,
	toggleCapability,
	workloadText,
} from "../core/members-model.ts";
import { ConsequenceIcon, PersonAvatar } from "../components/MemberCard.tsx";

/**
 * MemberDrawer — one person's place in the entity: their role, their title and reporting line, and
 * layer 3 of the permission model — their overrides on top of the role.
 *
 * **The drawer makes a difference legible.** A member's effective set is `role ∪ granted − revoked`;
 * every capability row says where its state comes from (the role, or an override on this person),
 * straight from the SSOT's `permissionFacets()` over the DRAFT, so the list previews what saving does.
 *
 * **Fields are `@projective/ui` controls in `FormControl`s** (§A.7): Role and Reports to are `Select`s,
 * Title an `InputText`, and each capability a labelled `ToggleSwitch`, grouped by the shared capability
 * groups, a sensitive one carrying its consequence as a Meta warning. Save is tier 3, Close tier 5.
 *
 * **Absent, not disabled** (the rank rule, `core/members-model.ts`): a viewer who may not change this
 * person sees their role and permissions as text — no dead picker, no greyed switch — and a switch the
 * viewer may not flip (they lack the capability, or it is an owner-reserved right) is drawn as text
 * too. The owner's row never offers Leave or Remove: to the owner it offers "Transfer ownership" as a
 * tier-5 link; anybody else's own row offers Leave, and a row the viewer outranks offers Remove — each
 * confirmed in its own dialog by the screen.
 *
 * Controlled by the screen through `visible`, so Escape and Close animate it out and the ui focus trap
 * returns focus to the table row (or card) that opened it.
 */

export interface MemberDrawerProps {
	workspace: WorkspaceDetail;
	member: WorkspaceMember;
	/** The viewer's own member row — the rank rule is evaluated against it. */
	actor: WorkspaceMember | null;
	/** Whether the drawer is open; the screen owns it. */
	visible: Signal<boolean>;
	onUpdated: (next: WorkspaceDetail) => void;
	/** Open the ownership transfer — the owner's way to step back. */
	onTransfer: (member: WorkspaceMember) => void;
	/** Ask to leave — the viewer's own row. */
	onLeave: (member: WorkspaceMember) => void;
	/** Ask to remove this member. */
	onRemove: (member: WorkspaceMember) => void;
}

export default function MemberDrawer(props: MemberDrawerProps): JSX.Element {
	const { workspace: ws, member, actor } = props;
	const copy = kindCopy(ws.kind);
	const caps = ws.viewerCapabilities;
	const abilities = memberAbilities(actionInputFor(actor, member, caps));
	const editable = abilities.edit;
	const viewerIsOwner = actor?.rolePreset === "owner";

	// #region Draft
	const start = memberDraftOf(member);
	const roleId = useSignal(start.roleId);
	const overrides = useSignal<OverrideDraft>(start.overrides);
	const title = useSignal(start.title);
	/** The Reports to picker's value — `NOBODY` stands for the top of the chart. */
	const reports = useSignal(start.reportsTo === "" ? NOBODY : start.reportsTo);
	const saving = useSignal(false);
	const error = useSignal<string | null>(null);

	const draft = useComputed<MemberDraft>(() => ({
		roleId: roleId.value,
		overrides: overrides.value,
		title: title.value,
		reportsTo: reports.value === NOBODY ? "" : reports.value,
	}));
	const patch = useComputed(() => memberPatch(member, draft.value));
	const facets = useComputed(() =>
		draftFacets(member, ws.kind, ws.roles, roleId.value, overrides.value)
	);
	const role = roleName({ roleId: roleId.value, rolePreset: member.rolePreset }, ws.roles);
	const groups = permissionGroups(
		facets.value,
		{ kind: ws.kind, editable, viewerCaps: caps, viewerIsOwner },
		role,
	);

	/**
	 * One writable signal per capability switch, kept in step with the draft's facets. A switch must be
	 * CONTROLLED (a role change flips the ones that came from the role), and a computed cannot be written
	 * by the control, so the drawer holds the signals and mirrors the facets into them.
	 */
	const switches = useMemo(() => {
		const on = new Set(facets.peek().filter((f) => f.effective).map((f) => f.capability));
		return new Map<WorkspaceCapability, Signal<boolean>>(
			capabilitiesForKind(ws.kind).map((c) => [c, signal(on.has(c))]),
		);
	}, []);
	useSignalEffect(() => {
		for (const f of facets.value) {
			const s = switches.get(f.capability);
			if (s && s.peek() !== f.effective) s.value = f.effective;
		}
	});
	// #endregion

	// #region Handlers
	function flip(row: PermissionRow, on: boolean): void {
		const facet = facets.peek().find((f) => f.capability === row.capability);
		if (!facet || !row.toggleable) return;
		batch(() => {
			overrides.value = toggleCapability(overrides.peek(), facet, on);
			error.value = null;
		});
	}

	function close(): void {
		props.visible.value = false;
	}

	async function save(): Promise<void> {
		const changes = patch.peek();
		if (!changes || saving.peek()) return;
		batch(() => {
			saving.value = true;
			error.value = null;
		});
		const res = await WorkspaceService.updateMember({
			kind: ws.kind,
			workspaceId: ws.id,
			memberId: member.id,
			...changes,
		});
		saving.value = false;
		if (!res.ok || !res.data) {
			error.value = res.errors?.title ?? res.errors?.reportsTo ?? res.errors?.roleId ??
				res.errors?.granted ?? res.errors?.revoked ?? res.errors?.confirm ?? res.message ??
				"Could not save those changes.";
			return;
		}
		props.onUpdated(res.data);
		close();
	}

	/**
	 * Close, then ask the screen for the act's dialog. The screen opens it only once this panel has left
	 * (`core/overlay-handoff.ts`), so the dialog never records a button that is about to vanish.
	 */
	function terminalAct(key: "transfer" | "leave" | "remove"): void {
		close();
		if (key === "transfer") props.onTransfer(member);
		else if (key === "leave") props.onLeave(member);
		else props.onRemove(member);
	}
	// #endregion

	const footer = drawerFooter({
		editable,
		dirty: patch.value !== null,
		saving: saving.value,
	});
	const terminal = drawerTerminal(abilities, member, ws.kind);
	const managers = managerOptions(ws.members, member);
	const manager = ws.members.find((m) => m.id === member.reportsTo) ?? null;

	return (
		<Drawer
			visible={props.visible}
			position="right"
			class="wsp-mdrawer"
			header={member.name}
			footer={
				<div class="wsp-dialog__actions">
					{footer.map((action) => (
						<Button
							key={action.key}
							{...membersTierProps(action.tier, action.danger)}
							label={action.label}
							disabled={action.disabled}
							loading={action.busy}
							onClick={action.key === "save" ? () => void save() : close}
						/>
					))}
				</div>
			}
		>
			<div class="wsp-mdrawer__head">
				<PersonAvatar member={member} size="lg" />
				<div class="wsp-mdrawer__ident">
					<MetaLine items={[`@${member.handle}`, member.isSelf && "You", member.title]} />
					<MetaLine
						size="xs"
						items={[
							{ text: `Joined ${shortDate(member.joinedAt)}`, tabular: true },
							{ text: `Workload ${workloadText(member)}`, tabular: true },
							showsStake(ws.kind, caps) &&
							{ text: `Stake ${stakePercent(member.shareBp)}`, tabular: true },
						]}
					/>
				</div>
			</div>

			{/* #region Role and place */}
			<section class="wsp-mdrawer__section" aria-labelledby={`wsp-mdrawer-role-${member.id}`}>
				<h3 class="wsp-mdrawer__section-title" id={`wsp-mdrawer-role-${member.id}`}>
					Role and place
				</h3>
				{editable
					? (
						<>
							<FormControl
								class="wsp-mdrawer__field"
								label="Role"
								hint="Changing it moves every permission that came from it — the overrides below stay."
							>
								{({ id, describedBy }) => (
									<Select
										id={id}
										aria-describedby={describedBy}
										options={roleOptions(assignableRoles(ws.roles, caps, member.roleId))}
										value={roleId}
										onValueChange={() => (error.value = null)}
										fluid
									/>
								)}
							</FormControl>
							<FormControl
								class="wsp-mdrawer__field"
								label="Title"
								hint="What they do here — shown on the org chart."
							>
								{({ id, describedBy }) => (
									<InputText
										id={id}
										aria-describedby={describedBy}
										value={title}
										onValueChange={() => (error.value = null)}
										placeholder="Design lead"
										maxLength={80}
										block
									/>
								)}
							</FormControl>
							<FormControl
								class="wsp-mdrawer__field"
								label="Reports to"
								hint="The edge the org chart draws. A loop is refused."
							>
								{({ id, describedBy }) => (
									<Select
										id={id}
										aria-describedby={describedBy}
										options={managers}
										value={reports}
										onValueChange={() => (error.value = null)}
										filter={managers.length > 8}
										fluid
									/>
								)}
							</FormControl>
						</>
					)
					: (
						<dl class="wsp-mdrawer__facts">
							<dt class="wsp-mdrawer__fact-label">Role</dt>
							<dd class="wsp-mdrawer__fact-value">{roleText(member, ws.roles)}</dd>
							<dt class="wsp-mdrawer__fact-label">Reports to</dt>
							<dd class="wsp-mdrawer__fact-value">
								{manager ? manager.name : "Nobody — top of the chart"}
							</dd>
						</dl>
					)}
			</section>
			{/* #endregion */}

			{/* #region Permissions (layer 3) */}
			<section class="wsp-mdrawer__section" aria-labelledby={`wsp-mdrawer-perms-${member.id}`}>
				<h3 class="wsp-mdrawer__section-title" id={`wsp-mdrawer-perms-${member.id}`}>
					What they may do here
				</h3>
				<p class="wsp-mdrawer__section-note">
					{editable
						? "Each switch shows where its state comes from — the role, or an override on this person."
						: "Their effective permissions, and where each comes from."}
				</p>
				{groups.map((group) => (
					<div
						key={group.title}
						class="wsp-mdrawer__group"
						role="group"
						aria-labelledby={`wsp-mdrawer-${member.id}-${group.title}`}
					>
						<h4 class="wsp-mdrawer__group-title" id={`wsp-mdrawer-${member.id}-${group.title}`}>
							{group.title}
						</h4>
						<ul class="wsp-mdrawer__perms">
							{group.rows.map((row) => {
								const noteId = `wsp-mdrawer-${member.id}-${row.capability}`;
								return (
									<li
										key={row.capability}
										class="wsp-mdrawer__perm"
										data-on={row.on ? "true" : "false"}
									>
										{row.toggleable
											? (
												<ToggleSwitch
													value={switches.get(row.capability)}
													onValueChange={(on) => flip(row, on)}
													label={row.label}
													aria-describedby={noteId}
												/>
											)
											: (
												<span class="wsp-mdrawer__perm-label">
													{row.label}
												</span>
											)}
										<span id={noteId} class="wsp-mdrawer__perm-note">
											<MetaLine
												as="span"
												size="xs"
												items={[
													!row.toggleable && (row.on ? "Allowed" : "Not allowed"),
													row.provenance,
												]}
											/>
											{row.warning && (
												<span class="wsp-mdrawer__warning">
													<span class="wsp-mdrawer__warning-mark" aria-hidden="true">
														<ConsequenceIcon />
													</span>
													{row.warning}
												</span>
											)}
										</span>
									</li>
								);
							})}
						</ul>
					</div>
				))}
			</section>
			{/* #endregion */}

			{ws.kind === "business" && member.spendLimitMinor !== null && (
				<section class="wsp-mdrawer__section">
					<h3 class="wsp-mdrawer__section-title">Spend envelope</h3>
					<p class="wsp-mdrawer__section-note">
						Their ceiling and contributions are edited on the spend policy, beside everyone else's —
						a limit only means something relative to the others.
					</p>
				</section>
			)}

			{/* #region Terminal act */}
			{terminal && (
				<section class="wsp-mdrawer__section wsp-mdrawer__terminal">
					<p class="wsp-mdrawer__section-note">{terminal.note}</p>
					<Button
						{...membersTierProps(terminal.tier, terminal.danger)}
						class="wsp-mdrawer__terminal-act"
						label={terminal.label}
						onClick={() => terminalAct(terminal.key)}
					/>
				</section>
			)}
			{!terminal && member.rolePreset === "owner" && !member.isSelf && (
				<p class="wsp-mdrawer__section-note">
					{member.name} owns this {copy.noun}. Ownership changes only when they hand it over.
				</p>
			)}
			{/* #endregion */}

			{error.value && <InlineNotice assertive align="start" text={error.value} />}
		</Drawer>
	);
}

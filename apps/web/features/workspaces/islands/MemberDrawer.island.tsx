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
import { Icon } from "@projective/ui/icons";
import {
	capabilitiesForKind,
	kindCopy,
	RESERVED_GRANT_CONFIRMATION,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { shortDate } from "../core/workspace-model.ts";
import {
	actionInputFor,
	assignableRoles,
	becomesCoOwner,
	changeAddsManager,
	confirmAnswered,
	confirmLabel,
	draftFacets,
	draftRankOf,
	drawerFooter,
	drawerTerminal,
	envelopeSection,
	managerCapContextOf,
	managerCapNotice,
	managerOptions,
	managersFull,
	memberAbilities,
	type MemberDraft,
	memberDraftOf,
	memberPatch,
	memberSaveRefusal,
	membersTierProps,
	NOBODY,
	type OverrideDraft,
	overridesAtRank,
	permissionGroups,
	type PermissionRow,
	reservedAdded,
	reservedGrantWarning,
	roleName,
	roleOptions,
	roleText,
	showsStake,
	stakePercent,
	TITLE_EXAMPLE,
	toggleCapability,
	workloadText,
} from "../core/members-model.ts";
import { ConsequenceIcon, PersonAvatar } from "../components/MemberCard.tsx";
import { ManagerCapNotice } from "../components/ManagerCapNotice.tsx";

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
 * **A business's specifics** (BU7, Decision #249): the member's spend envelope — its MetaLine and a
 * tier-5 "Edit in Spend" link to their row on the Spend module for the policy's editors, read-only for
 * anyone else who reads every envelope (`envelopeSection`); the manager cap said before Save when the
 * change would make them a manager past the plan (`changeAddsManager` · `managersFull`); and, when the
 * owner's draft grants an owner-reserved right, the warning and a typed CONFIRM field the save sends
 * (`reservedAdded`, `org.fn_assert_reserved_change`). No Workload on a business, and the Title example
 * is never "lead".
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
	/** The typed answer to a reserved grant's warning — owed only while the draft grants one. */
	const confirmText = useSignal("");

	/** The rank the draft role gives them — a business's billing right lives only on an admin seat. */
	const rank = useComputed(() => draftRankOf(member, ws.roles, roleId.value));
	/** The overrides the draft can hold at that rank (`overridesAtRank`). */
	const fitted = useComputed(() => overridesAtRank(ws.kind, overrides.value, rank.value));
	const draft = useComputed<MemberDraft>(() => ({
		roleId: roleId.value,
		overrides: fitted.value,
		title: title.value,
		reportsTo: reports.value === NOBODY ? "" : reports.value,
	}));
	const patch = useComputed(() => memberPatch(member, draft.value));
	/** The member as saved — what the reserved grant and the manager cap are measured from. */
	const savedFacets = useMemo(
		() => draftFacets(member, ws.kind, ws.roles, member.roleId, member.overrides),
		[],
	);
	const facets = useComputed(() =>
		draftFacets(member, ws.kind, ws.roles, roleId.value, fitted.value)
	);
	const role = roleName({ roleId: roleId.value, rolePreset: member.rolePreset }, ws.roles);
	const groups = permissionGroups(
		facets.value,
		{ kind: ws.kind, editable, viewerCaps: caps, viewerIsOwner, draftRank: rank.value },
		role,
	);

	// #region Business: the reserved grant, the manager cap, the envelope (BU7)
	const added = editable ? reservedAdded(ws.kind, savedFacets, facets.value) : [];
	const warning = reservedGrantWarning(
		member.name,
		added,
		becomesCoOwner(ws.kind, rank.value, facets.value),
	);
	const confirmOwed = added.length > 0;
	const confirmed = !confirmOwed || confirmAnswered(confirmText.value);
	const overCap = editable && managersFull(ws.managers) && changeAddsManager({
		kind: ws.kind,
		member,
		saved: savedFacets,
		draftRank: rank.value,
		draft: facets.value,
	});
	const capContext = managerCapContextOf(ws);
	/** Said beside its cause: under Role when the role change passes the cap, else before Save. */
	const capByRole = overCap && roleId.value !== member.roleId;
	const envelope = envelopeSection(ws, member);
	// #endregion

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
		if (!changes || saving.peek() || !confirmed || overCap) return;
		batch(() => {
			saving.value = true;
			error.value = null;
		});
		const res = await WorkspaceService.updateMember({
			kind: ws.kind,
			workspaceId: ws.id,
			memberId: member.id,
			...changes,
			...(confirmOwed ? { confirm: RESERVED_GRANT_CONFIRMATION } : {}),
		});
		saving.value = false;
		if (!res.ok || !res.data) {
			error.value = memberSaveRefusal(res, capContext);
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
		blocked: !confirmed || overCap,
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
							ws.kind === "team" &&
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
							{capByRole && <ManagerCapNotice notice={managerCapNotice(capContext)} />}
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
										placeholder={TITLE_EXAMPLE[ws.kind]}
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

			{/* #region Before Save: a reserved grant's confirmation, the manager cap (business) */}
			{(warning || (overCap && !capByRole)) && (
				<section
					class="wsp-mdrawer__section"
					aria-labelledby={`wsp-mdrawer-confirm-${member.id}`}
				>
					<h3 class="wsp-mdrawer__section-title" id={`wsp-mdrawer-confirm-${member.id}`}>
						Before you save
					</h3>
					{overCap && !capByRole && <ManagerCapNotice notice={managerCapNotice(capContext)} />}
					{warning && (
						<>
							<InlineNotice align="start" icon={<Icon name="warning" />} text={warning} />
							<FormControl
								class="wsp-mdrawer__field"
								label={confirmLabel(added)}
								hint={`The word ${RESERVED_GRANT_CONFIRMATION}, in capitals. Taking a right away needs no confirmation.`}
							>
								{({ id, describedBy }) => (
									<InputText
										id={id}
										aria-describedby={describedBy}
										value={confirmText}
										onValueChange={() => (error.value = null)}
										placeholder={RESERVED_GRANT_CONFIRMATION}
										maxLength={16}
										autoCapitalize="characters"
										autoComplete="off"
										spellcheck={false}
										block
									/>
								)}
							</FormControl>
						</>
					)}
				</section>
			)}
			{/* #endregion */}

			{/* #region Spend envelope (business) */}
			{envelope && (
				<section
					class="wsp-mdrawer__section wsp-mdrawer__envelope"
					aria-labelledby={`wsp-mdrawer-envelope-${member.id}`}
				>
					<h3 class="wsp-mdrawer__section-title" id={`wsp-mdrawer-envelope-${member.id}`}>
						Spend envelope
					</h3>
					<MetaLine items={envelope.facts} />
					<p class="wsp-mdrawer__section-note">{envelope.note}</p>
					{envelope.link && (
						<a
							class="ui-button ui-button--primary ui-button--text ui-button--size-sm wsp-mdrawer__envelope-link"
							href={envelope.link.href}
						>
							<span class="ui-button__label">{envelope.link.label}</span>
						</a>
					)}
				</section>
			)}
			{/* #endregion */}

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

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
import { MetaLine } from "@projective/ui/display";
import { InlineNotice } from "@projective/ui/feedback";
import { Button, FormControl, InputText, Select, ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	capabilitiesForKind,
	RESERVED_GRANT_CONFIRMATION,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import {
	assignableRoles,
	becomesCoOwner,
	changeAddsManager,
	confirmAnswered,
	confirmLabel,
	draftFacets,
	draftRankOf,
	drawerFooter,
	managerCapContextOf,
	managerCapNotice,
	managerOptions,
	managersFull,
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
	TITLE_EXAMPLE,
	toggleCapability,
	viewerRankOf,
} from "../core/members-model.ts";
import { ConsequenceIcon } from "./MemberCard.tsx";
import { ManagerCapNotice } from "./ManagerCapNotice.tsx";

/** Props for {@link MemberEditForm}. */
export interface MemberEditFormProps {
	workspace: WorkspaceDetail;
	member: WorkspaceMember;
	/** Whether the viewer holds the owner seat — owner-reserved rights move only at their hand. */
	viewerIsOwner: boolean;
	/** Distinguishes the docked and slide-over copies' ids. */
	idBase: string;
	/** The server's re-read detail after a save. */
	onSaved: (next: WorkspaceDetail) => void;
	/** Back to the dossier without saving. */
	onCancel: () => void;
}

/**
 * MemberEditForm — the member inspector's edit mode (Decision #322): role, title and reporting line,
 * then layer 3 of the permission model — this person's overrides on top of the role.
 *
 * Every capability row says where its state comes from (the role, or an override on this person),
 * from the SSOT's `permissionFacets()` over the DRAFT, so the list previews what saving does. A switch
 * the viewer may not flip is drawn as text, never a dead control. A business's reserved grant owes a
 * typed CONFIRM and the manager cap is said before Save (BU7). Cancel is tier 5, Save tier 3.
 *
 * Rendered only for a viewer the rank rule lets edit this member.
 */
export function MemberEditForm(props: MemberEditFormProps): JSX.Element {
	const { workspace: ws, member, viewerIsOwner, idBase } = props;
	const caps = ws.viewerCapabilities;

	// #region Draft
	const start = memberDraftOf(member);
	const roleId = useSignal(start.roleId);
	const overrides = useSignal<OverrideDraft>(start.overrides);
	const title = useSignal(start.title);
	const reports = useSignal(start.reportsTo === "" ? NOBODY : start.reportsTo);
	const saving = useSignal(false);
	const error = useSignal<string | null>(null);
	const confirmText = useSignal("");

	const rank = useComputed(() => draftRankOf(member, ws.roles, roleId.value));
	const fitted = useComputed(() => overridesAtRank(ws.kind, overrides.value, rank.value));
	const draft = useComputed<MemberDraft>(() => ({
		roleId: roleId.value,
		overrides: fitted.value,
		title: title.value,
		reportsTo: reports.value === NOBODY ? "" : reports.value,
	}));
	const patch = useComputed(() => memberPatch(member, draft.value));
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
		{ kind: ws.kind, editable: true, viewerCaps: caps, viewerIsOwner, draftRank: rank.value },
		role,
	);

	const added = reservedAdded(ws.kind, savedFacets, facets.value);
	const warning = reservedGrantWarning(
		member.name,
		added,
		becomesCoOwner(ws.kind, rank.value, facets.value),
	);
	const confirmOwed = added.length > 0;
	const confirmed = !confirmOwed || confirmAnswered(confirmText.value);
	const overCap = managersFull(ws.managers) && changeAddsManager({
		kind: ws.kind,
		member,
		saved: savedFacets,
		draftRank: rank.value,
		draft: facets.value,
	});
	const capContext = managerCapContextOf(ws);
	const capByRole = overCap && roleId.value !== member.roleId;

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
		props.onSaved(res.data);
	}
	// #endregion

	const actions = drawerFooter({
		editable: true,
		dirty: patch.value !== null,
		saving: saving.value,
		blocked: !confirmed || overCap,
		closeLabel: "Cancel",
	});
	const managers = managerOptions(ws.members, member);
	const id = (part: string) => `${idBase}-${member.id}-${part}`;

	return (
		<div class="wsp-inspector__form">
			<section class="wsp-inspector__section" aria-labelledby={id("place")}>
				<h3 class="wsp-inspector__heading" id={id("place")}>Role and place</h3>
				<FormControl
					class="wsp-inspector__field"
					label="Role"
					hint="Changing it moves every permission that came from it — the overrides below stay."
				>
					{({ id, describedBy }) => (
						<Select
							id={id}
							aria-describedby={describedBy}
							options={roleOptions(
								assignableRoles(ws.roles, caps, viewerRankOf(ws), member.roleId),
							)}
							value={roleId}
							onValueChange={() => (error.value = null)}
							fluid
						/>
					)}
				</FormControl>
				{capByRole && <ManagerCapNotice notice={managerCapNotice(capContext)} />}
				<FormControl
					class="wsp-inspector__field"
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
					class="wsp-inspector__field"
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
			</section>

			<section class="wsp-inspector__section" aria-labelledby={id("perms")}>
				<h3 class="wsp-inspector__heading" id={id("perms")}>Permissions</h3>
				<p class="wsp-inspector__note">
					Each switch shows where its state comes from — the role, or an override on this person.
				</p>
				{groups.map((group) => (
					<div
						key={group.title}
						class="wsp-inspector__domain"
						role="group"
						aria-labelledby={id(`group-${group.title}`)}
					>
						<h4 class="wsp-inspector__domain-title" id={id(`group-${group.title}`)}>
							{group.title}
						</h4>
						<ul class="wsp-inspector__switches">
							{group.rows.map((row) => {
								const noteId = id(row.capability);
								return (
									<li
										key={row.capability}
										class="wsp-inspector__switch"
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
											: <span class="wsp-inspector__switch-label">{row.label}</span>}
										<span id={noteId} class="wsp-inspector__switch-note">
											<MetaLine
												as="span"
												size="xs"
												items={[
													!row.toggleable && (row.on ? "Allowed" : "Not allowed"),
													row.provenance,
												]}
											/>
											{row.warning && (
												<span class="wsp-inspector__warning">
													<span class="wsp-inspector__warning-mark" aria-hidden="true">
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

			{(warning || (overCap && !capByRole)) && (
				<section class="wsp-inspector__section" aria-labelledby={id("confirm")}>
					<h3 class="wsp-inspector__heading" id={id("confirm")}>Before you save</h3>
					{overCap && !capByRole && <ManagerCapNotice notice={managerCapNotice(capContext)} />}
					{warning && (
						<>
							<InlineNotice align="start" icon={<Icon name="warning" />} text={warning} />
							<FormControl
								class="wsp-inspector__field"
								label={confirmLabel(added)}
								hint={`The word ${RESERVED_GRANT_CONFIRMATION}, in capitals. Taking a right away needs no confirmation.`}
								hintMode="inline"
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

			{error.value && <InlineNotice assertive align="start" text={error.value} />}

			<div class="wsp-inspector__commit">
				{actions.map((action) => (
					<Button
						key={action.key}
						{...membersTierProps(action.tier, action.danger)}
						label={action.label}
						disabled={action.disabled}
						loading={action.busy}
						onClick={action.key === "save" ? () => void save() : props.onCancel}
					/>
				))}
			</div>
		</div>
	);
}

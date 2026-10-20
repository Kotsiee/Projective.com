import type { JSX } from "preact";
import { batch, useComputed, useSignal } from "@preact/signals";
import "../styles/workspace.css";
import { MetaLine, PermissionMatrix } from "@projective/ui/display";
import type { PermissionMatrixColumn, PermissionMatrixRow } from "@projective/ui/display";
import { ConfirmDialog, InlineNotice, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { ActionMenu, type MenuItem } from "@projective/ui/navigation";
import {
	kindCopy,
	type UpsertRoleInput,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { publishDetail, saveState } from "../core/workspace-state.ts";
import { usePolicyBridge } from "../hooks/usePolicyBridge.ts";
import { useModuleCommit } from "../hooks/useModuleCommit.ts";
import {
	BLANK_START,
	cellLock,
	dirtyRoleIds,
	fixedCellReasons,
	managerCapLock,
	managerCapLocked,
	pruneDraft,
	roleCapContextOf,
	roleCaps,
	roleCellState,
	roleCreatedNotice,
	type RoleDraft,
	type RoleEditorMode,
	roleMatrixColumns,
	roleMatrixRows,
	roleMenu,
	type RoleMenuAction,
	roleRemits,
	roleSavePlan,
	rolesCommit,
	rolesHeaderItems,
	rolesLegend,
	type RolesLegendMark,
	rolesViewerOf,
	roleWriteInput,
	toggleRoleCap,
} from "../core/roles-model.ts";
import { managerCapContextOf, managerCapNotice, managerCapRefusal } from "../core/members-model.ts";
import { KebabIcon } from "../components/MemberCard.tsx";
import { ManagerCapNotice } from "../components/ManagerCapNotice.tsx";
import { RoleEditor } from "../components/RoleEditor.tsx";
import {
	AllowedGlyph,
	ConditionalGlyph,
	LockedGlyph,
	roleMatrixGlyphs,
} from "../components/role-glyphs.tsx";

/**
 * RolesMatrix — the Roles module (Teams work order C3): the entity's roles as columns of a
 * `PermissionMatrix` (`@projective/ui/display`, §B.13), the capabilities its kind renders as rows.
 *
 * **Columns** are the presets, most-privileged first, then the custom roles; each carries its member
 * count (and, for a custom role, the preset it is based on) as its meta line. **Rows** are the kind's
 * own capability list, grouped People · Work · Money · Admin, the consequential ones flagged sensitive
 * with what holding them lets a person do, a rule-bounded one with its rule.
 *
 * **Presets are locked columns** — the owner's all-allowed — described by "Preset roles can't be
 * edited — create a custom role". A custom role's column is the viewer's to edit, cell by cell, into a
 * local draft; Save and Discard are the footer rig's (tier 3 and tier 5, `usePolicyBridge`), so the
 * body never grows a Save of its own. A cell the server would refuse is LOCKED in place with the
 * server's reason — a grant the viewer does not hold, a business's owner-reserved right, or a tick
 * that would make a business role's holders managers past the plan's cap (BU7; the cap is then said
 * once, in a `ManagerCapNotice` over the matrix) — and a column that ranks above the viewer is locked
 * whole. Anything a role allows may be taken away. While a write is in flight every editable cell
 * waits, saying so, rather than ignoring a press. The legend
 * (`rolesLegend`) is worded for what is on screen: the padlock line names a role ranking above the
 * viewer when one is padlocked, and a cell fixed for the viewer gets the line saying what its missing
 * box means. Under the matrix, each role's one-line remit — what a column header has no room for.
 *
 * **New role** is the header band's one filled action (tier 2 structural, `useModuleCommit`); it
 * opens the `RoleEditor`, which also renames. A custom column's kebab carries Rename… · Duplicate… ·
 * Archive role…, the last confirmed by a danger `ConfirmDialog` and refused in place, with the count
 * and the reason, while anybody holds the role or an invitation offers it. Nothing is deleted.
 *
 * Every rule is `core/roles-model.ts`; every write resolves to the re-read detail, which replaces the
 * projection and is republished to the bands. Teams and Businesses share it (Decision #61): a
 * business's matrix is its own capability list, with no `lead`.
 */

export interface RolesMatrixProps {
	workspace: WorkspaceDetail;
}

/** A line the screen says about the last thing that happened. */
interface ScreenNotice {
	tone: "error" | "info";
	text: string;
}

/** Layout zones a column menu's panel keeps clear of. */
const MENU_AVOID = [".ui-app-shell__sidebar", ".ui-middle-nav__lane"] as const;

/** The glyph a legend line repeats — none for the no-box line, whose mark is the missing box. */
const LEGEND_GLYPH: Record<RolesLegendMark, (() => JSX.Element) | null> = {
	allowed: AllowedGlyph,
	conditional: ConditionalGlyph,
	locked: LockedGlyph,
	fixed: null,
	capped: null,
};

export default function RolesMatrix(props: RolesMatrixProps): JSX.Element {
	const detail = useSignal<WorkspaceDetail>(props.workspace);
	/** Unsaved capability lists per custom role id. */
	const draft = useSignal<RoleDraft>({});
	/** A role write (Save or an archive) is in flight — the matrix takes no toggles meanwhile. */
	const busy = useSignal(false);
	const notice = useSignal<ScreenNotice | null>(null);

	/** The role editor: open, its job, and a sequence that remounts it fresh on every open. */
	const editorOpen = useSignal(false);
	const editorSeq = useSignal(0);
	const editorMode = useSignal<RoleEditorMode>("create");
	const editorRole = useSignal<WorkspaceRoleDef | null>(null);
	const editorStart = useSignal(BLANK_START);

	/** The archive confirmation and the role it names. */
	const confirmArchive = useSignal(false);
	const archiving = useSignal<WorkspaceRoleDef | null>(null);

	const dirty = useComputed(() => dirtyRoleIds(detail.value.roles, draft.value).length > 0);

	// #region Writes
	/** Replace the projection from a server response, republish it, and drop a draft it settled. */
	function adopt(next: WorkspaceDetail, settled: readonly string[] = []): void {
		batch(() => {
			detail.value = next;
			const rest = Object.fromEntries(
				Object.entries(draft.peek()).filter(([id]) => !settled.includes(id)),
			);
			draft.value = pruneDraft(rest, next.roles);
		});
		publishDetail(next);
	}

	/**
	 * The footer rig's Save: one write per edited custom role. A role the server would refuse (it still
	 * allows something the viewer may not put on a role, or — on a business — it would add managers
	 * past the plan's cap) is held back with its sentence; the rest save.
	 */
	async function save(): Promise<void> {
		if (busy.peek()) return;
		const ws = detail.peek();
		const plan = roleSavePlan(
			ws.roles,
			draft.peek(),
			rolesViewerOf(ws),
			roleCapContextOf(ws, Date.now()),
		);
		if (plan.writes.length === 0 && plan.problems.length === 0) return;
		batch(() => {
			busy.value = true;
			notice.value = null;
			saveState.value = "saving";
		});
		const failures = plan.problems.map((p) => p.text);
		const settled: string[] = [];
		let latest: WorkspaceDetail | null = null;
		for (const write of plan.writes) {
			const res = await WorkspaceService.upsertRole(roleWriteInput(ws, write));
			if (!res.ok || !res.data) {
				failures.push(
					`${write.role.name}: ${
						managerCapRefusal(res.details, managerCapContextOf(ws)) ??
							res.errors?.capabilities ?? res.errors?.basePreset ?? res.message ??
							"it could not be saved."
					}`,
				);
				continue;
			}
			latest = res.data;
			settled.push(write.role.id);
		}
		batch(() => {
			if (latest) adopt(latest, settled);
			busy.value = false;
			if (failures.length > 0) {
				saveState.value = "error";
				notice.value = { tone: "error", text: failures.join(" ") };
			} else {
				saveState.value = "saved";
			}
		});
	}

	/** The footer rig's Discard: every column back to what is saved. */
	function discard(): void {
		batch(() => {
			draft.value = {};
			notice.value = null;
		});
	}

	usePolicyBridge({ dirty, save, discard });

	/** Archive a custom role — kept on record, never deleted. */
	async function archive(role: WorkspaceRoleDef): Promise<void> {
		const ws = detail.peek();
		batch(() => {
			busy.value = true;
			notice.value = null;
		});
		const res = await WorkspaceService.archiveRole({
			kind: ws.kind,
			workspaceId: ws.id,
			roleId: role.id,
		});
		busy.value = false;
		if (!res.ok || !res.data) {
			notice.value = {
				tone: "error",
				text: res.errors?.role ?? res.message ?? `Could not archive ${role.name}.`,
			};
			return;
		}
		adopt(res.data, [role.id]);
		notice.value = {
			tone: "info",
			text: `${role.name} is archived. It stays on record — nothing was deleted.`,
		};
	}
	// #endregion

	// #region Editor and menus
	function openEditor(mode: RoleEditorMode, role: WorkspaceRoleDef | null, start: string): void {
		batch(() => {
			editorMode.value = mode;
			editorRole.value = role;
			editorStart.value = start;
			editorSeq.value = editorSeq.peek() + 1;
			editorOpen.value = true;
		});
	}

	// The header band's one filled action: "New role" (tier 2 structural), for a manage_roles holder.
	useModuleCommit(() => {
		const commit = rolesCommit(rolesViewerOf(detail.value));
		return commit ? { ...commit, run: () => openEditor("create", null, BLANK_START) } : null;
	});

	function onMenuAction(action: RoleMenuAction, role: WorkspaceRoleDef): void {
		switch (action) {
			case "rename":
				openEditor("rename", role, BLANK_START);
				return;
			case "duplicate":
				openEditor("create", null, `role:${role.id}`);
				return;
			case "archive":
				batch(() => {
					archiving.value = role;
					confirmArchive.value = true;
				});
				return;
		}
	}

	/** After the editor wrote a role: adopt the re-read detail and say what happened. */
	function onSaved(
		next: WorkspaceDetail,
		written: Pick<UpsertRoleInput, "name" | "capabilities">,
	): void {
		adopt(next);
		notice.value = {
			tone: "info",
			text: editorMode.peek() === "create"
				? roleCreatedNotice(written.name, written.capabilities)
				: `Renamed to ${written.name}.`,
		};
	}
	// #endregion

	// #region The matrix
	const ws = detail.value;
	const copy = kindCopy(ws.kind);
	const viewer = rolesViewerOf(ws);
	const byId = new Map(ws.roles.map((r) => [r.id, r]));
	const rows = roleMatrixRows(ws.kind, ws);
	const columns = roleMatrixColumns(ws.roles, viewer, draft.value);
	/** A business's manager cap, judged against the draft (BU7): which cell it fixes, and whether any. */
	const capCtx = roleCapContextOf(ws, Date.now());
	const capped = managerCapLocked(ws.roles, viewer, draft.value, capCtx);
	const conditional = ws.roles.some((role) =>
		rows.some((row) =>
			roleCellState(role, row.key as WorkspaceCapability, roleCaps(role, draft.value), ws) ===
				"conditional"
		)
	);
	const legend = rolesLegend({
		kind: ws.kind,
		conditional,
		columnLocks: columns.map((column) => column.lockedHint),
		fixedReasons: fixedCellReasons(ws.roles, viewer, draft.value),
		capped,
	});
	const remits = roleRemits(ws.roles);
	/** A role write is in flight: every editable cell waits, and says so. */
	const writing = busy.value;

	const capOf = (row: PermissionMatrixRow) => row.key as WorkspaceCapability;
	const roleOf = (column: PermissionMatrixColumn) => byId.get(column.key) ?? null;

	function cellValue(row: PermissionMatrixRow, column: PermissionMatrixColumn) {
		const role = roleOf(column);
		if (!role) return "off" as const;
		return roleCellState(role, capOf(row), roleCaps(role, draft.value), ws);
	}

	function cellFix(row: PermissionMatrixRow, column: PermissionMatrixColumn): string | null {
		const role = roleOf(column);
		if (!role || column.locked) return null;
		const on = roleCaps(role, draft.value).includes(capOf(row));
		return cellLock(capOf(row), on, viewer, writing) ??
			managerCapLock(role, capOf(row), on, ws.roles, draft.value, capCtx);
	}

	function toggle(row: PermissionMatrixRow, column: PermissionMatrixColumn): void {
		const role = roleOf(column);
		if (!role || role.preset || busy.peek()) return;
		batch(() => {
			draft.value = toggleRoleCap(draft.peek(), role, capOf(row));
			if (saveState.peek() !== "saving") saveState.value = "idle";
		});
	}

	function columnMenu(column: PermissionMatrixColumn): JSX.Element | null {
		const role = roleOf(column);
		if (!role) return null;
		const menu = roleMenu(role, viewer, ws.invites, onMenuAction);
		return menu.length > 0 ? <RoleActionsMenu role={role} menu={menu} /> : null;
	}
	// #endregion

	return (
		<div class="wsp" data-kind={ws.kind}>
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" data-i={0} aria-label="Roles and permissions">
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<div class="wsp-roles__head">
								<MetaLine items={rolesHeaderItems(ws.roles)} />
							</div>
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
						<div class="wsp-roles">
							<ul class="wsp-roles__legend" aria-label="What the cells mean">
								{legend.map((item) => {
									const Glyph = LEGEND_GLYPH[item.mark];
									return (
										<li key={item.mark} class="wsp-roles__legend-item">
											{Glyph && (
												<span class="wsp-roles__legend-glyph" aria-hidden="true">
													<Glyph />
												</span>
											)}
											{item.text}
										</li>
									);
								})}
							</ul>

							{capped && <ManagerCapNotice notice={managerCapNotice(managerCapContextOf(ws))} />}

							<PermissionMatrix
								class="wsp-roles__matrix"
								caption={`${copy.Noun} roles and permissions`}
								captionHidden
								rowHeaderLabel="Permission"
								rows={rows}
								columns={columns}
								value={cellValue}
								onToggle={viewer.canManage ? toggle : undefined}
								cellLock={cellFix}
								columnActions={viewer.canManage ? columnMenu : undefined}
								glyphs={roleMatrixGlyphs()}
								stateLabels={{ conditional: "Allowed within a rule" }}
								lockedHint="This cell can't be changed here."
							/>
						</div>

						{remits.length > 0 && (
							<section class="wsp-roles__remits" aria-labelledby="wsp-roles-remits">
								<h2 id="wsp-roles-remits" class="wsp-label">What each role is for</h2>
								<dl class="wsp-roles__remit-list">
									{remits.map((remit) => (
										<div key={remit.key} class="wsp-roles__remit">
											<dt class="wsp-roles__remit-name">{remit.name}</dt>
											<dd class="wsp-roles__remit-summary">{remit.summary}</dd>
										</div>
									))}
								</dl>
							</section>
						)}
					</div>
				</section>
			</div>

			{viewer.canManage && (
				<RoleEditor
					key={`role-editor-${editorSeq.value}`}
					workspace={ws}
					viewer={viewer}
					visible={editorOpen}
					mode={editorMode.value}
					role={editorRole.value}
					startKey={editorStart.value}
					onSaved={onSaved}
				/>
			)}

			<ConfirmDialog
				visible={confirmArchive}
				header={`Archive ${archiving.value?.name ?? "this role"}?`}
				message={`${
					archiving.value?.name ?? "It"
				} leaves the matrix and can no longer be given to anyone. It stays on record — nothing is deleted.`}
				acceptLabel="Archive role"
				rejectLabel="Keep it"
				acceptSeverity="danger"
				onAccept={() => {
					const role = archiving.peek();
					if (role) void archive(role);
				}}
			/>
		</div>
	);
}

// #region Column menu
/**
 * A custom role column's kebab — a tier-5 icon-only Button opening the role's menu (Rename… ·
 * Duplicate… · Archive role…), named for the role it acts on.
 */
function RoleActionsMenu(props: { role: WorkspaceRoleDef; menu: MenuItem[] }): JSX.Element {
	const label = `Actions for ${props.role.name}`;
	return (
		<ActionMenu
			model={props.menu}
			placement="bottom-end"
			avoid={MENU_AVOID}
			aria-label={label}
			trigger={(api) => (
				<Tooltip content={label}>
					<Button
						triggerRef={api.ref}
						variant="text"
						severity="secondary"
						size="sm"
						iconOnly
						icon={<KebabIcon />}
						aria-label={label}
						aria-haspopup="menu"
						aria-expanded={api.expanded}
						aria-controls={api.panelId}
						onClick={() => api.toggle()}
					/>
				</Tooltip>
			)}
		/>
	);
}
// #endregion

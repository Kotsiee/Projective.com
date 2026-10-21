import type { JSX } from "preact";
import {
	batch,
	type Signal,
	signal,
	useComputed,
	useSignal,
	useSignalEffect,
} from "@preact/signals";
import { useMemo, useRef } from "preact/hooks";
import "../styles/workspace.css";
import { ConfirmDialog } from "@projective/ui/feedback";
import {
	capabilitiesForKind,
	type UpsertRoleInput,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { publishDetail } from "../core/workspace-state.ts";
import {
	ARCHIVE_HINT,
	BLANK_START,
	canvasMeta,
	createdRoleId,
	dirtyRoleIds,
	initialRoleId,
	keepSelection,
	newRoleAction,
	pruneDraft,
	rigActions,
	roleCanvas,
	roleCapContextOf,
	roleCreatedNotice,
	type RoleDraft,
	ROLES_AUTOSAVE_MS,
	roleSavePlan,
	roleSummaryLine,
	rolesViewerOf,
	roleWriteInput,
	rosterSections,
	sameCaps,
	toggleRoleCap,
} from "../core/roles-model.ts";
import {
	loadRolesAutoSave,
	rolesAutoSave,
	rolesCommands,
	rolesNotice,
	rolesRig,
	rolesSavedAt,
	rolesSaveState,
} from "../core/roles-rig.ts";
import type { RigAction } from "../core/roles-model.ts";
import { managerCapContextOf, managerCapRefusal } from "../core/members-model.ts";
import { RoleRoster } from "../components/RoleRoster.tsx";
import { RoleCanvas } from "../components/RoleCanvas.tsx";
import { EditRoleModal, NewRoleModal } from "../components/NewRoleModal.tsx";

/**
 * WorkspaceRolesMasterDetail — the Roles module (`/teams/:h/roles`, `/businesses/:h/roles`) as a
 * master-detail screen (Decision #320, decluttered by #321).
 *
 * **Master.** `RoleRoster`, sticky while the canvas scrolls: the Preset roles and the Custom roles, a
 * row each (name, holders' count), and a slim New role under the custom run. **Detail.** `RoleCanvas`:
 * the selected role's header, then its capabilities in four domains, each an unboxed row with a
 * `ToggleSwitch` on the inline-end edge. **Footer.** The selected role's actions and the save line are
 * the middle-nav footer band's (`RolesFooterRig`, the catalogue workspace's rig), reached through
 * `core/roles-rig.ts`: this island publishes what the footer draws and registers what it runs.
 *
 * **State.** The selected role is a signal (`selectedRoleId`), kept on the same role across every
 * re-read and moved to the screen's opening role when that one is archived. A switch edits a local
 * draft (each edited row in the roster shows a dot); with Auto-save on, the draft saves itself
 * `ROLES_AUTOSAVE_MS` after the last switch moved, else the footer's Save now / Discard settle it. A
 * switch moved while a save is in flight is kept: a written role leaves the draft only if the draft
 * still holds what was written. A row the server would refuse is LOCKED in place with the server's
 * reason. Every write resolves to the re-read detail (`get_workspace_detail`'s SSOT shape), which
 * replaces the projection and is republished to the bands; a refusal — a 422's field errors included —
 * is said in the footer, and nothing is applied.
 *
 * **Narrow.** Below a 48rem region (a container query, so a docked lane counts) the screen is a
 * drill-down: the roster first, a pressed role slides its canvas in with an All roles way back, and
 * focus follows — to the canvas's heading going in, to the role's row coming back.
 *
 * Every rule is `core/roles-model.ts`. Teams and Businesses share it (Decision #61): a business's
 * canvas is its own capability list, with no `lead`.
 */

export interface WorkspaceRolesProps {
	workspace: WorkspaceDetail;
}

/** The canvas's id — the roster rows control it. */
const CANVAS_ID = "wsp-roles-canvas";

export default function WorkspaceRolesMasterDetail(props: WorkspaceRolesProps): JSX.Element {
	const detail = useSignal<WorkspaceDetail>(props.workspace);
	/** Unsaved capability lists per custom role id. */
	const draft = useSignal<RoleDraft>({});
	/** The role the canvas shows. */
	const selectedRoleId = useSignal<string | null>(initialRoleId(props.workspace.roles));
	/** Which pane a narrow region shows: the roster, or the selected role's canvas. */
	const pane = useSignal<"list" | "detail">("list");
	/** An archive is in flight — the canvas and the footer's actions wait. */
	const busy = useSignal(false);
	/** A permission save is in flight — a further save waits for it. */
	const saving = useSignal(false);

	/** The New role dialog: open, a sequence that remounts it fresh, and the source it opens on. */
	const createOpen = useSignal(false);
	const createSeq = useSignal(0);
	const createStart = useSignal(BLANK_START);
	/** The Edit details dialog. */
	const editOpen = useSignal(false);
	const editSeq = useSignal(0);

	/** The archive confirmation and the role it names. */
	const confirmArchive = useSignal(false);
	const archiving = useSignal<WorkspaceRoleDef | null>(null);

	const titleRef = useRef<HTMLHeadingElement>(null);
	const backRef = useRef<HTMLDivElement>(null);

	const dirty = useComputed(() => dirtyRoleIds(detail.value.roles, draft.value).length > 0);
	const selected = useComputed(() =>
		detail.value.roles.find((r) => r.id === selectedRoleId.value) ?? null
	);
	const viewer = useComputed(() => rolesViewerOf(detail.value));
	const capCtx = useComputed(() => roleCapContextOf(detail.value, Date.now()));
	const canvas = useComputed(() => {
		const role = selected.value;
		return role
			? roleCanvas({
				role,
				roles: detail.value.roles,
				draft: draft.value,
				viewer: viewer.value,
				policy: detail.value,
				cap: capCtx.value,
			})
			: null;
	});

	/**
	 * One writable signal per capability switch, kept in step with the selected role's canvas. A switch
	 * must be CONTROLLED (selecting another role, Discard and a re-read all move it), and a computed
	 * cannot be written by the control, so the screen holds the signals and mirrors the canvas into them
	 * — the member drawer's pattern.
	 */
	const switches = useMemo(
		() =>
			new Map<WorkspaceCapability, Signal<boolean>>(
				capabilitiesForKind(props.workspace.kind).map((c) => [c, signal(false)]),
			),
		[],
	);
	useSignalEffect(() => {
		const view = canvas.value;
		if (!view) return;
		for (const domain of view.domains) {
			for (const row of domain.rows) {
				const s = switches.get(row.capability);
				if (s && s.peek() !== row.on) s.value = row.on;
			}
		}
	});

	// #region Writes
	/**
	 * Replace the projection from a server response, republish it, and drop from the draft each role a
	 * write settled — only while the draft still holds what was written, so a switch moved during the
	 * save stays unsaved rather than vanishing.
	 */
	function adopt(
		next: WorkspaceDetail,
		written: Readonly<Record<string, readonly WorkspaceCapability[]>> = {},
	): void {
		batch(() => {
			detail.value = next;
			const rest = Object.fromEntries(
				Object.entries(draft.peek()).filter(([id, caps]) =>
					!(written[id] && sameCaps(caps, written[id]))
				),
			);
			draft.value = pruneDraft(rest, next.roles);
			selectedRoleId.value = keepSelection(
				next.roles,
				selectedRoleId.peek(),
				() => initialRoleId(next.roles),
			);
		});
		publishDetail(next);
	}

	/**
	 * Save the draft: one write per edited custom role. A role the server would refuse (it still allows
	 * something the viewer may not put on a role, or — on a business — it would add managers past the
	 * plan's cap) is held back with its sentence; the rest save.
	 */
	async function save(): Promise<void> {
		if (saving.peek() || busy.peek()) return;
		const ws = detail.peek();
		const plan = roleSavePlan(
			ws.roles,
			draft.peek(),
			rolesViewerOf(ws),
			roleCapContextOf(ws, Date.now()),
		);
		if (plan.writes.length === 0 && plan.problems.length === 0) return;
		batch(() => {
			saving.value = true;
			rolesSaveState.value = "saving";
		});
		const failures = plan.problems.map((p) => p.text);
		const written: Record<string, readonly WorkspaceCapability[]> = {};
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
			written[write.role.id] = write.capabilities;
		}
		batch(() => {
			if (latest) adopt(latest, written);
			saving.value = false;
			if (failures.length > 0) {
				rolesSaveState.value = "error";
				rolesNotice.value = failures.join(" ");
				return;
			}
			rolesSavedAt.value = Date.now();
			rolesSaveState.value = dirty.peek() ? "dirty" : "saved";
		});
	}

	/** The footer's Discard: every role back to what is saved. */
	function discard(): void {
		batch(() => {
			draft.value = {};
			rolesNotice.value = null;
			rolesSaveState.value = "saved";
		});
	}

	/**
	 * Auto-save: whenever the draft moves and holds edits, say so — and, with Auto-save on, save it a
	 * moment after the last switch moved. A re-read after a save moves the draft again, so an edit made
	 * during the save is picked up by the next run.
	 */
	useSignalEffect(() => {
		draft.value;
		const pending = dirty.value;
		const auto = rolesAutoSave.value;
		if (!pending) return;
		if (!saving.peek() && rolesSaveState.peek() !== "error") rolesSaveState.value = "dirty";
		if (!auto) return;
		const timer = setTimeout(() => void save(), ROLES_AUTOSAVE_MS);
		return () => clearTimeout(timer);
	});

	/** Archive a custom role — kept on record, never deleted. */
	async function archive(role: WorkspaceRoleDef): Promise<void> {
		const ws = detail.peek();
		busy.value = true;
		const res = await WorkspaceService.archiveRole({
			kind: ws.kind,
			workspaceId: ws.id,
			roleId: role.id,
		});
		busy.value = false;
		if (!res.ok || !res.data) {
			rolesNotice.value = res.errors?.role ?? res.message ?? `Couldn't archive ${role.name}`;
			return;
		}
		adopt(res.data);
		rolesNotice.value = `${role.name} archived`;
	}
	// #endregion

	// #region Selection and the drill-down
	/** Whether the region is narrow — the drill-down draws its way back only then. */
	function drilled(): boolean {
		const back = backRef.current;
		return back !== null && getComputedStyle(back).display !== "none";
	}

	/** Once the next paint lands, run `fn` — focus moves only after the pane it targets is shown. */
	function afterRender(fn: () => void): void {
		setTimeout(fn, 0);
	}

	function select(id: string): void {
		batch(() => {
			selectedRoleId.value = id;
			pane.value = "detail";
		});
		afterRender(() => {
			if (drilled()) titleRef.current?.focus();
		});
	}

	function back(): void {
		const id = selectedRoleId.peek();
		pane.value = "list";
		afterRender(() => {
			const row = document.querySelector<HTMLElement>(
				`.wsp-roles__row[data-role-id="${CSS.escape(id ?? "")}"]`,
			);
			row?.focus();
		});
	}

	function toggle(capability: WorkspaceCapability): void {
		const role = selected.peek();
		const view = canvas.peek();
		const row = view?.domains.flatMap((d) => d.rows).find((r) => r.capability === capability);
		if (!role || !view || !row || view.lock || row.lock || busy.peek()) {
			const s = switches.get(capability);
			if (s && row) s.value = row.on;
			return;
		}
		batch(() => {
			draft.value = toggleRoleCap(draft.peek(), role, capability);
			// A new edit is the line's news now: the last word (a create, a refusal) gives way to it.
			rolesNotice.value = null;
		});
	}
	// #endregion

	// #region Dialogs and the footer's commands
	function openCreate(start: string): void {
		batch(() => {
			createStart.value = start;
			createSeq.value = createSeq.peek() + 1;
			createOpen.value = true;
		});
	}

	function act(action: RigAction["key"]): void {
		const role = selected.peek();
		if (!role) return;
		switch (action) {
			case "edit":
				batch(() => {
					editSeq.value = editSeq.peek() + 1;
					editOpen.value = true;
				});
				return;
			case "duplicate":
				openCreate(`role:${role.id}`);
				return;
			case "archive":
				batch(() => {
					archiving.value = role;
					confirmArchive.value = true;
				});
				return;
		}
	}

	/** After New role wrote a role: adopt the re-read detail, open the new role, and say so. */
	function onCreated(
		next: WorkspaceDetail,
		written: Pick<UpsertRoleInput, "name" | "capabilities">,
	): void {
		const id = createdRoleId(detail.peek().roles, next.roles);
		adopt(next);
		batch(() => {
			if (id) selectedRoleId.value = id;
			pane.value = "detail";
			rolesNotice.value = roleCreatedNotice(written.name, written.capabilities);
		});
		afterRender(() => titleRef.current?.focus());
	}

	function onEdited(next: WorkspaceDetail, written: Pick<UpsertRoleInput, "name">): void {
		adopt(next);
		rolesNotice.value = `${written.name} saved`;
	}

	// Register the footer's commands and start its line fresh; withdraw them when the screen goes.
	useSignalEffect(() => {
		loadRolesAutoSave();
		batch(() => {
			rolesSaveState.value = "saved";
			rolesSavedAt.value = null;
			rolesNotice.value = null;
			rolesCommands.value = { act, saveNow: () => void save(), discard };
		});
		return () => {
			rolesCommands.value = null;
		};
	});

	// Publish the selected role's actions to the footer — none while a narrow region shows the list,
	// where no role is open for them to act on.
	useSignalEffect(() => {
		const role = selected.value;
		const listing = pane.value === "list" && drilled();
		rolesRig.value = role
			? {
				name: role.name,
				actions: listing ? [] : rigActions(role, viewer.value, detail.value.invites),
				busy: busy.value,
			}
			: null;
	});
	useSignalEffect(() => () => {
		rolesRig.value = null;
	});
	// #endregion

	// #region Render
	const ws = detail.value;
	const who = viewer.value;
	const role = selected.value;
	const view = canvas.value;
	const sections = rosterSections(ws.roles, draft.value);
	const edited = role ? dirtyRoleIds(ws.roles, draft.value).includes(role.id) : false;

	return (
		<div class="wsp" data-kind={ws.kind}>
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--page wsp-band--tail" aria-label="Roles and permissions">
					<div class="wsp-band__inner">
						<div class="wsp-roles" data-pane={pane.value}>
							<div class="wsp-roles__frame">
								<RoleRoster
									sections={sections}
									selected={selectedRoleId.value}
									canvasId={CANVAS_ID}
									create={newRoleAction(who)}
									onCreate={() => openCreate(BLANK_START)}
									onSelect={select}
								/>
								{role && view && (
									<RoleCanvas
										id={CANVAS_ID}
										name={role.name}
										meta={canvasMeta(role, view, edited)}
										summary={roleSummaryLine(role, ws.kind)}
										canvas={view}
										busy={busy.value}
										switches={switches}
										titleRef={titleRef}
										backRef={backRef}
										onToggle={toggle}
										onBack={back}
									/>
								)}
							</div>
						</div>
					</div>
				</section>
			</div>

			{who.canManage && (
				<NewRoleModal
					key={`role-create-${createSeq.value}`}
					workspace={ws}
					viewer={who}
					visible={createOpen}
					startKey={createStart.value}
					onSaved={onCreated}
				/>
			)}

			{who.canManage && role && role.preset === null && (
				<EditRoleModal
					key={`role-edit-${editSeq.value}-${role.id}`}
					workspace={ws}
					viewer={who}
					cap={capCtx.value}
					visible={editOpen}
					role={role}
					onSaved={onEdited}
				/>
			)}

			<ConfirmDialog
				visible={confirmArchive}
				header={`Archive ${archiving.value?.name ?? "this role"}?`}
				message={`${
					archiving.value?.name ?? "It"
				} leaves the roster and can no longer be given to anyone. ${ARCHIVE_HINT}`}
				acceptLabel="Archive role"
				rejectLabel="Keep it"
				acceptSeverity="danger"
				onAccept={() => {
					const target = archiving.peek();
					if (target) void archive(target);
				}}
			/>
		</div>
	);
	// #endregion
}

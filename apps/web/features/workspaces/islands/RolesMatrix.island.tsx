import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/workspace.css";
import { Tooltip } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import { styleVars } from "@ui/core/style.ts";
import {
	capabilitiesForKind,
	CAPABILITY_LABEL,
	CONSEQUENTIAL,
	kindCopy,
	mayGrant,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { publishDetail } from "../core/workspace-state.ts";
import { ConditionalIcon, LockIcon, TickIcon } from "../components/MemberCard.tsx";
import { cloneGlyph, PlusGlyph, RoleGlyph } from "../core/workspace-glyphs.tsx";

/**
 * RolesMatrix — layers 1 and 2 of the permission model, as a grid you can actually read.
 *
 * Roles run down; capabilities run across. A cell answers one question — may this role do this thing —
 * and the answer is a GLYPH, because eighteen columns of the word "Allowed" is a wall rather than a
 * table (§B.6). The words live in each cell's tooltip, along with WHY when the answer is no.
 *
 * **Presets are locked, and visibly so.** `owner` / `admin` / `lead` / `member` are the definition of
 * the common case; if they were editable, two entities using "Admin" could mean different things and
 * every conversation about permissions would need a lookup. `Duplicate to custom role` is the escape
 * hatch — copy the bundle, then diverge under a name of your own.
 *
 * **A cell the actor cannot grant is disabled with its reason, not hidden.** `mayGrant()` enforces
 * "you cannot give away what you do not hold"; hiding those cells would make the matrix look different
 * per viewer and teach nobody why.
 *
 * The grid is a real `role="grid"` with arrow-key navigation and Space to toggle, so it is fully usable
 * without a pointer. Both the header row and the first column are sticky, and the horizontal scroll
 * lives on the matrix wrapper — never the page.
 */

export interface RolesMatrixProps {
	workspace: WorkspaceDetail;
}

export default function RolesMatrix(props: RolesMatrixProps): JSX.Element {
	const detail = useSignal<WorkspaceDetail>(props.workspace);
	const ws = detail.value;
	const copy = kindCopy(ws.kind);

	const columns = useComputed(() => capabilitiesForKind(ws.kind));
	const held = new Set(ws.viewerCapabilities);
	const canManage = held.has("manage_roles");

	/** The viewer's row, for `mayGrant`. */
	const actor = useComputed(() =>
		ws.members.find((m) => m.id === ws.viewerMemberId) ?? ws.members.find((m) => m.isSelf) ?? null
	);

	/** Pending capability edits per custom role id — presets are never in here. */
	const draft = useSignal<Record<string, Set<WorkspaceCapability>>>({});
	const saving = useSignal(false);
	const error = useSignal<string | null>(null);
	/** The focused cell, as `[rowIndex, colIndex]`, for keyboard navigation. */
	const focus = useSignal<[number, number]>([0, 0]);
	const gridRef = useRef<HTMLDivElement | null>(null);

	/** New-role composer state. */
	const composing = useSignal(false);
	const newName = useSignal("");
	const seedFrom = useSignal<string | null>(null);

	const dirty = useComputed(() => Object.keys(draft.value).length > 0);

	/** The effective capability set for a role, draft first. */
	function capsOf(role: WorkspaceRoleDef): Set<WorkspaceCapability> {
		return draft.value[role.id] ?? new Set(role.capabilities);
	}

	function toggle(role: WorkspaceRoleDef, capability: WorkspaceCapability): void {
		if (role.preset || !canManage) return;
		if (!actor.value || !mayGrant(actor.value, capability, ws.kind)) return;

		const next = { ...draft.value };
		const set = new Set(next[role.id] ?? role.capabilities);
		if (set.has(capability)) set.delete(capability);
		else set.add(capability);
		next[role.id] = set;
		draft.value = next;
		error.value = null;
	}

	async function saveRole(role: WorkspaceRoleDef): Promise<void> {
		const set = draft.value[role.id];
		if (!set) return;
		saving.value = true;
		error.value = null;
		const res = await WorkspaceService.upsertRole({
			workspaceId: ws.id,
			roleId: role.id,
			name: role.name,
			summary: role.summary,
			capabilities: [...set],
		});
		saving.value = false;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "Could not save that role.";
			return;
		}
		const next = { ...draft.value };
		delete next[role.id];
		draft.value = next;
		detail.value = res.data.workspace;
		publishDetail(res.data.workspace);
	}

	async function createRole(): Promise<void> {
		const name = newName.value.trim();
		if (name.length === 0) {
			error.value = "Give the role a name.";
			return;
		}
		const seed = seedFrom.value ? ws.roles.find((r) => r.id === seedFrom.value) : null;
		saving.value = true;
		error.value = null;
		const res = await WorkspaceService.upsertRole({
			workspaceId: ws.id,
			name,
			summary: seed ? `Based on ${seed.name}.` : "",
			capabilities: seed ? [...seed.capabilities] : [],
		});
		saving.value = false;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "Could not create that role.";
			return;
		}
		composing.value = false;
		newName.value = "";
		seedFrom.value = null;
		detail.value = res.data.workspace;
		publishDetail(res.data.workspace);
	}

	/** Arrow-key navigation across the grid; Space toggles the focused cell. */
	function onKeyDown(e: KeyboardEvent): void {
		const [r, c] = focus.value;
		const rows = ws.roles.length;
		const cols = columns.value.length;
		let next: [number, number] | null = null;

		switch (e.key) {
			case "ArrowRight":
				next = [r, Math.min(cols - 1, c + 1)];
				break;
			case "ArrowLeft":
				next = [r, Math.max(0, c - 1)];
				break;
			case "ArrowDown":
				next = [Math.min(rows - 1, r + 1), c];
				break;
			case "ArrowUp":
				next = [Math.max(0, r - 1), c];
				break;
			case "Home":
				next = [r, 0];
				break;
			case "End":
				next = [r, cols - 1];
				break;
			case " ":
			case "Enter": {
				e.preventDefault();
				toggle(ws.roles[r], columns.value[c]);
				return;
			}
			default:
				return;
		}

		if (next) {
			e.preventDefault();
			focus.value = next;
			const cell = gridRef.current?.querySelector<HTMLElement>(
				`[data-cell="${next[0]}-${next[1]}"]`,
			);
			cell?.focus();
		}
	}

	return (
		<div class="wsp" data-kind={ws.kind}>
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" style={styleVars({ "--wsp-i": 0 })}>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title">Roles and permissions</h1>
							<p class="wsp-pagehead__note">
								A role is a named bundle of permissions. Pick one and most people never think about
								this page again; compose your own when the presets do not fit. Individual exceptions
								live on each member, not here.
							</p>
						</div>
					</div>
				</section>

				<section class="wsp-band wsp-band--page wsp-band--tail">
					<div class="wsp-band__inner">
						{/* #region Legend */}
						<div class="wsp-matrix__legend">
							<span class="wsp-matrix__legend-item">
								<span class="wsp-matrix__legend-mark" data-state="allowed">
									<TickIcon />
								</span>
								Allowed
							</span>
							<span class="wsp-matrix__legend-item">
								<span class="wsp-matrix__legend-mark" data-state="conditional">
									<ConditionalIcon />
								</span>
								Conditional — a limit or an approval applies
							</span>
							<span class="wsp-matrix__legend-item">
								<span class="wsp-matrix__legend-mark" data-state="denied">
									<LockIcon />
								</span>
								Not allowed
							</span>
						</div>
						{/* #endregion */}

						{/* #region The grid */}
						<div class="wsp-matrix">
							<div
								class="wsp-matrix__grid"
								role="grid"
								aria-label={`${copy.Noun} roles and permissions`}
								aria-rowcount={ws.roles.length + 1}
								aria-colcount={columns.value.length + 1}
								ref={gridRef}
								onKeyDown={onKeyDown}
							>
								<div class="wsp-matrix__head" role="row" aria-rowindex={1}>
									<div class="wsp-matrix__corner" role="columnheader" aria-colindex={1}>Role</div>
									{columns.value.map((cap, i) => (
										<div
											class="wsp-matrix__col"
											role="columnheader"
											aria-colindex={i + 2}
											key={cap}
										>
											<Tooltip content={CAPABILITY_LABEL[cap]} placement="top">
												<span
													class="wsp-matrix__colbtn"
													data-consequential={CONSEQUENTIAL.includes(cap) ? "true" : undefined}
												>
													<span class="wsp-matrix__col-name">{CAPABILITY_LABEL[cap]}</span>
												</span>
											</Tooltip>
										</div>
									))}
								</div>

								{ws.roles.map((role, rowIndex) => {
									const caps = capsOf(role);
									const roleDirty = Boolean(draft.value[role.id]);
									return (
										<div
											class="wsp-matrix__row"
											role="row"
											aria-rowindex={rowIndex + 2}
											key={role.id}
											data-preset={role.preset ? "true" : undefined}
										>
											<div class="wsp-matrix__rowhead" role="rowheader" aria-colindex={1}>
												<span class="wsp-matrix__rowlabel">
													{role.name}
													{role.preset && (
														<Tooltip
															content="A preset role — duplicate it to make an editable copy"
															placement="right"
														>
															<span class="wsp-matrix__lock" aria-label="Read-only preset">
																<LockIcon />
															</span>
														</Tooltip>
													)}
												</span>
												<span class="wsp-matrix__rownote">
													{role.memberCount === 1 ? "1 member" : `${role.memberCount} members`}
													{role.summary ? ` · ${role.summary}` : ""}
												</span>
												<span class="wsp-matrix__actions">
													{role.preset
														? (
															<button
																type="button"
																class="wsp-matrix__colbtn"
																onClick={() => {
																	composing.value = true;
																	seedFrom.value = role.id;
																	newName.value = `${role.name} copy`;
																}}
															>
																Duplicate to custom role
															</button>
														)
														: roleDirty
														? (
															<button
																type="button"
																class="wsp-matrix__colbtn"
																disabled={saving.value}
																onClick={() => void saveRole(role)}
															>
																{saving.value ? "Saving…" : "Save"}
															</button>
														)
														: null}
												</span>
											</div>

											{columns.value.map((cap, colIndex) => {
												const on = caps.has(cap);
												const blockedByActor = !actor.value ||
													!mayGrant(actor.value, cap, ws.kind);
												const editable = canManage && !role.preset && !blockedByActor;
												// Money capabilities on a business are genuinely conditional: a limit or
												// an approval threshold governs them even when the role allows them.
												const conditional = on && ws.kind === "business" &&
													(cap === "spend_funds" || cap === "purchase" || cap === "hire");
												const state = on ? (conditional ? "conditional" : "allowed") : "denied";
												const reason = role.preset
													? "Preset roles are read-only — duplicate this row to change it."
													: blockedByActor
													? "You cannot grant a permission you do not hold yourself."
													: !canManage
													? "You need permission to change roles."
													: conditional
													? "Allowed, within this member's spend limit and the approval threshold."
													: on
													? "Allowed."
													: "Not allowed.";

												return (
													<div
														class="wsp-matrix__cellwrap"
														role="gridcell"
														aria-colindex={colIndex + 2}
														key={cap}
													>
														<Tooltip
															content={`${CAPABILITY_LABEL[cap]} — ${reason}`}
															placement="top"
														>
															<button
																type="button"
																class="wsp-matrix__cell"
																data-cell={`${rowIndex}-${colIndex}`}
																data-state={state}
																aria-pressed={on}
																aria-label={`${role.name}: ${CAPABILITY_LABEL[cap]}`}
																disabled={!editable}
																tabIndex={focus.value[0] === rowIndex &&
																		focus.value[1] === colIndex
																	? 0
																	: -1}
																onFocus={() => {
																	focus.value = [rowIndex, colIndex];
																}}
																onClick={() => toggle(role, cap)}
															>
																<span class="wsp-matrix__mark" data-state={state}>
																	{state === "allowed"
																		? <TickIcon />
																		: state === "conditional"
																		? <ConditionalIcon />
																		: <LockIcon />}
																</span>
															</button>
														</Tooltip>
													</div>
												);
											})}
										</div>
									);
								})}
							</div>
						</div>
						{/* #endregion */}

						{dirty.value && (
							<p class="wsp-matrix__dirty" role="status">
								<span class="wsp-matrix__dirty-text">
									Unsaved role changes — save each row you edited.
								</span>
							</p>
						)}
						{error.value && <p class="wsp-create__error" role="alert">{error.value}</p>}

						{/* #region Custom-role composer */}
						{canManage && (
							<div class="wsp-roleeditor">
								{composing.value
									? (
										<>
											<div class="wsp-roleeditor__head">
												<span class="wsp-roleeditor__label">
													<span aria-hidden="true">{cloneGlyph(RoleGlyph)}</span>
													New custom role
												</span>
											</div>
											<div class="wsp-roleeditor__field">
												<label class="wsp-roleeditor__label" for="wsp-role-name">Name</label>
												<InputText
													id="wsp-role-name"
													value={newName}
													onValueChange={(v) => {
														newName.value = v;
													}}
													placeholder="Purchaser"
													block
													maxLength={48}
												/>
												<p class="wsp-roleeditor__hint">
													{seedFrom.value
														? "It starts as a copy of the row you duplicated — edit its cells afterwards."
														: "It starts with no permissions — tick what it should allow afterwards."}
												</p>
											</div>
											<div class="wsp-roleeditor__actions">
												<Button
													variant="text"
													label="Cancel"
													onClick={() => {
														composing.value = false;
														newName.value = "";
														seedFrom.value = null;
													}}
												/>
												<Button
													variant="filled"
													label={saving.value ? "Creating…" : "Create role"}
													disabled={saving.value}
													onClick={createRole}
												/>
											</div>
										</>
									)
									: (
										<button
											type="button"
											class="wsp-roleeditor__label"
											onClick={() => {
												composing.value = true;
											}}
										>
											<span aria-hidden="true">{cloneGlyph(PlusGlyph)}</span>
											New custom role
										</button>
									)}
							</div>
						)}
						{/* #endregion */}
					</div>
				</section>
			</div>
		</div>
	);
}

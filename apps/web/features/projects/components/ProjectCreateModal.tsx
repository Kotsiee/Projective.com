import type { JSX } from "preact";
import "../styles/project-create-modal.css";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import { Button, InputText, SelectButton } from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { DndContext, useSortable } from "@projective/ui/dnd";
import type { Option } from "@projective/ui/fields";
import { ProjectSidebarService } from "../core/ProjectSidebarService.ts";
import type { CreateProject, ProjectCreateFormat, ProjectView } from "../types/projects-types.ts";
import { CloseIcon, PlusIcon, TrashIcon } from "./glyphs.tsx";

/**
 * ProjectCreateModal — the lightweight, 2-panel "Create Project" surface launched from the lane's
 * `proj-lane__create` menu (replacing the old `/projects/create` page). It embodies the platform's
 * quick-creation philosophy: only the **Project Name** is a hard (RED) requirement — a name-only
 * project is a valid draft — while every richer detail (description, stages, roles, budget) is the
 * AMBER *publishing* gate: optional to draft, needed before posting to Explore / opening for hiring.
 *
 * LEFT panel = general project details (name · rich-text description · type toggle · a drag-reorderable
 * Stage Manager for Pipeline/One-off, or a Roles list for Direct Deliverable). RIGHT panel is hidden
 * until a stage/role is selected, then hosts its contextual configuration. Rendered through
 * {@link BodyPortal} so its `position: fixed` chrome never re-bases onto the blurred shell (the
 * glass-blur trap). STUB persistence — the payload is Zod-validated (`CreateProjectSchema`) and POSTed
 * to `/api/projects/create`, which drafts a slug; the live escrow/stage wiring lands behind
 * `PROJECTS_BACKEND_LIVE`.
 */

// #region Local draft shapes (id-keyed for stable DnD + selection)
interface StageDraft {
	id: string;
	name: string;
	/** Rich-text scope (semantic HTML). */
	description: string;
	milestone: string;
	/** Ticket price / workload intensity, in dollars as typed. */
	unitPrice: string;
}
interface RoleDraft {
	id: string;
	name: string;
	skills: string[];
}
type Selection = { kind: "stage"; id: string } | { kind: "role"; id: string } | null;
// #endregion

export interface ProjectCreateModalProps {
	open: boolean;
	/** Preset work-flow from the create menu; the toggle can still change it. */
	initialFormat: ProjectCreateFormat;
	/** Which lane tab launched it — tunes copy (project vs service). */
	view: ProjectView;
	/** Active workspace id → the created engagement's `scopeId`. */
	scopeId: string;
	onClose: () => void;
	/** Called with the drafted engagement's slug once the create succeeds. */
	onCreated: (slug: string) => void;
}

const TYPE_OPTIONS: Option[] = [
	{ label: "Pipeline", value: "pipeline" },
	{ label: "One-Off", value: "one_off" },
	{ label: "Direct Deliverable", value: "direct_deliverable" },
];

const TYPE_HINT: Record<ProjectCreateFormat, string> = {
	pipeline: "A multi-stage workflow with per-stage ticket limits.",
	one_off: "A milestone-based deliverable, one stage at a time.",
	direct_deliverable: "A single mini-task — no stages, with optional team roles.",
};

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
	const next = arr.slice();
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

/** One drag-reorderable stage row in the left-panel Stage Manager. */
function StageRow(props: {
	stage: StageDraft;
	index: number;
	active: boolean;
	onSelect: () => void;
	onRemove: () => void;
}): JSX.Element {
	const sortable = useSortable({
		id: `stage:${props.stage.id}`,
		data: { type: "stage", accepts: ["stage"] },
		roleDescription: "stage",
	});
	return (
		<li
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="pcm-stage"
			data-active={props.active || undefined}
			data-dragging={sortable.isDragging.value || undefined}
			data-over={sortable.isOver.value || undefined}
		>
			<button
				type="button"
				class="pcm-stage__grip"
				aria-label={`Reorder ${props.stage.name}`}
				aria-roledescription={sortable.attributes["aria-roledescription"]}
				tabIndex={sortable.attributes.tabIndex}
				onPointerDown={sortable.listeners.onPointerDown}
				onKeyDown={sortable.listeners.onKeyDown}
			>
				<span aria-hidden="true">⠿</span>
			</button>
			<button type="button" class="pcm-stage__main" onClick={props.onSelect}>
				<span class="pcm-stage__index" aria-hidden="true">{props.index + 1}</span>
				<span class="pcm-stage__name">{props.stage.name || "Untitled stage"}</span>
			</button>
			<button
				type="button"
				class="pcm-stage__remove"
				aria-label={`Remove ${props.stage.name}`}
				onClick={props.onRemove}
			>
				{TrashIcon}
			</button>
		</li>
	);
}

/** A skills tag editor (Direct Deliverable role config). */
function SkillTags(
	{ skills, onChange }: { skills: string[]; onChange: (next: string[]) => void },
): JSX.Element {
	const draft = useSignal("");
	const add = () => {
		const t = draft.value.trim();
		if (t && !skills.includes(t)) onChange([...skills, t].slice(0, 20));
		draft.value = "";
	};
	return (
		<div class="pcm-tags">
			{skills.map((s) => (
				<span key={s} class="pcm-tags__chip">
					{s}
					<button
						type="button"
						class="pcm-tags__x"
						aria-label={`Remove skill ${s}`}
						onClick={() => onChange(skills.filter((x) => x !== s))}
					>
						{CloseIcon}
					</button>
				</span>
			))}
			<input
				class="pcm-tags__input"
				placeholder="Add a skill…"
				value={draft.value}
				onInput={(e) => (draft.value = (e.target as HTMLInputElement).value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === ",") {
						e.preventDefault();
						add();
					}
				}}
				onBlur={add}
			/>
		</div>
	);
}

export function ProjectCreateModal(props: ProjectCreateModalProps): JSX.Element | null {
	const { open, initialFormat, view, scopeId, onClose, onCreated } = props;

	const { mounted, state } = usePresence(open);
	const stack = useOverlayStack({ active: mounted, lockScroll: true });
	const panelRef = useRef<HTMLDivElement>(null);
	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({ open: mounted, onDismiss: onClose, panelRef, closeOnOutside: false });

	const title = useSignal("");
	const description = useSignal("");
	const format = useSignal<ProjectCreateFormat>(initialFormat);
	const stages = useSignal<StageDraft[]>([]);
	const roles = useSignal<RoleDraft[]>([]);
	const selection = useSignal<Selection>(null);
	const submitting = useSignal(false);
	const error = useSignal<string | null>(null);

	// Seed the form whenever the modal (re)opens with a preset type.
	useEffect(() => {
		if (!open) return;
		title.value = "";
		description.value = "";
		format.value = initialFormat;
		stages.value = [];
		roles.value = [];
		selection.value = null;
		submitting.value = false;
		error.value = null;
	}, [open, initialFormat]);

	if (!mounted) return null;

	const fmt = format.value;
	const isDirect = fmt === "direct_deliverable";
	const titleEmpty = title.value.trim().length === 0;
	const descEmpty = description.value.trim().length === 0;
	const canSubmit = !titleEmpty && !submitting.value;

	const setFormat = (v: string | string[]) => {
		format.value = v as ProjectCreateFormat;
		selection.value = null; // stage/role selection can't survive a format switch
	};

	// #region Stage ops
	const addStage = () => {
		const id = nextId("stg");
		const n = stages.value.length + 1;
		stages.value = [...stages.value, {
			id,
			name: fmt === "one_off" ? `Milestone ${n}` : `Stage ${n}`,
			description: "",
			milestone: "",
			unitPrice: "",
		}];
		selection.value = { kind: "stage", id };
	};
	const patchStage = (id: string, patch: Partial<StageDraft>) => {
		stages.value = stages.value.map((s) => (s.id === id ? { ...s, ...patch } : s));
	};
	const removeStage = (id: string) => {
		stages.value = stages.value.filter((s) => s.id !== id);
		if (selection.value?.kind === "stage" && selection.value.id === id) selection.value = null;
	};
	const onStageDragEnd = (activeId: string | null, overId: string | null) => {
		if (!activeId || !overId || activeId === overId) return;
		const strip = (id: string) => id.replace("stage:", "");
		const from = stages.value.findIndex((s) => s.id === strip(activeId));
		const to = stages.value.findIndex((s) => s.id === strip(overId));
		if (from === -1 || to === -1) return;
		stages.value = arrayMove(stages.value, from, to);
	};
	// #endregion

	// #region Role ops
	const addRole = () => {
		const id = nextId("role");
		roles.value = [...roles.value, { id, name: `Role ${roles.value.length + 1}`, skills: [] }];
		selection.value = { kind: "role", id };
	};
	const patchRole = (id: string, patch: Partial<RoleDraft>) => {
		roles.value = roles.value.map((r) => (r.id === id ? { ...r, ...patch } : r));
	};
	const removeRole = (id: string) => {
		roles.value = roles.value.filter((r) => r.id !== id);
		if (selection.value?.kind === "role" && selection.value.id === id) selection.value = null;
	};
	// #endregion

	const buildPayload = (): CreateProject => ({
		title: title.value.trim(),
		format: fmt,
		scopeType: "personal",
		scopeId,
		scope: descEmpty ? "" : description.value,
		budget: null,
		stages: isDirect ? [] : stages.value.map((s) => ({
			name: s.name.trim() || "Untitled stage",
			description: s.description,
			milestone: s.milestone.trim(),
			unitPriceCents: s.unitPrice ? Math.round(Number.parseFloat(s.unitPrice) * 100) : null,
		})),
		roles: isDirect
			? roles.value.map((r) => ({ name: r.name.trim() || "Untitled role", skills: r.skills }))
			: [],
	});

	const submit = async () => {
		if (!canSubmit) return;
		submitting.value = true;
		error.value = null;
		const res = await ProjectSidebarService.create(buildPayload());
		submitting.value = false;
		if (res.ok && res.data) {
			onCreated(res.data.slug);
		} else {
			error.value = res.message ?? "Couldn't create the project. Try again.";
		}
	};

	const activeStage = selection.value?.kind === "stage"
		? stages.value.find((s) => s.id === selection.value?.id) ?? null
		: null;
	const activeRole = selection.value?.kind === "role"
		? roles.value.find((r) => r.id === selection.value?.id) ?? null
		: null;
	const rightOpen = activeStage !== null || activeRole !== null;

	const nounCap = view === "engagements" ? "Service" : "Project";

	return (
		<BodyPortal>
			<div class="pcm" data-state={state} style={`z-index:${stack.zIndex}`}>
				<Backdrop visible={state === "open"} blur onClick={onClose} />
				<div
					ref={panelRef}
					class="pcm__panel"
					data-state={state}
					role="dialog"
					aria-modal="true"
					aria-label={`Create ${nounCap.toLowerCase()}`}
					tabIndex={-1}
				>
					<header class="pcm__top">
						<h2 class="pcm__heading">New {nounCap.toLowerCase()}</h2>
						<button type="button" class="pcm__close" aria-label="Close" onClick={onClose}>
							{CloseIcon}
						</button>
					</header>

					<div class="pcm__body" data-right={rightOpen ? "true" : undefined}>
						{/* LEFT — general project details */}
						<section class="pcm__left">
							<div class="pcm__section">
								<label class="pcm__label" for="pcm-name">
									{nounCap} name
									<span class="pcm__req" title="Required to create">Required</span>
								</label>
								<InputText
									id="pcm-name"
									value={title}
									placeholder={`Name your ${nounCap.toLowerCase()}`}
									block
									maxLength={160}
									status={titleEmpty ? "required" : "default"}
									aria-label={`${nounCap} name`}
								/>
							</div>

							<div class="pcm__section">
								<label class="pcm__label">
									Description
									<span class="pcm__gate" title="Needed before publishing to Explore">
										Publishing
									</span>
								</label>
								<RichTextEditor
									value={description}
									placeholder="Describe the work, goals and context…"
									status={descEmpty ? "gate" : "default"}
									minRows={4}
									aria-label={`${nounCap} description`}
								/>
							</div>

							<div class="pcm__section">
								<span class="pcm__label">Project type</span>
								<SelectButton
									options={TYPE_OPTIONS}
									value={format.value}
									onValueChange={setFormat}
									aria-label="Project type"
								/>
								<p class="pcm__hint">{TYPE_HINT[fmt]}</p>
							</div>

							{/* Stage Manager (Pipeline / One-off) OR Roles (Direct Deliverable) */}
							{isDirect
								? (
									<div class="pcm__section pcm__section--grow">
										<div class="pcm__managerhead">
											<span class="pcm__label">Team roles</span>
											<span class="pcm__gate">Optional</span>
										</div>
										<ul class="pcm-list" aria-label="Team roles">
											{roles.value.map((r) => (
												<li
													key={r.id}
													class="pcm-stage"
													data-active={selection.value?.kind === "role" &&
															selection.value.id === r.id || undefined}
												>
													<button
														type="button"
														class="pcm-stage__main pcm-stage__main--norole"
														onClick={() => (selection.value = { kind: "role", id: r.id })}
													>
														<span class="pcm-stage__name">{r.name || "Untitled role"}</span>
														{r.skills.length > 0 && (
															<span class="pcm-stage__meta">{r.skills.length} skills</span>
														)}
													</button>
													<button
														type="button"
														class="pcm-stage__remove"
														aria-label={`Remove ${r.name}`}
														onClick={() => removeRole(r.id)}
													>
														{TrashIcon}
													</button>
												</li>
											))}
											{roles.value.length === 0 && (
												<li class="pcm-list__empty">
													No roles yet — a Direct Deliverable can be claimed without them.
												</li>
											)}
										</ul>
										<button type="button" class="pcm__add" onClick={addRole}>
											<span class="pcm__add-icon" aria-hidden="true">{PlusIcon}</span>
											Add role
										</button>
									</div>
								)
								: (
									<div class="pcm__section pcm__section--grow">
										<div class="pcm__managerhead">
											<span class="pcm__label">
												{fmt === "one_off" ? "Milestones" : "Stages"}
											</span>
											<span class="pcm__gate">Optional</span>
										</div>
										<DndContext
											onDragEnd={(e) => onStageDragEnd(e.active.id, e.canceled ? null : e.over)}
										>
											<ul class="pcm-list" aria-label="Project stages">
												{stages.value.map((s, i) => (
													<StageRow
														key={s.id}
														stage={s}
														index={i}
														active={selection.value?.kind === "stage" &&
															selection.value.id === s.id}
														onSelect={() => (selection.value = { kind: "stage", id: s.id })}
														onRemove={() => removeStage(s.id)}
													/>
												))}
												{stages.value.length === 0 && (
													<li class="pcm-list__empty">
														No stages yet — add one to shape the workflow, or leave it for later.
													</li>
												)}
											</ul>
										</DndContext>
										<button type="button" class="pcm__add" onClick={addStage}>
											<span class="pcm__add-icon" aria-hidden="true">{PlusIcon}</span>
											Add {fmt === "one_off" ? "milestone" : "stage"}
										</button>
									</div>
								)}
						</section>

						{/* RIGHT — contextual stage / role config (hidden until a selection is made) */}
						{rightOpen && (
							<aside class="pcm__right">
								{activeStage && (
									<div class="pcm__section">
										<div class="pcm__stagehead">
											<button
												type="button"
												class="pcm__back"
												onClick={() => (selection.value = null)}
											>
												‹ Back
											</button>
											<h3 class="pcm__stagetitle">Configure stage</h3>
										</div>
										<div class="pcm__section">
											<label class="pcm__label" for="pcm-stage-title">Stage title</label>
											<InputText
												id="pcm-stage-title"
												value={activeStage.name}
												onValueChange={(v: string) => patchStage(activeStage.id, { name: v })}
												block
												maxLength={120}
												placeholder="e.g. Discovery"
											/>
										</div>
										<div class="pcm__section">
											<label class="pcm__label">
												Scope <span class="pcm__gate">Publishing</span>
											</label>
											<RichTextEditor
												key={activeStage.id}
												value={activeStage.description}
												onValueChange={(v: string) =>
													patchStage(activeStage.id, { description: v })}
												placeholder="Deliverables, acceptance criteria, delivery notes…"
												status={activeStage.description.trim() ? "default" : "gate"}
												minRows={3}
												aria-label="Stage scope"
											/>
										</div>
										<div class="pcm__row">
											<div class="pcm__field">
												<label class="pcm__label" for="pcm-stage-mile">
													Delivery / timeline
												</label>
												<InputText
													id="pcm-stage-mile"
													value={activeStage.milestone}
													onValueChange={(v: string) =>
														patchStage(activeStage.id, { milestone: v })}
													block
													placeholder="e.g. 2 weeks"
												/>
											</div>
											<div class="pcm__field">
												<label class="pcm__label" for="pcm-stage-price">
													Ticket price / intensity
													<span class="pcm__gate">Publishing</span>
												</label>
												<InputText
													id="pcm-stage-price"
													value={activeStage.unitPrice}
													onValueChange={(v: string) =>
														patchStage(activeStage.id, { unitPrice: v })}
													block
													status={activeStage.unitPrice.trim() ? "default" : "gate"}
													placeholder="USD, e.g. 250"
												/>
											</div>
										</div>
									</div>
								)}

								{activeRole && (
									<div class="pcm__section">
										<div class="pcm__stagehead">
											<button
												type="button"
												class="pcm__back"
												onClick={() => (selection.value = null)}
											>
												‹ Back
											</button>
											<h3 class="pcm__stagetitle">Configure role</h3>
										</div>
										<div class="pcm__section">
											<label class="pcm__label" for="pcm-role-name">Role name</label>
											<InputText
												id="pcm-role-name"
												value={activeRole.name}
												onValueChange={(v: string) => patchRole(activeRole.id, { name: v })}
												block
												maxLength={120}
												placeholder="e.g. Lead, Specialist"
											/>
										</div>
										<div class="pcm__section">
											<span class="pcm__label">Skill requirements</span>
											<SkillTags
												skills={activeRole.skills}
												onChange={(next) => patchRole(activeRole.id, { skills: next })}
											/>
										</div>
									</div>
								)}
							</aside>
						)}
					</div>

					<footer class="pcm__foot">
						<p class="pcm__gatemsg" role="status" data-tone={titleEmpty ? "required" : "gate"}>
							{error.value
								? error.value
								: titleEmpty
								? `Name your ${nounCap.toLowerCase()} to create it.`
								: `Draft ready. Add a description, ${
									isDirect ? "roles" : "stages"
								} and budget before publishing to Explore.`}
						</p>
						<div class="pcm__actions">
							<Button variant="text" label="Cancel" onClick={onClose} />
							<Button
								variant="filled"
								severity="primary"
								label={submitting.value ? "Creating…" : `Create ${nounCap.toLowerCase()}`}
								loading={submitting.value}
								disabled={!canSubmit}
								onClick={submit}
							/>
						</div>
					</footer>
				</div>
			</div>
		</BodyPortal>
	);
}

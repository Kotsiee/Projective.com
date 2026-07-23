import { cloneElement, type JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/project-showcase.css";
import { Button, InputText, SelectButton } from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { DndContext, useSortable } from "@projective/ui/dnd";
import type { Option } from "@projective/ui/fields";
import { ChevronIcon, CloseIcon, PlusIcon, TrashIcon } from "../components/glyphs.tsx";
import type { ProjectFormat } from "../types/projects-types.ts";

/**
 * ProjectEditor — the CLIENT/owner's full-page project editor (`/projects/[projectId]/edit`, root brief
 * §Part 1.1). It is the sibling of the `ProjectCreateModal` (it reuses the same field primitives, the
 * same `@projective/ui/dnd` stage reordering, and the same two-tier creation-gate treatment — RED
 * `required` for the name, AMBER `gate` for the publishing details), but rendered inline as a page and
 * **pre-populated** from the existing engagement. The client can modify the name, rich-text description,
 * project type, budget, and the stage sequence / required roles.
 *
 * The route guards `viewerIsClient` server-side, so only the owner ever reaches this. Persistence is a
 * STUB — an optimistic in-island save with a confirmation, matching the codebase's stub-first pattern
 * (`ProjectCreateModal` → `/api/projects/create`, `CreateStageModal.onCreate`); the live
 * `projects.update_project` write lands behind `PROJECTS_BACKEND_LIVE`.
 */

// #region Local draft shapes (id-keyed for stable DnD + expansion)
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
/** The editor's own format vocabulary (mirrors `ProjectCreateFormat`; `session` maps to one-off here). */
type EditorFormat = "pipeline" | "one_off" | "direct_deliverable";
// #endregion

export interface ProjectEditorProps {
	slug: string;
	/** Pre-populated engagement fields (server-resolved from the project detail). */
	initialTitle: string;
	initialDescription: string;
	initialFormat: ProjectFormat;
	/** The real stage names/order from the channel tree — everything else starts blank (to be filled in). */
	initialStages: { id: string; name: string }[];
}

const TYPE_OPTIONS: Option[] = [
	{ label: "Pipeline", value: "pipeline" },
	{ label: "One-Off", value: "one_off" },
	{ label: "Direct Deliverable", value: "direct_deliverable" },
];

const TYPE_HINT: Record<EditorFormat, string> = {
	pipeline: "A multi-stage workflow with per-stage ticket limits.",
	one_off: "A milestone-based deliverable, one stage at a time.",
	direct_deliverable: "A single mini-task — no stages, with optional team roles.",
};

/** Map a stored `ProjectFormat` onto the editor's vocabulary (sessions edit as a one-off deliverable). */
function toEditorFormat(f: ProjectFormat): EditorFormat {
	return f === "pipeline" ? "pipeline" : "one_off";
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
	const next = arr.slice();
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

// #region Stage row (drag-reorderable + inline-expandable config)
function StageRow(props: {
	stage: StageDraft;
	index: number;
	open: boolean;
	oneOff: boolean;
	onToggle: () => void;
	onPatch: (patch: Partial<StageDraft>) => void;
	onRemove: () => void;
}): JSX.Element {
	const { stage } = props;
	const sortable = useSortable({
		id: `stage:${stage.id}`,
		data: { type: "stage", accepts: ["stage"] },
		roleDescription: "stage",
	});
	const priced = stage.unitPrice.trim().length > 0;
	const scoped = stage.description.trim().length > 0;
	return (
		<li
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="proj-estage"
			data-open={props.open || undefined}
			data-dragging={sortable.isDragging.value || undefined}
			data-over={sortable.isOver.value || undefined}
		>
			<div class="proj-estage__row">
				<button
					type="button"
					class="proj-estage__grip"
					aria-label={`Reorder ${stage.name || "stage"}`}
					aria-roledescription={sortable.attributes["aria-roledescription"]}
					tabIndex={sortable.attributes.tabIndex}
					onPointerDown={sortable.listeners.onPointerDown}
					onKeyDown={sortable.listeners.onKeyDown}
				>
					<span aria-hidden="true">⠿</span>
				</button>
				<button
					type="button"
					class="proj-estage__main"
					aria-expanded={props.open}
					onClick={props.onToggle}
				>
					<span class="proj-estage__index" aria-hidden="true">{props.index + 1}</span>
					<span class="proj-estage__name">{stage.name || "Untitled stage"}</span>
					{!scoped && <span class="proj-estage__gate" data-tone="gate">Needs scope</span>}
					{!priced && <span class="proj-estage__gate" data-tone="gate">Needs pricing</span>}
					<span class="proj-estage__chev" aria-hidden="true">{cloneElement(ChevronIcon)}</span>
				</button>
				<button
					type="button"
					class="proj-estage__remove"
					aria-label={`Remove ${stage.name || "stage"}`}
					onClick={props.onRemove}
				>
					{cloneElement(TrashIcon)}
				</button>
			</div>

			{props.open && (
				<div class="proj-estage__body">
					<div class="proj-editor__field">
						<label class="proj-editor__label">
							{props.oneOff ? "Milestone" : "Stage"} title
						</label>
						<InputText
							value={stage.name}
							onValueChange={(v: string) => props.onPatch({ name: v })}
							block
							maxLength={120}
							placeholder="e.g. Discovery"
						/>
					</div>
					<div class="proj-editor__field">
						<label class="proj-editor__label">
							Scope <span class="proj-editor__gate">Publishing</span>
						</label>
						<RichTextEditor
							key={stage.id}
							value={stage.description}
							onValueChange={(v: string) => props.onPatch({ description: v })}
							placeholder="Deliverables, acceptance criteria, delivery notes…"
							status={scoped ? "default" : "gate"}
							minRows={3}
							aria-label="Stage scope"
						/>
					</div>
					<div class="proj-editor__row">
						<div class="proj-editor__field">
							<label class="proj-editor__label">Delivery / timeline</label>
							<InputText
								value={stage.milestone}
								onValueChange={(v: string) => props.onPatch({ milestone: v })}
								block
								placeholder="e.g. 2 weeks"
							/>
						</div>
						<div class="proj-editor__field">
							<label class="proj-editor__label">
								Ticket price <span class="proj-editor__gate">Publishing</span>
							</label>
							<InputText
								value={stage.unitPrice}
								onValueChange={(v: string) => props.onPatch({ unitPrice: v })}
								block
								status={priced ? "default" : "gate"}
								placeholder="USD, e.g. 250"
							/>
						</div>
					</div>
				</div>
			)}
		</li>
	);
}
// #endregion

// #region Role skills tag editor
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
		<div class="proj-etags">
			{skills.map((s) => (
				<span key={s} class="proj-etags__chip">
					{s}
					<button
						type="button"
						class="proj-etags__x"
						aria-label={`Remove skill ${s}`}
						onClick={() => onChange(skills.filter((x) => x !== s))}
					>
						{cloneElement(CloseIcon)}
					</button>
				</span>
			))}
			<input
				class="proj-etags__input"
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
// #endregion

export default function ProjectEditor(props: ProjectEditorProps): JSX.Element {
	const title = useSignal(props.initialTitle);
	const description = useSignal(props.initialDescription);
	const format = useSignal<EditorFormat>(toEditorFormat(props.initialFormat));
	const stages = useSignal<StageDraft[]>(
		props.initialStages.map((s) => ({
			id: s.id,
			name: s.name,
			description: "",
			milestone: "",
			unitPrice: "",
		})),
	);
	const roles = useSignal<RoleDraft[]>([]);
	const openStage = useSignal<string | null>(props.initialStages[0]?.id ?? null);
	/** Editor lifecycle: `idle` (untouched since last save), `dirty` (unsaved edits), `saved`. */
	const state = useSignal<"idle" | "dirty" | "saved">("idle");

	const fmt = format.value;
	const isDirect = fmt === "direct_deliverable";
	const titleEmpty = title.value.trim().length === 0;
	const backHref = `/projects/${props.slug}`;

	const markDirty = () => {
		if (state.value !== "dirty") state.value = "dirty";
	};

	const setFormat = (v: string | string[]) => {
		format.value = v as EditorFormat;
		markDirty();
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
		openStage.value = id;
		markDirty();
	};
	const patchStage = (id: string, patch: Partial<StageDraft>) => {
		stages.value = stages.value.map((s) => (s.id === id ? { ...s, ...patch } : s));
		markDirty();
	};
	const removeStage = (id: string) => {
		stages.value = stages.value.filter((s) => s.id !== id);
		if (openStage.value === id) openStage.value = null;
		markDirty();
	};
	const onStageDragEnd = (activeId: string | null, overId: string | null) => {
		if (!activeId || !overId || activeId === overId) return;
		const strip = (id: string) => id.replace("stage:", "");
		const from = stages.value.findIndex((s) => s.id === strip(activeId));
		const to = stages.value.findIndex((s) => s.id === strip(overId));
		if (from === -1 || to === -1) return;
		stages.value = arrayMove(stages.value, from, to);
		markDirty();
	};
	// #endregion

	// #region Role ops
	const addRole = () => {
		const id = nextId("role");
		roles.value = [...roles.value, { id, name: `Role ${roles.value.length + 1}`, skills: [] }];
		markDirty();
	};
	const patchRole = (id: string, patch: Partial<RoleDraft>) => {
		roles.value = roles.value.map((r) => (r.id === id ? { ...r, ...patch } : r));
		markDirty();
	};
	const removeRole = (id: string) => {
		roles.value = roles.value.filter((r) => r.id !== id);
		markDirty();
	};
	// #endregion

	const save = () => {
		if (titleEmpty) return;
		// STUB: persistence is deferred to the live `projects.update_project` write (behind
		// `PROJECTS_BACKEND_LIVE`), mirroring the Create modal + CreateStageModal stubs. The edits live in
		// the island; a full navigation to Preview reloads the server-resolved (unchanged) projection.
		state.value = "saved";
	};

	const statusText = titleEmpty
		? "Name your project to save it."
		: state.value === "saved"
		? "All changes saved."
		: state.value === "dirty"
		? "Unsaved changes."
		: "Draft ready. Add scope, pricing and roles before publishing to Explore.";

	return (
		<div class="vw proj-editor">
			<div class="vw__back-row vw__back-row--laned">
				<a class="vw__back" href={backHref}>← Back to preview</a>
			</div>

			<header class="proj-editor__head">
				<h1 class="proj-editor__title">Edit project</h1>
				<p class="proj-editor__lede">
					Everything here shapes how freelancers see and apply to this project. Only the name is
					required to save — the rest is the publishing gate.
				</p>
			</header>

			<section class="proj-editor__section">
				<label class="proj-editor__label" for="pe-name">
					Project name <span class="proj-editor__req" title="Required to save">Required</span>
				</label>
				<InputText
					id="pe-name"
					value={title}
					placeholder="Name your project"
					block
					maxLength={160}
					status={titleEmpty ? "required" : "default"}
					aria-label="Project name"
					onValueChange={markDirty}
				/>
			</section>

			<section class="proj-editor__section">
				<label class="proj-editor__label">
					Description{" "}
					<span class="proj-editor__gate" title="Needed before publishing">Publishing</span>
				</label>
				<RichTextEditor
					value={description}
					placeholder="Describe the work, goals and context…"
					status={description.value.trim() ? "default" : "gate"}
					minRows={5}
					aria-label="Project description"
					onValueChange={markDirty}
				/>
			</section>

			<section class="proj-editor__section">
				<span class="proj-editor__label">Project type</span>
				<SelectButton
					options={TYPE_OPTIONS}
					value={format.value}
					onValueChange={setFormat}
					aria-label="Project type"
				/>
				<p class="proj-editor__hint">{TYPE_HINT[fmt]}</p>
			</section>

			{isDirect
				? (
					<section class="proj-editor__section">
						<div class="proj-editor__managerhead">
							<span class="proj-editor__label">Team roles</span>
							<span class="proj-editor__gate">Optional</span>
						</div>
						<ul class="proj-elist" aria-label="Team roles">
							{roles.value.map((r) => (
								<li key={r.id} class="proj-erole">
									<div class="proj-erole__head">
										<InputText
											value={r.name}
											onValueChange={(v: string) => patchRole(r.id, { name: v })}
											block
											maxLength={120}
											placeholder="e.g. Lead Designer"
											aria-label="Role name"
										/>
										<button
											type="button"
											class="proj-estage__remove"
											aria-label={`Remove ${r.name}`}
											onClick={() => removeRole(r.id)}
										>
											{cloneElement(TrashIcon)}
										</button>
									</div>
									<SkillTags
										skills={r.skills}
										onChange={(next) => patchRole(r.id, { skills: next })}
									/>
								</li>
							))}
							{roles.value.length === 0 && (
								<li class="proj-elist__empty">
									No roles yet — a Direct Deliverable can be claimed without them.
								</li>
							)}
						</ul>
						<button type="button" class="proj-editor__add" onClick={addRole}>
							<span class="proj-editor__add-icon" aria-hidden="true">{cloneElement(PlusIcon)}</span>
							Add role
						</button>
					</section>
				)
				: (
					<section class="proj-editor__section">
						<div class="proj-editor__managerhead">
							<span class="proj-editor__label">{fmt === "one_off" ? "Milestones" : "Stages"}</span>
							<span class="proj-editor__gate">Publishing</span>
						</div>
						<DndContext
							onDragEnd={(e) => onStageDragEnd(e.active.id, e.canceled ? null : e.over)}
						>
							<ul class="proj-elist" aria-label="Project stages">
								{stages.value.map((s, i) => (
									<StageRow
										key={s.id}
										stage={s}
										index={i}
										open={openStage.value === s.id}
										oneOff={fmt === "one_off"}
										onToggle={() => (openStage.value = openStage.value === s.id ? null : s.id)}
										onPatch={(patch) => patchStage(s.id, patch)}
										onRemove={() => removeStage(s.id)}
									/>
								))}
								{stages.value.length === 0 && (
									<li class="proj-elist__empty">
										No stages yet — add one to shape the workflow, or leave it for later.
									</li>
								)}
							</ul>
						</DndContext>
						<button type="button" class="proj-editor__add" onClick={addStage}>
							<span class="proj-editor__add-icon" aria-hidden="true">{cloneElement(PlusIcon)}</span>
							Add {fmt === "one_off" ? "milestone" : "stage"}
						</button>
					</section>
				)}

			<footer class="proj-editor__foot">
				<p class="proj-editor__status" role="status" data-tone={titleEmpty ? "required" : "gate"}>
					{statusText}
				</p>
				<div class="proj-editor__actions">
					<a class="proj-editor__cancel" href={backHref}>Cancel</a>
					<Button
						variant="filled"
						severity="primary"
						label={state.value === "saved" ? "Saved" : "Save changes"}
						disabled={titleEmpty}
						onClick={save}
					/>
				</div>
			</footer>
		</div>
	);
}

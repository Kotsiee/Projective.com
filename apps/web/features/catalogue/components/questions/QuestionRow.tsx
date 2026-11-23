import type { JSX } from "preact";
import { DropIndicator, useSortable } from "@projective/ui/dnd";
import { Button, InputText, Select, ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { type IntakeField, IntakeFieldKind } from "@projective/types/services";
import {
	canBeFollowed,
	INTAKE_KIND_LABELS,
	type IntakeNode,
	withKind,
} from "../../core/intake-model.ts";
import { QuestionFacets } from "./QuestionFacets.tsx";
import { FollowUpRule } from "./FollowUpRule.tsx";
import { AddQuestionMenu, KIND_ICONS, PALETTE_DRAG } from "./QuestionPalette.tsx";

const KIND_OPTIONS = IntakeFieldKind.options.map((value) => ({
	label: INTAKE_KIND_LABELS[value],
	value,
}));

/** The drag type a question row carries. */
export const QUESTION_DRAG = "question";

/** The drag id of question `id`. */
export const questionDragId = (id: string) => `q:${id}`;

/** The question id a row's drag id names, or `null`. */
export function questionOfDragId(id: unknown): string | null {
	const raw = String(id);
	return raw.startsWith("q:") && raw !== END_DROP_ID ? raw.slice(2) : null;
}

/** The canvas's end zone, where a palette drop appends. */
export const END_DROP_ID = "q:end";

/** What every row is drawn with. */
export interface QuestionRowContext {
	nodes: readonly IntakeNode[];
	locked: boolean;
	full: boolean;
	currency: string;
	/** The id of the question a problem is placed on, and its sentence. */
	problem: { fieldId: string; message: string } | null;
	/** The row a drag is over, and which side of it the drop would land on. */
	seam: { id: string; side: "before" | "after" } | null;
	onChange: (field: IntakeField) => void;
	onRemove: (id: string) => void;
	onAddFollowUp: (parentId: string, kind: IntakeFieldKind) => void;
}

/**
 * QuestionRow — one buyer question in the builder (Decision #525), its follow-ups drawn beneath it
 * as a branch indented on a 2px hairline guide (never a nested card). The head spreads the drag grip,
 * the question's glyph and number at the start and Required and Remove at the end; then its wording,
 * its answer type, a hint, what its kind needs, and for a follow-up when it is asked. A yes/no or a
 * choice offers "Add follow-up". Locked by publishing, only the wording, options, starting value and
 * pricing stay editable.
 */
export function QuestionRow(props: { node: IntakeNode; ctx: QuestionRowContext }): JSX.Element {
	const { node, ctx } = props;
	const { field } = node;
	const { locked } = ctx;
	const position = node.index + 1;
	const base = `cat-qb-${field.id}`;
	const name = field.label.trim() || `Question ${position}`;
	const parent = node.parentId ? ctx.nodes.find((n) => n.field.id === node.parentId)?.field : null;
	const children = ctx.nodes.filter((n) => n.parentId === field.id);
	const problem = ctx.problem?.fieldId === field.id ? ctx.problem.message : null;
	const patch = (next: Partial<IntakeField>) => ctx.onChange({ ...field, ...next });
	const sortable = useSortable({
		id: questionDragId(field.id),
		data: { type: QUESTION_DRAG, accepts: [QUESTION_DRAG, PALETTE_DRAG] },
		roleDescription: "question",
		disabled: locked,
	});
	const seam = ctx.seam?.id === field.id ? ctx.seam.side : null;

	return (
		<li class="cat-qb__item" data-depth={node.depth}>
			<DropIndicator active={seam === "before"} />
			<div
				// deno-lint-ignore no-explicit-any
				ref={sortable.setNodeRef as any}
				class="cat-qb__question"
				data-dragging={sortable.isDragging.value || undefined}
			>
				<div class="cat-qb__head">
					<span class="cat-qb__lead">
						{!locked && (
							<button
								type="button"
								class="cat-offer__grip"
								aria-label={`Reorder ${name}`}
								aria-roledescription={sortable.attributes["aria-roledescription"]}
								tabIndex={sortable.attributes.tabIndex}
								onPointerDown={sortable.listeners.onPointerDown}
								onKeyDown={sortable.listeners.onKeyDown}
							>
								<Icon name="grip" size="xs" />
							</button>
						)}
						<Icon name={KIND_ICONS[field.kind]} size="sm" class="cat-qb__glyph" />
						<span class="cat-qb__number">
							{parent ? "Follow-up" : "Question"} {position}
						</span>
					</span>
					<span class="cat-qb__tools">
						<ToggleSwitch
							value={field.required}
							onValueChange={(required) => patch({ required })}
							label="Required"
							disabled={locked}
						/>
						{!locked && (
							<Button
								iconOnly
								icon={<Icon name="trash" size="xs" />}
								severity="danger"
								variant="text"
								size="sm"
								aria-label={children.length > 0
									? `Remove ${name} and its follow-ups`
									: `Remove ${name}`}
								onClick={() => ctx.onRemove(field.id)}
							/>
						)}
					</span>
				</div>

				<InputText
					id={`${base}-label`}
					value={field.label}
					onValueChange={(label) => patch({ label })}
					maxLength={120}
					placeholder="Ask the buyer something"
					aria-label={`Question ${position}`}
					aria-describedby={problem ? `${base}-problem` : undefined}
					status={problem ? "invalid" : "default"}
					fluid
				/>
				{problem && <p class="cat-offer__problem" id={`${base}-problem`}>{problem}</p>}

				<div class="cat-offer__row">
					<div class="cat-sec__field">
						{locked
							? <span class="cat-sec__label">Answer type</span>
							: <label class="cat-sec__label" for={`${base}-kind`}>Answer type</label>}
						{locked ? <p class="cat-sec__value">{INTAKE_KIND_LABELS[field.kind]}</p> : (
							<Select
								id={`${base}-kind`}
								options={KIND_OPTIONS}
								value={field.kind}
								onValueChange={(v) => {
									const kind = IntakeFieldKind.safeParse(v);
									if (kind.success) ctx.onChange(withKind(field, kind.data));
								}}
							/>
						)}
					</div>
					<div class="cat-sec__field">
						<label class="cat-sec__label" for={`${base}-hint`}>Hint</label>
						<InputText
							id={`${base}-hint`}
							value={field.hint ?? ""}
							onValueChange={(hint) => patch({ hint: hint.trim() ? hint : undefined })}
							maxLength={240}
							placeholder="A line under the question (optional)"
							fluid
						/>
					</div>
				</div>

				<QuestionFacets
					field={field}
					position={position}
					locked={locked}
					currency={ctx.currency}
					onChange={ctx.onChange}
				/>

				{parent && field.condition && (
					<FollowUpRule
						field={field}
						condition={field.condition}
						parent={parent}
						position={position}
						locked={locked}
						onChange={(condition) => patch({ condition })}
					/>
				)}

				{!locked && !ctx.full && canBeFollowed(field) && (
					<div class="cat-offer__add">
						<AddQuestionMenu
							label="Add follow-up"
							menuLabel={`Follow-up types for ${name}`}
							onPick={(kind) => ctx.onAddFollowUp(field.id, kind)}
						/>
					</div>
				)}
			</div>

			{children.length > 0 && (
				<ol class="cat-qb__branch" aria-label={`Follow-ups to ${name}`}>
					{children.map((child) => <QuestionRow key={child.field.id} node={child} ctx={ctx} />)}
				</ol>
			)}
			<DropIndicator active={seam === "after"} />
		</li>
	);
}

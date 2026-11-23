import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../../styles/offer.css";
import "../../styles/intake.css";
import "../../styles/question-builder.css";
import { DndContext, DragOverlay, DropIndicator, useDroppable } from "@projective/ui/dnd";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { SUB_PAGE_SECTION, workspaceHref } from "@projective/types/catalogue";
import {
	INTAKE_FIELDS_MAX,
	type IntakeField,
	type IntakeFieldKind,
} from "@projective/types/services";
import type { ListingDetail } from "../../types/catalogue-types.ts";
import { edit } from "../../core/workspace-store.ts";
import {
	addFollowUp,
	canAddQuestion,
	insertQuestion,
	INTAKE_KIND_LABELS,
	intakeLocked,
	intakeLockRefusal,
	intakeNodes,
	type IntakeProblem,
	intakeProblems,
	moveBranch,
	newIntakeField,
	removeBranch,
	toBranchOrder,
} from "../../core/intake-model.ts";
import { useGatedDraft } from "../../hooks/useGatedDraft.ts";
import { SubPageHead } from "../subpage/SubPageHead.tsx";
import {
	AddQuestionMenu,
	kindOfDragId,
	PALETTE_DRAG,
	QuestionPalette,
} from "./QuestionPalette.tsx";
import {
	END_DROP_ID,
	questionOfDragId,
	QuestionRow,
	type QuestionRowContext,
} from "./QuestionRow.tsx";

const HEADING_ID = "cat-qb-h";
const LOCK_ID = "cat-qb-lock";

interface Dragging {
	question: string | null;
	kind: IntakeFieldKind | null;
}

function EndZone(props: { active: boolean; disabled: boolean }): JSX.Element {
	const drop = useDroppable({
		id: END_DROP_ID,
		data: { accepts: [PALETTE_DRAG] },
		disabled: props.disabled,
	});
	return (
		// deno-lint-ignore no-explicit-any
		<div ref={drop.setNodeRef as any} class="cat-qb__end" data-over={props.active || undefined}>
			<DropIndicator active={props.active} />
		</div>
	);
}

/**
 * QuestionsBuilder — the listing's buyer questions as a drag-and-drop form (Decision #525, on the
 * `IntakeField` engine of Decision #522): a palette of question types beside a canvas of questions,
 * each question's follow-ups drawn as its branch. Dropping a type adds a question before the branch
 * it lands on (or at the end), a question's grip moves its whole branch past a sibling, and every
 * change reaches the draft only once a buyer could answer the list. Once the listing has been
 * published the ids, order, kinds and rules are fixed, so the palette, the grips and Remove go and
 * only the wording, options, starting values and pricing stay editable.
 */
export function QuestionsBuilder(props: { listing: ListingDetail; team?: string }): JSX.Element {
	const { listing } = props;
	const locked = intakeLocked(listing);
	const published = listing.intake;
	const check = (fields: IntakeField[]): IntakeProblem | null => {
		const refusal = locked ? intakeLockRefusal(published, fields) : null;
		if (refusal) return { fieldId: "", message: refusal };
		return intakeProblems(fields)[0] ?? null;
	};
	const gated = useGatedDraft<IntakeField[], IntakeProblem>(
		locked ? listing.intake : toBranchOrder(listing.intake),
		check,
		(fields) => edit("intake", fields),
	);
	const fields = gated.value.value;
	const nodes = intakeNodes(fields);
	const roots = nodes.filter((n) => n.parentId === null);
	const full = !canAddQuestion(fields);
	const dragging = useSignal<Dragging>({ question: null, kind: null });
	const seam = useSignal<QuestionRowContext["seam"]>(null);
	const overEnd = useSignal(false);
	const problem = gated.problem.value;

	const add = (kind: IntakeFieldKind, beforeId: string | null) => {
		if (full) return;
		gated.set(insertQuestion(fields, newIntakeField(kind, fields), beforeId));
	};

	const rootOf = (id: string): string => {
		let node = nodes.find((n) => n.field.id === id);
		while (node && node.parentId !== null) {
			const parentId: string = node.parentId;
			node = nodes.find((n) => n.field.id === parentId);
		}
		return node?.field.id ?? id;
	};

	const sameParent = (a: string, b: string) =>
		nodes.find((n) => n.field.id === a)?.parentId === nodes.find((n) => n.field.id === b)?.parentId;

	const ctx: QuestionRowContext = {
		nodes,
		locked,
		full,
		currency: listing.currency,
		problem: problem && problem.fieldId !== "" ? problem : null,
		seam: seam.value,
		onChange: (next) => gated.set(fields.map((f) => (f.id === next.id ? next : f))),
		onRemove: (id) => gated.set(removeBranch(fields, id)),
		onAddFollowUp: (parentId, kind) => {
			const next = addFollowUp(fields, parentId, kind);
			if (next) gated.set(next);
		},
	};

	const ghost = dragging.value.kind
		? INTAKE_KIND_LABELS[dragging.value.kind]
		: dragging.value.question
		? fields.find((f) => f.id === dragging.value.question)?.label.trim() || "Question"
		: null;

	return (
		<div class="cat-sub cat-sub--wide">
			<SubPageHead
				title="Buyer questions"
				intro="What you need to know before you start. Buyers answer these on the way to paying, and a follow-up is asked only when an earlier answer calls for it."
				backHref={workspaceHref(listing.id, {
					team: props.team,
					section: SUB_PAGE_SECTION.questions,
				})}
				headingId={HEADING_ID}
			/>

			{locked && (
				<InlineNotice
					id={LOCK_ID}
					icon={<Icon name="lock" size="sm" />}
					text="This listing has been published, so buyers' answers are stored against these questions. You can reword them and edit their options, starting values and pricing, but not add, remove or reorder them, or change their type or when they are asked."
				/>
			)}

			<DndContext
				onDragStart={(e) => {
					dragging.value = {
						question: questionOfDragId(e.active.id),
						kind: kindOfDragId(e.active.id),
					};
				}}
				onDragOver={(e) => {
					overEnd.value = e.over === END_DROP_ID;
					const over = questionOfDragId(e.over);
					const from = dragging.peek();
					if (!over) {
						seam.value = null;
					} else if (from.kind) {
						seam.value = { id: rootOf(over), side: "before" };
					} else if (from.question && from.question !== over && sameParent(from.question, over)) {
						const up = fields.findIndex((f) => f.id === over) <
							fields.findIndex((f) => f.id === from.question);
						seam.value = { id: over, side: up ? "before" : "after" };
					} else {
						seam.value = null;
					}
				}}
				onDragEnd={(e) => {
					const from = dragging.peek();
					dragging.value = { question: null, kind: null };
					seam.value = null;
					overEnd.value = false;
					if (locked || e.canceled || e.over === null) return;
					if (from.kind) {
						add(from.kind, e.over === END_DROP_ID ? null : questionOfDragId(e.over));
						return;
					}
					const target = questionOfDragId(e.over);
					if (from.question && target) gated.set(moveBranch(fields, from.question, target));
				}}
			>
				<div class="cat-qb" data-locked={locked || undefined}>
					{!locked && <QuestionPalette full={full} onAdd={(kind) => add(kind, null)} />}

					<div class="cat-qb__canvas">
						{roots.length > 0
							? (
								<ol
									class="cat-qb__list"
									aria-labelledby={HEADING_ID}
									aria-describedby={locked ? LOCK_ID : undefined}
								>
									{roots.map((node) => <QuestionRow key={node.field.id} node={node} ctx={ctx} />)}
								</ol>
							)
							: (
								<p class="cat-sec__hint">
									No questions yet, so buyers can hire you straight away. Add one when you need to
									know something first.
								</p>
							)}

						{!locked && <EndZone active={overEnd.value} disabled={full} />}

						{problem && problem.fieldId === "" && (
							<p class="cat-offer__problem" role="status">{problem.message}</p>
						)}

						{!locked && (full
							? <p class="cat-sec__hint">A listing asks at most {INTAKE_FIELDS_MAX} questions.</p>
							: (
								<div class="cat-offer__add">
									<AddQuestionMenu
										label="Add question"
										menuLabel="Question types"
										onPick={(kind) => add(kind, null)}
									/>
								</div>
							))}
					</div>
				</div>

				<DragOverlay class="cat-qb__ghost">
					{ghost
						? (
							<span class="cat-qb__ghost-label">
								{ghost}
								{dragging.value.question ? "" : " question"}
							</span>
						)
						: null}
				</DragOverlay>
			</DndContext>
		</div>
	);
}

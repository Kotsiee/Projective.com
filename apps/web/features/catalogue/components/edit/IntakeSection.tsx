import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../../styles/offer.css";
import "../../styles/intake.css";
import { DndContext } from "@projective/ui/dnd";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { INTAKE_FIELDS_MAX, type IntakeField } from "@projective/types/services";
import type { ListingDetail } from "../../types/catalogue-types.ts";
import { edit } from "../../core/workspace-store.ts";
import { moveItem, removeItem, replaceItem } from "../../core/offer-model.ts";
import {
	canAddQuestion,
	intakeLocked,
	intakeLockRefusal,
	type IntakeProblem,
	intakeProblems,
	newIntakeField,
} from "../../core/intake-model.ts";
import { useGatedDraft } from "../../hooks/useGatedDraft.ts";
import { EditSectionFrame } from "./EditSectionFrame.tsx";
import { IntakeFieldEditor } from "./intake/IntakeFieldEditor.tsx";

const indexOf = (id: unknown) => Number(String(id).replace("question:", ""));
const LOCK_ID = "cat-intake-lock";

/**
 * IntakeSection — the questions a buyer answers before hiring (ServiceCreation.md §1.1), edited as
 * an ordered list of at most twelve and saved whole (order is meaning). A question reaches the draft
 * only once a buyer could answer it. Once the listing has been published its answers are stored
 * under each question's id, so the ids, order, kinds and settings are fixed and only the wording and
 * the options change; the section says why.
 */
export function IntakeSection(props: { listing: ListingDetail }): JSX.Element {
	const { listing } = props;
	const locked = intakeLocked(listing.status);
	const published = listing.intake;
	const check = (fields: IntakeField[]): IntakeProblem | null => {
		const refusal = locked ? intakeLockRefusal(published, fields) : null;
		if (refusal) return { fieldId: "", message: refusal };
		return intakeProblems(fields)[0] ?? null;
	};
	const gated = useGatedDraft<IntakeField[], IntakeProblem>(
		listing.intake,
		check,
		(fields) => edit("intake", fields),
	);
	const fields = gated.value.value;
	const dragIndex = useSignal<number | null>(null);
	const problem = gated.problem.value;

	return (
		<EditSectionFrame
			section="questions"
			intro="What you need to know before you start. Buyers answer these on the way to paying."
		>
			{locked && (
				<p class="cat-sec__hint" id={LOCK_ID}>
					This listing has been published, so buyers' answers are stored against these questions.
					You can reword them and edit their options, but not add, remove, reorder or change them.
				</p>
			)}

			{fields.length > 0
				? (
					<DndContext
						onDragStart={(e) => (dragIndex.value = indexOf(e.active.id))}
						onDragEnd={(e) => {
							const start = dragIndex.value;
							dragIndex.value = null;
							if (locked || e.canceled || start === null || e.over === null) return;
							gated.set([...moveItem(fields, start, indexOf(e.over))]);
						}}
					>
						<ol
							class="cat-intake__questions"
							aria-label="Buyer questions"
							aria-describedby={locked ? LOCK_ID : undefined}
						>
							{fields.map((field, i) => (
								<IntakeFieldEditor
									key={field.id}
									index={i}
									field={field}
									locked={locked}
									problem={problem?.fieldId === field.id ? problem.message : null}
									onChange={(next) => gated.set([...replaceItem(fields, i, next)])}
									onRemove={() => gated.set([...removeItem(fields, i)])}
								/>
							))}
						</ol>
					</DndContext>
				)
				: <p class="cat-sec__hint">No questions. Buyers can hire you straight away.</p>}

			{problem && problem.fieldId === "" && (
				<p class="cat-offer__problem" role="status">{problem.message}</p>
			)}

			{!locked && (canAddQuestion(fields)
				? (
					<div class="cat-offer__add">
						<Button
							label="Add question"
							icon={<Icon name="plus" size="xs" />}
							variant="text"
							size="sm"
							onClick={() => gated.set([...fields, newIntakeField("text", fields)])}
						/>
					</div>
				)
				: <p class="cat-sec__hint">A listing asks at most {INTAKE_FIELDS_MAX} questions.</p>)}
		</EditSectionFrame>
	);
}

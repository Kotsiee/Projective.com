import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Timeline } from "@projective/ui/display";
import { DndContext } from "@projective/ui/dnd";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { STAGES_MAX } from "@projective/types/catalogue";
import type { Milestone } from "../../../types/catalogue-types.ts";
import {
	addItem,
	moveItem,
	newMilestone,
	patchItem,
	removeItem,
} from "../../../core/offer-model.ts";
import { StageRow } from "./StageRow.tsx";

/** Props for {@link StageBlueprintEditor}. */
export interface StageBlueprintEditorProps {
	stages: readonly Milestone[];
	onChange: (stages: readonly Milestone[]) => void;
	currency: string;
	baselineMinor: number | null;
	problemAt?: { index: number; message: string } | null;
}

const indexOf = (id: unknown) => Number(String(id).replace("stage:", ""));

/**
 * StageBlueprintEditor — a Pipeline's stages in order, as a numbered `Timeline` of editable stage
 * rows that drag to reorder (pointer or keyboard). Moving a stage into first place makes it start
 * with the project, as the instantiation does. At most twelve.
 */
export function StageBlueprintEditor(props: StageBlueprintEditorProps): JSX.Element {
	const { stages, onChange } = props;
	const dragIndex = useSignal<number | null>(null);

	return (
		<div class="cat-offer__steps">
			{stages.length > 0 && (
				<DndContext
					onDragStart={(e) => (dragIndex.value = indexOf(e.active.id))}
					onDragEnd={(e) => {
						const start = dragIndex.value;
						dragIndex.value = null;
						if (e.canceled || start === null || e.over === null) return;
						onChange(moveItem(stages, start, indexOf(e.over)));
					}}
				>
					<Timeline
						aria-label="Stages"
						class="cat-offer__timeline"
						value={stages.map((s) => ({ data: s }))}
						markerTemplate={(_, i) => (
							<span class="cat-offer__step-number" aria-hidden="true">{i + 1}</span>
						)}
						contentTemplate={(_, i) => (
							<StageRow
								index={i}
								stage={stages[i]}
								currency={props.currency}
								baselineMinor={props.baselineMinor}
								problem={props.problemAt?.index === i ? props.problemAt.message : null}
								onPatch={(patch) => onChange(patchItem(stages, i, patch))}
								onRemove={() => onChange(removeItem(stages, i))}
							/>
						)}
					/>
				</DndContext>
			)}
			{stages.length < STAGES_MAX
				? (
					<Button
						label="Add stage"
						icon={<Icon name="plus" size="xs" />}
						variant="text"
						size="sm"
						onClick={() =>
							onChange(addItem(stages, newMilestone(stages.length + 1, "Stage"), STAGES_MAX))}
					/>
				)
				: <p class="cat-sec__hint">A pipeline has at most {STAGES_MAX} stages.</p>}
		</div>
	);
}

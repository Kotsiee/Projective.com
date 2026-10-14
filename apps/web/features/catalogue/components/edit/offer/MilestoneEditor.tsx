import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Timeline } from "@projective/ui/display";
import { DndContext, useSortable } from "@projective/ui/dnd";
import { Button, InputText, Textarea } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { Milestone } from "../../../types/catalogue-types.ts";
import {
	addItem,
	moveItem,
	newMilestone,
	patchItem,
	removeItem,
} from "../../../core/offer-model.ts";
import { STAGES_MAX } from "@projective/types/catalogue";

/** Props for {@link MilestoneEditor}. */
export interface MilestoneEditorProps {
	milestones: readonly Milestone[];
	onChange: (milestones: readonly Milestone[]) => void;
	/** The first unsaveable milestone's sentence, keyed by its index. */
	problemAt?: { index: number; message: string } | null;
}

const stepId = (index: number) => `milestone:${index}`;
const indexOf = (id: unknown) => Number(String(id).replace("milestone:", ""));

interface RowProps {
	index: number;
	milestone: Milestone;
	problem: string | null;
	onPatch: (patch: Partial<Milestone>) => void;
	onRemove: () => void;
}

function MilestoneRow(props: RowProps): JSX.Element {
	const { index, milestone } = props;
	const sortable = useSortable({
		id: stepId(index),
		data: { type: "milestone", accepts: ["milestone"] },
		roleDescription: "milestone",
	});
	const nameId = `cat-offer-ms-${index}-name`;
	const problemId = `cat-offer-ms-${index}-problem`;
	const label = milestone.name.trim() || `Milestone ${index + 1}`;
	return (
		<div
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="cat-offer__step"
			data-dragging={sortable.isDragging.value || undefined}
		>
			<div class="cat-offer__step-head">
				<button
					type="button"
					class="cat-offer__grip"
					aria-label={`Reorder ${label}`}
					aria-roledescription={sortable.attributes["aria-roledescription"]}
					tabIndex={sortable.attributes.tabIndex}
					onPointerDown={sortable.listeners.onPointerDown}
					onKeyDown={sortable.listeners.onKeyDown}
				>
					<Icon name="grip" size="xs" />
				</button>
				<InputText
					id={nameId}
					value={milestone.name}
					onValueChange={(name) => props.onPatch({ name })}
					maxLength={80}
					placeholder="Name this milestone"
					aria-label={`Milestone ${index + 1} name`}
					aria-describedby={props.problem ? problemId : undefined}
					status={props.problem ? "invalid" : "default"}
					fluid
				/>
				<button
					type="button"
					class="cat-offer__remove"
					aria-label={`Remove ${label}`}
					onClick={props.onRemove}
				>
					<Icon name="close" size="2xs" />
				</button>
			</div>
			{props.problem && <p class="cat-offer__problem" id={problemId}>{props.problem}</p>}
			<Textarea
				value={milestone.description}
				onValueChange={(description) => props.onPatch({ description })}
				maxLength={600}
				rows={2}
				autoResize
				maxRows={6}
				placeholder="What the buyer receives at this point"
				aria-label={`Milestone ${index + 1} description`}
				fluid
			/>
		</div>
	);
}

/**
 * MilestoneEditor — a One-Off's milestones as a numbered `Timeline`, each step an inline name and
 * description, reordered by dragging its grip (pointer or keyboard). At most twelve; a new one is
 * named by its place so it saves before the seller renames it.
 */
export function MilestoneEditor(props: MilestoneEditorProps): JSX.Element {
	const { milestones, onChange } = props;
	const dragIndex = useSignal<number | null>(null);

	return (
		<div class="cat-offer__steps">
			{milestones.length > 0 && (
				<DndContext
					onDragStart={(e) => (dragIndex.value = indexOf(e.active.id))}
					onDragEnd={(e) => {
						const start = dragIndex.value;
						dragIndex.value = null;
						if (e.canceled || start === null || e.over === null) return;
						onChange(moveItem(milestones, start, indexOf(e.over)));
					}}
				>
					<Timeline
						aria-label="Milestones"
						class="cat-offer__timeline"
						value={milestones.map((m) => ({ data: m }))}
						markerTemplate={(_, i) => (
							<span class="cat-offer__step-number" aria-hidden="true">{i + 1}</span>
						)}
						contentTemplate={(_, i) => (
							<MilestoneRow
								index={i}
								milestone={milestones[i]}
								problem={props.problemAt?.index === i ? props.problemAt.message : null}
								onPatch={(patch) => onChange(patchItem(milestones, i, patch))}
								onRemove={() => onChange(removeItem(milestones, i))}
							/>
						)}
					/>
				</DndContext>
			)}
			{milestones.length < STAGES_MAX
				? (
					<Button
						label="Add milestone"
						icon={<Icon name="plus" size="xs" />}
						variant="text"
						size="sm"
						onClick={() =>
							onChange(
								addItem(milestones, newMilestone(milestones.length + 1, "Milestone"), STAGES_MAX),
							)}
					/>
				)
				: <p class="cat-sec__hint">A listing has at most {STAGES_MAX} milestones.</p>}
		</div>
	);
}

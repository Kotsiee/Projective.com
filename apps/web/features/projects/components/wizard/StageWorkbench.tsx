import type { JSX, VNode } from "preact";
import { DndContext, useSortable } from "@projective/ui/dnd";
import { Icon } from "@projective/ui/icons";
import {
	addStage,
	moveStage,
	removeStage,
	wizardDraft,
	type WizardStage,
	wizardStageKey,
} from "../../core/wizard-state.ts";
import { stageNoun } from "./wizard-vocab.ts";

/**
 * StageWorkbench — the ordered stage list beside the configuration of the one stage in hand.
 *
 * Three of the six steps configure per-stage answers (the "what", the "when" and the "how much"),
 * and all three want the same list with a different inspector beside it. One workbench with a
 * render-prop inspector is what stops that list being written three times and drifting into three
 * slightly different reorder behaviours — the two-panel shape the retired create modal established,
 * generalised to the step that is on screen.
 *
 * **Order is the sequence, so only ONE step may change it.** The Stages step owns reordering,
 * because there the position of a row IS the delivery order the author is describing. The Timeline
 * and Budget steps render the same list read-only: a drag there would silently rewrite the schedule
 * from a screen that is about dependencies or money, and a dependency the author set two steps ago
 * would change meaning under them.
 *
 * Selection falls back to the first row rather than being written on mount. A signal assigned during
 * render is a write nothing asked for, and it would fight a deliberate selection made on the step
 * before this one.
 */

// #region Shapes
export interface StageWorkbenchProps {
	/** The list's heading. */
	title: string;
	/** A short right-aligned summary of this step's own answer for a row. */
	summary?: (stage: WizardStage, index: number) => string | null;
	/** The configuration this step shows for the selected stage. */
	inspector: (stage: WizardStage, index: number) => VNode;
	/** Whether rows may be dragged into a new order here. */
	reorderable?: boolean;
	/** Whether rows may be added and removed here. */
	editable?: boolean;
	/** What to say when the list is empty. */
	empty: string;
}

interface RowProps {
	stage: WizardStage;
	index: number;
	active: boolean;
	summary: string | null;
	editable: boolean;
	onSelect: () => void;
	onRemove: () => void;
}
// #endregion

// #region Rows
/** The row's own content — shared by both presentations so they cannot drift apart. */
function RowBody(props: RowProps): JSX.Element {
	return (
		<>
			<button
				type="button"
				class="pwz-stage__main"
				aria-pressed={props.active}
				onClick={props.onSelect}
			>
				<span class="pwz-stage__index" aria-hidden="true">{props.index + 1}</span>
				<span class="pwz-stage__name">{props.stage.name || "Untitled"}</span>
				{props.summary && <span class="pwz-stage__summary">{props.summary}</span>}
			</button>
			{props.editable && (
				<button
					type="button"
					class="pwz-stage__remove"
					aria-label={`Remove ${props.stage.name || "this stage"}`}
					onClick={props.onRemove}
				>
					<Icon name="trash" size="sm" />
				</button>
			)}
		</>
	);
}

/** A row on the step that owns the order — grip first, then the shared body. */
function SortableStageRow(props: RowProps): JSX.Element {
	const sortable = useSortable({
		id: `stage:${props.stage.key}`,
		data: { type: "stage", accepts: ["stage"] },
		roleDescription: "stage",
	});
	return (
		<li
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="pwz-stage"
			data-active={props.active || undefined}
			data-dragging={sortable.isDragging.value || undefined}
			data-over={sortable.isOver.value || undefined}
		>
			<button
				type="button"
				class="pwz-stage__grip"
				aria-label={`Reorder ${props.stage.name || "this stage"}`}
				aria-roledescription={sortable.attributes["aria-roledescription"]}
				tabIndex={sortable.attributes.tabIndex}
				onPointerDown={sortable.listeners.onPointerDown}
				onKeyDown={sortable.listeners.onKeyDown}
			>
				<Icon name="grip" size="sm" />
			</button>
			<RowBody {...props} />
		</li>
	);
}

/** A row on a step that only reads the order. */
function PlainStageRow(props: RowProps): JSX.Element {
	return (
		<li class="pwz-stage" data-active={props.active || undefined}>
			<RowBody {...props} />
		</li>
	);
}
// #endregion

// #region The workbench
export function StageWorkbench(props: StageWorkbenchProps): JSX.Element {
	const draft = wizardDraft.value;
	const stages = draft.stages;
	const noun = stageNoun(draft.format);
	const activeKey = wizardStageKey.value ?? stages[0]?.key ?? null;
	const activeIndex = stages.findIndex((stage) => stage.key === activeKey);
	const active = activeIndex === -1 ? null : stages[activeIndex];
	const editable = props.editable === true;

	const rows = stages.map((stage, index) => {
		const row: RowProps = {
			stage,
			index,
			active: stage.key === activeKey,
			summary: props.summary?.(stage, index) ?? null,
			editable,
			onSelect: () => (wizardStageKey.value = stage.key),
			onRemove: () => removeStage(stage.key),
		};
		return props.reorderable
			? <SortableStageRow key={stage.key} {...row} />
			: <PlainStageRow key={stage.key} {...row} />;
	});

	const list = (
		<ul class="pwz-stages" aria-label={props.title}>
			{rows}
			{stages.length === 0 && <li class="pwz-stages__empty">{props.empty}</li>}
		</ul>
	);

	return (
		<div class="pwz-work" data-inspector={active ? "open" : undefined}>
			<div class="pwz-work__list">
				<div class="pwz-work__head">
					<h3 class="pwz-work__title">{props.title}</h3>
					<span class="pwz-work__count">
						{stages.length} {stages.length === 1 ? noun : `${noun}s`}
					</span>
				</div>

				{props.reorderable
					? (
						<DndContext
							onDragEnd={(event) => {
								const over = event.canceled ? null : event.over;
								if (!event.active.id || !over) return;
								const strip = (id: string) => id.replace("stage:", "");
								moveStage(strip(event.active.id), strip(over));
							}}
						>
							{list}
						</DndContext>
					)
					: list}

				{editable && (
					<button type="button" class="pwz-work__add" onClick={addStage}>
						<Icon name="plus" size="sm" />
						Add {noun}
					</button>
				)}
			</div>

			<div class="pwz-work__inspector">
				{active ? props.inspector(active, activeIndex) : (
					<p class="pwz-work__placeholder">
						{stages.length === 0 ? props.empty : `Pick a ${noun} on the left to configure it.`}
					</p>
				)}
			</div>
		</div>
	);
}
// #endregion

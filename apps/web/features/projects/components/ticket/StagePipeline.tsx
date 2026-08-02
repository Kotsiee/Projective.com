import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { DndContext, DropIndicator, useSortable } from "@projective/ui/dnd";
import { AvatarStack } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	type BoardStageRef,
	formatTicketMoney,
	TICKET_INTENSITY_LABEL,
} from "../../types/projects-types.ts";
import type { TicketStageView } from "../../core/ticket-view.ts";

/**
 * StagePipeline — the ticket's stage sequence as a flow diagram.
 *
 * A checkbox list can express membership and order but not the two facts that actually govern a
 * ticket: what each stage COSTS at the chosen intensity, and which stages run at the same time. Both
 * are structural, so both are drawn — a gutter rail carries the execution steps, and stages sharing
 * a step are visibly tied to it.
 *
 * It lives in the Stages tab of the one ticket modal and serves both postures. While a ticket is
 * being composed the rows reorder, join and detach; once it exists the same rows are the record of
 * what was agreed, and a viewer without the right to change it gets no grips, no joins and no
 * "stages not in this ticket" list. Selecting a row opens it in the modal's own right-hand panel
 * rather than a nested one, so there is one place a stage is configured.
 *
 * Reorder is the shared pointer/keyboard `useSortable`; the landing position is the shared
 * {@link DropIndicator}, not a highlighted neighbour, because "before or after this row" is exactly
 * the question a highlight cannot answer.
 */
export interface StagePipelineProps {
	resolved: TicketStageView[];
	/** Stages of the engagement not currently in the ticket. */
	available: BoardStageRef[];
	selectedStageId: string | null;
	/** Whether the viewer may change the ticket's composition. */
	editable: boolean;
	onSelect: (stageId: string | null) => void;
	onToggle: (stageId: string) => void;
	onMove: (from: number, to: number) => void;
	onParallel: (stageId: string, parallel: boolean) => void;
}

const idOf = (raw: string): string => raw.replace("stage:", "");

/** Where a stage sits in its execution band — drives the gutter's rail geometry. */
function bandPosition(list: TicketStageView[], i: number): "solo" | "start" | "middle" | "end" {
	const band = list[i].band;
	const first = i === 0 || list[i - 1].band !== band;
	const last = i === list.length - 1 || list[i + 1].band !== band;
	if (first && last) return "solo";
	if (first) return "start";
	return last ? "end" : "middle";
}

interface CardProps {
	item: TicketStageView;
	position: "solo" | "start" | "middle" | "end";
	/** The step number shown on the gutter node, or `null` for a continuation row. */
	step: number | null;
	previousName: string | null;
	selected: boolean;
	editable: boolean;
	onSelect: () => void;
	onRemove: () => void;
}

function StageCard(props: CardProps): JSX.Element {
	const { item, selected, editable } = props;
	const { ref, stage, costCents, workload } = item;
	const sortable = useSortable({
		id: `stage:${ref.stageId}`,
		data: { type: "stage", accepts: ["stage"] },
		roleDescription: "pipeline stage",
		disabled: !editable,
	});

	return (
		<div class="tkc-row" data-band={props.position}>
			<div class="tkc-row__rail" aria-hidden="true">
				<span class="tkc-row__node" data-continuation={props.step === null ? "true" : undefined}>
					{props.step !== null ? props.step : null}
				</span>
			</div>

			<article
				// deno-lint-ignore no-explicit-any
				ref={sortable.setNodeRef as any}
				class="tkc-stage"
				data-selected={selected ? "true" : undefined}
				data-dragging={sortable.isDragging.value || undefined}
				data-locked={stage?.locked ? "true" : undefined}
				data-missing={stage ? undefined : "true"}
			>
				{editable
					? (
						<button
							type="button"
							class="tkc-stage__grip"
							aria-label={`Reorder ${ref.name}`}
							aria-roledescription={sortable.attributes["aria-roledescription"]}
							tabIndex={sortable.attributes.tabIndex}
							onPointerDown={sortable.listeners.onPointerDown}
							onKeyDown={sortable.listeners.onKeyDown}
						>
							<Icon name="grip" size="xs" />
						</button>
					)
					: <span class="tkc-stage__grip tkc-stage__grip--static" />}

				<div class="tkc-stage__body">
					<div class="tkc-stage__line">
						<h4 class="tkc-stage__name">{ref.name}</h4>
						{ref.intensity !== "standard"
							? (
								<span class="tkc-stage__int" data-level={ref.intensity}>
									{TICKET_INTENSITY_LABEL[ref.intensity]}
								</span>
							)
							: null}
						{stage?.locked
							? (
								<Tooltip content="This stage is already running — work added here starts immediately.">
									<span class="tkc-stage__lock" tabIndex={0} aria-label="Stage already running">
										<Icon name="lock" size="2xs" />
									</span>
								</Tooltip>
							)
							: null}
					</div>
					{
						/*
						 * A stage the engagement has since removed keeps its row. The ticket is priced against
						 * it, so hiding it would leave an unexplained figure in the total — the honest move is
						 * to say the stage is gone and keep the money it accounts for visible.
						 */
					}
					<p class="tkc-stage__desc">
						{stage
							? (ref.brief || stage.description || "No brief on this stage yet.")
							: "This stage has been removed from the engagement. The ticket keeps the price it was agreed at."}
					</p>
					{props.position !== "solo" && props.position !== "start" && props.previousName
						? (
							<p class="tkc-stage__with">
								<Icon name="switch" size="2xs" />
								Runs alongside {props.previousName}
							</p>
						)
						: null}
				</div>

				<div class="tkc-stage__end">
					{stage
						? (
							<AvatarStack
								people={stage.members}
								max={4}
								size={22}
								aria-label={stage.members.length === 0
									? "No one assigned"
									: `${stage.members.length} assigned: ${
										stage.members.map((m) => m.name).join(", ")
									}`}
							/>
						)
						: null}
					{
						/*
						 * The cost, and nothing beside it. The capacity this stage consumes is a real figure
						 * but it is not a LABEL — a chip reading "W 1.35" next to one reading "High" invites
						 * the reader to treat a derived number as the name of the setting they chose. The
						 * figure lives on the ticket's Finances tab, where the arithmetic behind it is shown.
						 */
					}
					<Tooltip
						content={`${TICKET_INTENSITY_LABEL[ref.intensity]} intensity · ${
							workload.toFixed(2).replace(/\.00$/, "")
						} units of a freelancer's capacity`}
					>
						<span class="tkc-stage__cost" tabIndex={0}>
							{costCents === null
								? <span class="tkc-stage__cost--none">No rate</span>
								: formatTicketMoney(costCents)}
						</span>
					</Tooltip>
				</div>

				<div class="tkc-stage__acts">
					{editable
						? (
							<Tooltip content="Remove from this ticket">
								<button
									type="button"
									class="tkc-stage__act"
									aria-label={`Remove ${ref.name} from this ticket`}
									onClick={props.onRemove}
								>
									<Icon name="minus" size="xs" />
								</button>
							</Tooltip>
						)
						: null}
					<Tooltip content={selected ? "Close stage details" : "Open stage details"}>
						<button
							type="button"
							class="tkc-stage__act tkc-stage__act--open"
							aria-label={`${selected ? "Close" : "Open"} details for ${ref.name}`}
							aria-expanded={selected}
							onClick={props.onSelect}
						>
							<Icon name="chevron-right" size="sm" />
						</button>
					</Tooltip>
				</div>
			</article>
		</div>
	);
}

/** The join control between two consecutive stages — sequence, or simultaneous execution. */
function BandJoin(
	props: {
		parallel: boolean;
		editable: boolean;
		aboveName: string;
		belowName: string;
		onToggle: () => void;
	},
): JSX.Element {
	const label = props.parallel
		? `${props.belowName} runs alongside ${props.aboveName}. Split them into separate steps.`
		: `${props.belowName} starts after ${props.aboveName}. Run them at the same time.`;
	return (
		<div class="tkc-join" data-parallel={props.parallel ? "true" : undefined}>
			<span class="tkc-join__rail" aria-hidden="true" />
			{props.editable
				? (
					<Tooltip content={label}>
						<button
							type="button"
							class="tkc-join__btn"
							aria-label={label}
							aria-pressed={props.parallel}
							onClick={props.onToggle}
						>
							<Icon name={props.parallel ? "switch" : "arrow-down"} size="2xs" />
							<span class="tkc-join__text">
								{props.parallel ? "At the same time" : "Then"}
							</span>
						</button>
					</Tooltip>
				)
				: (
					<span class="tkc-join__btn tkc-join__btn--static">
						<Icon name={props.parallel ? "switch" : "arrow-down"} size="2xs" />
						<span class="tkc-join__text">{props.parallel ? "At the same time" : "Then"}</span>
					</span>
				)}
		</div>
	);
}

export function StagePipeline(props: StagePipelineProps): JSX.Element {
	const { resolved, available, selectedStageId, editable } = props;
	const dragIndex = useSignal<number | null>(null);
	const overIndex = useSignal<number | null>(null);

	const indexOfId = (id: string) => resolved.findIndex((r) => r.ref.stageId === id);
	const from = dragIndex.value;
	const over = overIndex.value;
	const seamBefore = from !== null && over !== null && from > over ? over : null;
	const seamAfter = from !== null && over !== null && from < over ? over : null;

	return (
		<div class="tkc-pipe">
			<header class="tkc-pipe__head">
				<h3 class="tkc-pipe__title">Pipeline</h3>
				<p class="tkc-pipe__sub">
					{resolved.length === 0
						? editable
							? "Pick the stages this ticket passes through."
							: "This ticket runs through no stages."
						: editable
						? "Drag to reorder. Join two stages to run them at the same time."
						: "The stages this ticket runs through, in order."}
				</p>
			</header>

			{resolved.length === 0
				? (
					<div class="tkc-pipe__empty">
						<Icon name="stages" size="lg" class="tkc-pipe__emptymark" />
						<p class="tkc-pipe__emptytext">
							{editable
								? "A ticket with no stages saves as a draft. Add one below to price it."
								: "A ticket with no stages carries no price, so nothing can be claimed against it."}
						</p>
					</div>
				)
				: (
					<DndContext
						onDragStart={(e) => (dragIndex.value = indexOfId(idOf(String(e.active.id))))}
						onDragOver={(e) => {
							overIndex.value = e.over === null ? null : indexOfId(idOf(String(e.over)));
						}}
						onDragEnd={(e) => {
							const start = dragIndex.value;
							const target = e.over === null ? null : indexOfId(idOf(String(e.over)));
							dragIndex.value = null;
							overIndex.value = null;
							if (e.canceled || start === null || target === null || target < 0) return;
							props.onMove(start, target);
						}}
					>
						<ol class="tkc-pipe__list" aria-label="Ticket stages, in order">
							{resolved.map((item, i) => {
								const position = bandPosition(resolved, i);
								const isBandStart = position === "solo" || position === "start";
								const previous = i > 0 ? resolved[i - 1] : null;
								return (
									<li key={item.ref.stageId} class="tkc-pipe__slot">
										{previous
											? (
												<BandJoin
													parallel={item.ref.parallel}
													// NOT gated on `stage.locked`. That lock is about the PROJECT's stage
													// sequence; how one ticket routes through those stages, and which of
													// them it runs concurrently, is the ticket's own property.
													editable={editable}
													aboveName={previous.ref.name}
													belowName={item.ref.name}
													onToggle={() => props.onParallel(item.ref.stageId, !item.ref.parallel)}
												/>
											)
											: null}
										<DropIndicator active={seamBefore === i} />
										<StageCard
											item={item}
											position={position}
											step={isBandStart ? item.band + 1 : null}
											previousName={previous?.ref.name ?? null}
											selected={selectedStageId === item.ref.stageId}
											editable={editable}
											onSelect={() =>
												props.onSelect(
													selectedStageId === item.ref.stageId ? null : item.ref.stageId,
												)}
											onRemove={() => props.onToggle(item.ref.stageId)}
										/>
										<DropIndicator active={seamAfter === i} />
									</li>
								);
							})}
						</ol>
					</DndContext>
				)}

			{available.length > 0 && editable
				? (
					<section class="tkc-avail">
						<h4 class="tkc-avail__title">Stages not in this ticket</h4>
						<ul class="tkc-avail__list">
							{available.map((s) => (
								<li key={s.id}>
									<button
										type="button"
										class="tkc-avail__row"
										onClick={() => props.onToggle(s.id)}
										aria-label={`Add ${s.name} to this ticket`}
									>
										<Icon name="plus" size="xs" class="tkc-avail__mark" />
										<span class="tkc-avail__name">{s.name}</span>
										<span class="tkc-avail__cost">
											{s.unitPriceCents === null
												? "No rate"
												: `${formatTicketMoney(s.unitPriceCents)} / ticket`}
										</span>
									</button>
								</li>
							))}
						</ul>
					</section>
				)
				: null}
		</div>
	);
}

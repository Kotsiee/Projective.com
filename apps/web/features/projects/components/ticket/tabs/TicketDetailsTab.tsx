import type { JSX } from "preact";
import { RichTextEditor } from "@projective/ui/editor";
import { Icon } from "@projective/ui/icons";
import type { BoardCard, BoardStageRef, TicketTask } from "../../../types/projects-types.ts";
import { formatTicketMoney, TICKET_INTENSITY_LABEL } from "../../../types/projects-types.ts";
import { hasContent } from "../../../core/ticket-model.ts";
import type { TicketStageView } from "../../../core/ticket-view.ts";
import { TaskListEditor } from "../TaskListEditor.tsx";

/**
 * TicketDetailsTab — what this ticket asks for.
 *
 * The brief and the ticket-level task list first, then the SAME two things for each stage that is
 * currently running. That ordering is the point: a freelancer opening a ticket needs "what am I
 * being asked to do right now" answered before "what does this ticket cover overall", and burying
 * the active stage's brief behind another tab is how a delivery misses its acceptance criteria.
 *
 * Stages that run at the same time both appear here, because both are live.
 *
 * Between the two sits the stage MEMBERSHIP picker — which stages this ticket covers, and nothing
 * else. It is here because membership is the price: a ticket costs the sum of its stages, so a
 * client composing one has to answer this before the total in the footer means anything, and on a
 * new ticket that is the second decision after the brief. Order, concurrency and per-stage briefs
 * stay on the Stages tab, where the pipeline is drawn — this is the checkbox, not the diagram. Both
 * call the same reducer over the same working copy, so they cannot disagree.
 *
 * A viewer without the right to change the ticket gets no picker at all rather than a disabled one:
 * the stage run they can READ is right below, and on the Stages tab.
 *
 * The brief is rich text, edited in place by a seat that holds the right and rendered as prose to one
 * that does not — never a disabled editor, which advertises a capability and then refuses it.
 */
export interface TicketDetailsTabProps {
	card: BoardCard;
	stageViews: TicketStageView[];
	/**
	 * Every stage the ENGAGEMENT has — the options the membership picker offers, in board order.
	 *
	 * Distinct from {@link stageViews}, which are the stages this ticket already runs through. A
	 * stage the ticket references but the engagement no longer has is deliberately absent from this
	 * list; it survives on the card and is read on the Stages tab, which is the record.
	 */
	projectStages: BoardStageRef[];
	/** Whether the viewer may rewrite what the ticket asks for. */
	canEdit: boolean;
	/** Whether this is a ticket being created — nothing can be running, and nothing can be done. */
	creating: boolean;
	onPatch: (patch: Partial<BoardCard>) => void;
	/** Add or drop a stage. The SAME reducer the Stages tab's pipeline calls, so the two agree. */
	onToggleStage: (stageId: string) => void;
	onOpenStage: (stageId: string) => void;
}

/** A rich-text value as prose, or the placeholder when the document is empty. */
function Prose(props: { html: string | null; empty: string; class?: string }): JSX.Element {
	if (!hasContent(props.html)) {
		return <p class="tkv-empty tkv-empty--inline">{props.empty}</p>;
	}
	return (
		<div
			class={props.class ? `tkv-rich ${props.class}` : "tkv-rich"}
			dangerouslySetInnerHTML={{ __html: props.html ?? "" }}
		/>
	);
}

export function TicketDetailsTab(props: TicketDetailsTabProps): JSX.Element {
	const { card, canEdit, creating } = props;
	const chosen = new Set(card.stages.map((s) => s.stageId));
	// Counted over the stages this control actually LISTS, not over `card.stages`, so "2/3" describes
	// the list beneath it. A ticket referencing a stage the engagement has since dropped would
	// otherwise make the numerator larger than anything on screen.
	const chosenCount = props.projectStages.filter((s) => chosen.has(s.id)).length;
	// A stage is worth expanding inline when the ticket is actually in it; everything else is history
	// or ahead, and the Stages tab is where those are read.
	const currentBand = props.stageViews.find((s) => s.ref.stageId === card.stageId)?.band ?? null;
	const live = creating || card.stageId === null
		? []
		: props.stageViews.filter((v) => v.ref.stageId === card.stageId || v.band === currentBand);

	return (
		<div class="tkv-doc">
			<section class="tkv-doc__sec" aria-label="Description">
				<h3 class="tkv-h">Description</h3>
				{canEdit
					? (
						<RichTextEditor
							// Seeded once at mount and thereafter owned by Quill, so the editor's identity has to
							// be the ticket's — without the key, opening a second ticket would keep the first
							// one's brief in the box and write it back on the next keystroke.
							key={card.id}
							value={card.description ?? ""}
							minRows={5}
							// `.tkv__body` is a BOUNDED scroller — measured at 640px on a 900px viewport — so this
							// field is spending a fixed budget rather than lengthening a page. Half of it is the
							// honest limit: past that, the stage run and the task list below are pushed out of the
							// modal with nothing on screen to say they exist.
							maxAutoHeight="20rem"
							aria-label="Ticket description"
							placeholder="What does done look like? Acceptance criteria, references, constraints."
							onValueChange={(description: string) =>
								props.onPatch({
									description: description || null,
									hasDescription: hasContent(description),
								})}
						/>
					)
					: (
						<Prose
							html={card.description}
							empty="No description has been written for this ticket yet."
						/>
					)}
				{canEdit && !hasContent(card.description)
					? (
						<p class="tkv-note" role="status">
							<Icon name="info" size="2xs" />
							A ticket needs a description before it can be purchased or claimed.
						</p>
					)
					: null}
			</section>

			{canEdit
				? (
					<section class="tkv-doc__sec" aria-label="Stages">
						<h3 class="tkv-h">
							Stages
							{props.projectStages.length > 0
								? (
									<span class="tkv-h__count">
										{chosenCount}/{props.projectStages.length}
									</span>
								)
								: null}
							<span class="tkv-h__note">Order and concurrency are set on the Stages tab</span>
						</h3>

						{props.projectStages.length === 0
							? (
								<p class="tkv-empty tkv-empty--inline">
									This engagement has no stages yet, so there is nothing to price this ticket
									against.
								</p>
							)
							: (
								<ul class="tkv-stagepick" aria-label="Stages this ticket runs through">
									{props.projectStages.map((stage) => {
										const on = chosen.has(stage.id);
										return (
											<li key={stage.id}>
												<button
													type="button"
													class="tkv-stagepick__opt"
													aria-pressed={on}
													onClick={() => props.onToggleStage(stage.id)}
												>
													<Icon
														name={on ? "check" : "plus"}
														size="2xs"
														class="tkv-stagepick__mark"
													/>
													<span class="tkv-stagepick__name">{stage.name}</span>
													<span class="tkv-stagepick__rate">
														{stage.unitPriceCents === null
															? "No rate"
															: formatTicketMoney(stage.unitPriceCents)}
													</span>
												</button>
											</li>
										);
									})}
								</ul>
							)}

						{props.projectStages.length > 0 && chosenCount === 0
							? (
								<p class="tkv-note" role="status">
									<Icon name="info" size="2xs" />
									A ticket with no stages carries no price, so it saves as a draft.
								</p>
							)
							: null}
					</section>
				)
				: null}

			<section class="tkv-doc__sec" aria-label="Task list">
				<h3 class="tkv-h">
					Task list
					{card.checklistTotal > 0
						? (
							<span class="tkv-h__count">
								{card.checklistDone}/{card.checklistTotal}
							</span>
						)
						: null}
					{!creating && card.checklistTotal > 0
						? <span class="tkv-h__note">Steps are ticked off from a submission</span>
						: null}
				</h3>
				{card.tasks.length === 0 && !canEdit
					? <p class="tkv-empty tkv-empty--inline">No steps have been listed for this ticket.</p>
					: (
						<TaskListEditor
							tasks={card.tasks}
							onChange={(tasks: TicketTask[]) => props.onPatch({ tasks })}
							label="Ticket tasks"
							editable={canEdit}
							hideProgress={creating}
						/>
					)}
			</section>

			{live.length > 0
				? (
					<section class="tkv-doc__sec" aria-label="Active stages">
						<h3 class="tkv-h">
							Running now
							{live.length > 1
								? <span class="tkv-h__note">{live.length} stages at the same time</span>
								: null}
						</h3>

						{live.map((view) => {
							const { ref, stage } = view;
							const done = ref.tasks.filter((t) => t.done).length;
							return (
								<article key={ref.stageId} class="tkv-live">
									<div class="tkv-live__head">
										<span class="tkv-live__step" aria-hidden="true">{view.band + 1}</span>
										<button
											type="button"
											class="tkv-live__name"
											onClick={() => props.onOpenStage(ref.stageId)}
											aria-label={`Open ${ref.name} in the Stages view`}
										>
											{ref.name}
											<Icon name="chevron-right" size="2xs" />
										</button>
										<span class="tkv-live__int" data-level={ref.intensity}>
											{TICKET_INTENSITY_LABEL[ref.intensity]}
										</span>
									</div>

									<Prose
										html={ref.brief || stage?.description || null}
										empty="No brief was written for this stage on this ticket."
										class="tkv-rich--sm"
									/>

									{ref.tasks.length > 0
										? (
											<>
												<p class="tkv-live__tasktitle">
													Steps <span class="tkv-h__count">{done}/{ref.tasks.length}</span>
												</p>
												<TaskListEditor
													tasks={ref.tasks}
													onChange={() => {}}
													label={`${ref.name} steps`}
													editable={false}
												/>
											</>
										)
										: null}
								</article>
							);
						})}
					</section>
				)
				: null}
		</div>
	);
}

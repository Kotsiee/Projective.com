import type { JSX } from "preact";
import { RichTextEditor } from "@projective/ui/editor";
import { Icon } from "@projective/ui/icons";
import type { BoardCard, TicketTask } from "../../../types/projects-types.ts";
import { TICKET_INTENSITY_LABEL } from "../../../types/projects-types.ts";
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
 * The brief is rich text, edited in place by a seat that holds the right and rendered as prose to one
 * that does not — never a disabled editor, which advertises a capability and then refuses it.
 */
export interface TicketDetailsTabProps {
	card: BoardCard;
	stageViews: TicketStageView[];
	/** Whether the viewer may rewrite what the ticket asks for. */
	canEdit: boolean;
	/** Whether this is a ticket being created — nothing can be running, and nothing can be done. */
	creating: boolean;
	onPatch: (patch: Partial<BoardCard>) => void;
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

import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { Select } from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	ASSIGNMENT_MODE_LABEL,
	type BoardCard,
	formatTicketMoney,
	type ProjectStatus,
	TICKET_INTENSITY_HINT,
	TICKET_INTENSITY_LABEL,
	type TicketIntensity,
	type TicketStageRef,
	type TicketTask,
} from "../../types/projects-types.ts";
import { statusLabel, statusTone } from "../../core/board-model.ts";
import { INTENSITY_OPTIONS } from "../../core/ticket-model.ts";
import type { TicketStageView } from "../../core/ticket-view.ts";
import { TaskListEditor } from "./TaskListEditor.tsx";

/**
 * StageInspector — the modal's right panel while a stage is selected on the Stages tab.
 *
 * It renders in the modal's OWN side panel rather than a nested one of its own. A panel inside a
 * panel inside a dialog is three boxes competing to be the thing you are reading, and it left the
 * ticket with two places a stage could be configured; there is now one.
 *
 * Two tabs, split by who owns the content. **This ticket** is the ticket's slice of the stage: what
 * it must deliver, how hard it is, and the steps it breaks into — all of it the ticket's own property
 * and editable by the client who is composing it. **Stage overview** is the stage as it already
 * exists: its standing brief, its roster, the work already routed through it, and the client's
 * operating settings. None of that is editable here, because changing a stage is a different act from
 * configuring a ticket, and conflating the two is how a client edits the pipeline while believing
 * they are editing one ticket.
 */
export interface StageInspectorProps {
	item: TicketStageView;
	/** Tickets already routed through this stage — the load the client is adding to. */
	stageTickets: BoardCard[];
	editable: boolean;
	onClose: () => void;
	onPatch: (patch: Partial<TicketStageRef>) => void;
}

/** A stage's lifecycle reads in the client's words, not the enum's. */
const STAGE_STATUS_LABEL: Record<ProjectStatus, string> = {
	draft: "Not started",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
};

const STAGE_TONE: Record<ProjectStatus, string> = {
	draft: "neutral",
	active: "progress",
	on_hold: "warning",
	completed: "success",
	cancelled: "muted",
};

/** One label/value line in the operating-metadata list. */
function Fact({ label, children }: { label: string; children: JSX.Element | string }): JSX.Element {
	return (
		<div class="tkc-fact">
			<dt class="tkc-fact__k">{label}</dt>
			<dd class="tkc-fact__v">{children}</dd>
		</div>
	);
}

export function StageInspector(props: StageInspectorProps): JSX.Element {
	const { item, stageTickets, editable } = props;
	const { ref, stage, costCents, workload } = item;
	const tab = useSignal<"overview" | "config">("config");

	const tabId = (t: string) => `tkc-insp-${t}`;
	const panelId = (t: string) => `tkc-insp-panel-${t}`;
	const baseCents = ref.unitPriceCents ?? stage?.unitPriceCents ?? null;

	return (
		<aside class="tkc-insp" aria-label={`${ref.name} details`}>
			<header class="tkc-insp__head">
				<div class="tkc-insp__ident">
					<span class="tkc-insp__eyebrow">Step {item.band + 1}</span>
					<h3 class="tkc-insp__title">{ref.name}</h3>
				</div>
				<button
					type="button"
					class="tkc-insp__close"
					aria-label="Close stage details"
					onClick={props.onClose}
				>
					<Icon name="close" size="sm" />
				</button>
			</header>

			<div class="tkc-insp__price">
				<span class="tkc-insp__amount">
					{costCents === null ? "Not priced" : formatTicketMoney(costCents)}
				</span>
				<span class="tkc-insp__amountsub">
					{baseCents === null
						? "This stage has no ticket rate yet"
						: `${formatTicketMoney(baseCents)} base · ${
							TICKET_INTENSITY_LABEL[ref.intensity]
						} intensity`}
				</span>
			</div>

			<div class="tkc-insp__tabs" role="tablist" aria-label="Stage panel">
				<button
					type="button"
					id={tabId("config")}
					role="tab"
					class="tkc-insp__tab"
					aria-selected={tab.value === "config"}
					aria-controls={panelId("config")}
					onClick={() => (tab.value = "config")}
				>
					This ticket
				</button>
				<button
					type="button"
					id={tabId("overview")}
					role="tab"
					class="tkc-insp__tab"
					aria-selected={tab.value === "overview"}
					aria-controls={panelId("overview")}
					onClick={() => (tab.value = "overview")}
				>
					Stage overview
				</button>
			</div>

			{tab.value === "config"
				? (
					<div
						class="tkc-insp__body"
						id={panelId("config")}
						role="tabpanel"
						aria-labelledby={tabId("config")}
					>
						<div class="tkc-field">
							<span class="tkc-label" id="tkc-stage-brief-label">What this stage delivers</span>
							{editable
								? (
									<RichTextEditor
										// Quill owns its DOM after mount and is seeded once, so a different stage has
										// to be a different editor — without the key, selecting stage B would leave
										// stage A's brief in the box and write it back on the next keystroke.
										key={ref.stageId}
										value={ref.brief}
										minRows={4}
										aria-label={`Brief for ${ref.name}`}
										placeholder={`Deliverables and acceptance criteria for ${ref.name}.`}
										onValueChange={(brief: string) => props.onPatch({ brief })}
									/>
								)
								: (
									<div
										class="tkc-insp__prose tkv-rich"
										aria-labelledby="tkc-stage-brief-label"
										dangerouslySetInnerHTML={{
											__html: ref.brief ||
												"<p>No brief was written for this stage on this ticket.</p>",
										}}
									/>
								)}
						</div>

						{editable
							? (
								<div class="tkc-field">
									<span class="tkc-label" id="tkc-stageint-label">Intensity in this stage</span>
									<Select
										size="sm"
										value={ref.intensity}
										options={INTENSITY_OPTIONS}
										aria-labelledby="tkc-stageint-label"
										onValueChange={(v) => {
											if (v) props.onPatch({ intensity: v as TicketIntensity });
										}}
									/>
									<p class="tkc-hint">{TICKET_INTENSITY_HINT[ref.intensity]}</p>
								</div>
							)
							: (
								<dl class="tkc-facts">
									<Fact label="Intensity">{TICKET_INTENSITY_LABEL[ref.intensity]}</Fact>
								</dl>
							)}

						<div class="tkc-field tkc-field--grow">
							<span class="tkc-label">Steps in this stage</span>
							<TaskListEditor
								tasks={ref.tasks}
								onChange={(tasks: TicketTask[]) => props.onPatch({ tasks })}
								label={`${ref.name} steps`}
								placeholder="Add a step for this stage…"
								editable={editable}
							/>
						</div>
					</div>
				)
				: (
					<div
						class="tkc-insp__body"
						id={panelId("overview")}
						role="tabpanel"
						aria-labelledby={tabId("overview")}
					>
						{!stage
							? (
								<p class="tkc-insp__none">
									This stage has been removed from the engagement, so there is nothing left to
									describe. The ticket keeps the price it was agreed at.
								</p>
							)
							: (
								<>
									<section class="tkc-insp__sec">
										<h4 class="tkc-insp__sectitle">Stage brief</h4>
										<p class="tkc-insp__prose">
											{stage.description || "The client has not written a brief for this stage."}
										</p>
									</section>

									<section class="tkc-insp__sec">
										<h4 class="tkc-insp__sectitle">Assigned ({stage.members.length})</h4>
										{stage.members.length === 0
											? <p class="tkc-insp__none">No one is assigned to this stage yet.</p>
											: (
												<ul class="tkc-people">
													{stage.members.map((m) => (
														<li key={m.handle ?? m.name} class="tkc-people__row">
															<Avatar image={m.avatar ?? undefined} label={m.name} size={26} />
															<span class="tkc-people__name">{m.name}</span>
															{m.handle
																? <span class="tkc-people__handle">@{m.handle}</span>
																: null}
														</li>
													))}
												</ul>
											)}
									</section>

									<section class="tkc-insp__sec">
										<h4 class="tkc-insp__sectitle">
											Tickets in this stage ({stageTickets.length})
										</h4>
										{stageTickets.length === 0
											? <p class="tkc-insp__none">Nothing routed here yet.</p>
											: (
												<ul class="tkc-tix">
													{stageTickets.slice(0, 6).map((t) => (
														<li key={t.id} class="tkc-tix__row">
															<span class="tkc-tix__status" data-tone={statusTone(t.status)}>
																{statusLabel(t.status)}
															</span>
															<span class="tkc-tix__title">{t.title}</span>
														</li>
													))}
													{stageTickets.length > 6
														? <li class="tkc-tix__more">+{stageTickets.length - 6} more</li>
														: null}
												</ul>
											)}
									</section>

									<section class="tkc-insp__sec">
										<h4 class="tkc-insp__sectitle">Operating settings</h4>
										<dl class="tkc-facts">
											<Fact label="Status">
												<span
													class="tkc-tix__status"
													data-tone={STAGE_TONE[stage.status] ?? "neutral"}
												>
													{STAGE_STATUS_LABEL[stage.status] ?? stage.status}
												</span>
											</Fact>
											<Fact label="Ticket rate">
												{stage.unitPriceCents === null
													? "Not set"
													: `${formatTicketMoney(stage.unitPriceCents)} per standard ticket`}
											</Fact>
											<Fact label="Routing">{ASSIGNMENT_MODE_LABEL[stage.assignmentMode]}</Fact>
											<Fact label="Capacity cap">
												{stage.maxConcurrentIntensity === null
													? "No stage cap"
													: `W ${stage.maxConcurrentIntensity} per freelancer`}
											</Fact>
											<Fact label="This ticket consumes">
												<Tooltip content="The stage's category weight scaled by the intensity chosen for this ticket.">
													<span tabIndex={0}>
														W {workload.toFixed(2).replace(/\.00$/, "")}
													</span>
												</Tooltip>
											</Fact>
										</dl>
									</section>
								</>
							)}
					</div>
				)}
		</aside>
	);
}

import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { DatePicker, Select } from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { HintPopover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { sanitizeRichText } from "@projective/types/richtext";
import {
	ASSIGNMENT_MODE_LABEL,
	type BoardCard,
	type BoardStageRef,
	formatTicketMoney,
	INTENSITY_PRICE_MULTIPLIER,
	LOCKED_INTENSITY_HINT,
	type ProjectStatus,
	stageIntensityLocked,
	TICKET_INTENSITY_HINT,
	TICKET_INTENSITY_LABEL,
	type TicketIntensity,
	type TicketStageRef,
	type TicketTask,
} from "../../types/projects-types.ts";
import { statusLabel, statusTone } from "../../core/board-model.ts";
import {
	formatDueDate,
	fromDateInput,
	priceMultiplierText,
	stageIntensityOptions,
	toDateInput,
} from "../../core/ticket-model.ts";
import type { TicketStageView } from "../../core/ticket-view.ts";
import { TaskListEditor } from "./TaskListEditor.tsx";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { fundingRollup } from "../../core/funding-ui.ts";

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
 *
 * A stage sold at one fixed intensity (the seller's term, {@link BoardStageRef.intensityLocked}) reads
 * its intensity and price as Meta text rather than offering them: a client cannot discount it.
 */
export interface StageInspectorProps {
	item: TicketStageView;
	/** Tickets already routed through this stage — the load the client is adding to. */
	stageTickets: BoardCard[];
	editable: boolean;
	/** The engagement's currency (`BoardCard.currency`). */
	currency: string;
	/**
	 * `close` in the side panel beside the stage list; `back` where the inspector REPLACES the list
	 * (the create pane, the narrow Stages tab), so leaving it returns to the stages.
	 */
	nav?: "close" | "back";
	onClose: () => void;
	onPatch: (patch: Partial<TicketStageRef>) => void;
	/**
	 * This ticket's funding line, when the inspected stage is the one the ticket sits in — status only:
	 * the footer owns the action, so the panel never offers it a second time.
	 */
	funding?: JSX.Element | null;
}

/** How this ticket's price in a stage was reached, in words, beside the figure. */
function priceBasis(
	ref: TicketStageRef,
	stage: BoardStageRef | null,
	baseCents: number | null,
	currency: string,
): string {
	const label = TICKET_INTENSITY_LABEL[ref.intensity];
	if (stageIntensityLocked(stage)) return `Fixed price · ${label} intensity`;
	const own = (ref.intensity === "low" && typeof stage?.lowPriceCents === "number") ||
		(ref.intensity === "high" && typeof stage?.highPriceCents === "number");
	if (own) return `The provider's ${label} price`;
	if (baseCents === null) return "This stage has no ticket rate yet";
	return `${formatTicketMoney(baseCents, currency)} base · ${label} intensity (${
		priceMultiplierText(INTENSITY_PRICE_MULTIPLIER[ref.intensity])
	})`;
}

/** The stage's intensity pricing, as the overview's operating settings state it. */
function pricingTerms(stage: BoardStageRef, currency: string): string {
	if (stageIntensityLocked(stage)) return "One fixed intensity and price, set by the provider";
	const tiers: string[] = [];
	if (typeof stage.lowPriceCents === "number") {
		tiers.push(`Low ${formatTicketMoney(stage.lowPriceCents, currency)}`);
	}
	if (typeof stage.highPriceCents === "number") {
		tiers.push(`High ${formatTicketMoney(stage.highPriceCents, currency)}`);
	}
	return tiers.length > 0 ? `Tiered · ${tiers.join(" · ")}` : "Tiered · 0.75× · 1.0× · 1.5×";
}

/** A stage's lifecycle reads in the client's words, not the enum's. */
const STAGE_STATUS_LABEL: Record<ProjectStatus, string> = {
	draft: "Not started",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
	archived: "Archived",
};

const STAGE_TONE: Record<ProjectStatus, string> = {
	draft: "neutral",
	active: "progress",
	on_hold: "warning",
	completed: "success",
	cancelled: "muted",
	archived: "muted",
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
	const { item, stageTickets, editable, currency } = props;
	const { ref, stage, costCents, workload } = item;
	const tab = useSignal<"overview" | "config">("config");

	const tabId = (t: string) => `tkc-insp-${t}`;
	const panelId = (t: string) => `tkc-insp-panel-${t}`;
	const baseCents = ref.unitPriceCents ?? stage?.unitPriceCents ?? null;
	const owed = fundingRollup(stageTickets);
	const fixed = stageIntensityLocked(stage);
	const back = props.nav === "back";

	return (
		<aside
			class="tkc-insp"
			data-stage-id={ref.stageId}
			aria-label={`${ref.name} details`}
			tabIndex={-1}
		>
			<header class="tkc-insp__head">
				{back
					? (
						<Tooltip content="All stages">
							<button
								type="button"
								class="tkc-insp__close"
								aria-label="Back to all stages"
								onClick={props.onClose}
							>
								<Icon name="arrow-left" size="sm" />
							</button>
						</Tooltip>
					)
					: null}
				<div class="tkc-insp__ident">
					<span class="tkc-insp__eyebrow">Step {item.band + 1}</span>
					<h3 class="tkc-insp__title">{ref.name}</h3>
				</div>
				{back ? null : (
					<button
						type="button"
						class="tkc-insp__close"
						aria-label="Close stage details"
						onClick={props.onClose}
					>
						<Icon name="close" size="sm" />
					</button>
				)}
			</header>

			<div class="tkc-insp__price">
				<span class="tkc-insp__amount">
					{costCents === null ? "Not priced" : formatTicketMoney(costCents, currency)}
				</span>
				<span class="tkc-insp__amountsub">{priceBasis(ref, stage, baseCents, currency)}</span>
			</div>
			{props.funding ? <div class="tkc-insp__funding">{props.funding}</div> : null}

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
										// The same 640px pane as the ticket description, but this editor shares a
										// 482px inspector body with the intensity override and the stage task list —
										// so its ceiling is lower, at half that body. Leaving the two editors in one
										// modal on different rules is the inconsistency this closes.
										maxAutoHeight="15rem"
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
											__html: sanitizeRichText(ref.brief) ||
												"<p>No brief was written for this stage on this ticket.</p>",
										}}
									/>
								)}
						</div>

						{editable && !fixed
							? (
								<div class="tkc-field">
									<span class="tkc-label" id="tkc-stageint-label">Intensity in this stage</span>
									<Select
										size="sm"
										value={ref.intensity}
										options={stageIntensityOptions(stage, baseCents, currency)}
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
									<Fact label="Intensity">
										{fixed
											? (
												<Tooltip content={LOCKED_INTENSITY_HINT}>
													<span class="tkc-fact__fixed" tabIndex={0}>
														<Icon name="lock" size="2xs" />
														{TICKET_INTENSITY_LABEL[ref.intensity]} · fixed by the provider
													</span>
												</Tooltip>
											)
											: TICKET_INTENSITY_LABEL[ref.intensity]}
									</Fact>
								</dl>
							)}

						{editable
							? (
								<div class="tkc-field">
									<span class="tkc-label tkc-label--hint">
										Due date
										<HintPopover label="About stage due dates">
											The ticket is due on the latest of its stage dates. A due date needs the
											project's deadline bonus terms switched on.
										</HintPopover>
									</span>
									<DatePicker
										class="tkc-due"
										size="sm"
										value={toDateInput(ref.dueAt ?? null)}
										placeholder="No date"
										aria-label={`Due date in ${ref.name}`}
										dateFormat="M d, yy"
										showButtonBar
										onValueChange={(v) =>
											props.onPatch({
												dueAt: fromDateInput(Array.isArray(v) ? v[0] ?? null : v),
											})}
									/>
								</div>
							)
							: (
								<dl class="tkc-facts">
									<Fact label="Due">{formatDueDate(ref.dueAt ?? null) ?? "No date"}</Fact>
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
															<UserAvatar image={m.avatar ?? undefined} label={m.name} size={26} />
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
										{owed.count > 0
											? (
												<p class="tkc-insp__none">
													{owed.count} {owed.count === 1 ? "needs" : "need"}{" "}
													{formatTicketMoney(owed.totalMinor, owed.currency ?? currency)}{" "}
													before work can start.
												</p>
											)
											: null}
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
													: `${formatTicketMoney(stage.unitPriceCents, currency)} per ${
														fixed ? "ticket" : "standard ticket"
													}`}
											</Fact>
											<Fact label="Intensity pricing">{pricingTerms(stage, currency)}</Fact>
											<Fact label="Routing">{ASSIGNMENT_MODE_LABEL[stage.assignmentMode]}</Fact>
											<Fact label="Capacity cap">
												{stage.maxConcurrentIntensity === null
													? "No stage cap"
													: `W ${stage.maxConcurrentIntensity} per freelancer`}
											</Fact>
											<Fact label="Fund on arrival">
												{stage.chainReaction
													? "Held when the previous stage is approved"
													: "Funded by hand"}
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

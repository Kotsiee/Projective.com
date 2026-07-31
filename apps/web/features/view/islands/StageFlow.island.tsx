import type { JSX } from "preact";
import { useSignalEffect } from "@preact/signals";
import "../styles/project-view.css";
import { ViewIcon } from "../components/view-glyphs.tsx";
import { selectedStageId, STAGE_FLOW_ANCHOR } from "../core/view-state.ts";
import type { ProjectStage } from "@projective/types/explore";

/**
 * StageFlow — the interactive Stage Flow visualizer for the Projects view (the "expandable stacked
 * cards" concept). Each stage is a full-width card in a vertical stack down a slim progress rail
 * (completed · active · upcoming node markers). The collapsed header always shows the seat-fill meter +
 * per-ticket price; the active stage is expanded by default. Expanding reveals the stage description,
 * its openings — either a general **Open Seats** pool (a summary + shared ticket price) or named
 * **Open Roles** (each with an open-seat count + its own ticket price) — and the required-skill tags.
 *
 * It is a single-open accordion driven by the shared `selectedStageId` signal, so the side-nav
 * quick-jumps and an in-flow click share one selection: writing the signal (here on header click, or
 * from the lane's `jumpToStage`) expands that stage AND scrolls it under the sticky chrome. `null` =
 * "default to the active stage"; `""` = "all collapsed".
 */
export interface StageFlowProps {
	stages: ProjectStage[];
	/** The project title — names the flow for assistive tech. */
	title: string;
	/**
	 * How an unpopulated stage (no description / pricing / seats / skills) degrades — the difference
	 * between a fully-composed discovery listing and an in-setup `/projects/[id]` engagement (root brief
	 * §"Handling Incomplete Data"). `none` (default) keeps the discovery behaviour byte-identical; a
	 * project passes `neutral` (calm placeholder) or `prompt` (owner-facing "add …" affordance).
	 */
	emptyState?: "none" | "neutral" | "prompt";
}

export default function StageFlow(
	{ stages, title, emptyState = "none" }: StageFlowProps,
): JSX.Element {
	const prompt = emptyState === "prompt";
	const showEmpty = emptyState !== "none";
	const activeId = stages.find((s) => s.status === "active")?.id ?? stages[0]?.id ?? "";

	/** The currently-open stage: an explicit selection, else the active stage; `""` = none. */
	function openId(): string {
		const sel = selectedStageId.value;
		return sel === null ? activeId : sel;
	}

	// React to a selection (from an in-flow click or a lane quick-jump): scroll the chosen stage into
	// view under the sticky chrome. Guarded so a "collapse-all" (`""`) or the default (`null`) never
	// scrolls; `scroll-margin` on `.vw-stage` offsets the top bar + header band.
	useSignalEffect(() => {
		const sel = selectedStageId.value;
		if (!sel) return;
		try {
			const el = document.getElementById(sel);
			if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
		} catch { /* no DOM — non-fatal */ }
	});

	function toggle(id: string): void {
		selectedStageId.value = openId() === id ? "" : id;
	}

	return (
		<section id={STAGE_FLOW_ANCHOR} class="vw-stageflow" aria-label={`Stages for ${title}`}>
			<ol class="vw-stageflow__list" role="list">
				{stages.map((stage) => {
					const open = openId() === stage.id;
					const openSeats = stage.openSeats;
					const isRoles = stage.seatKind === "roles";
					// Service stages recruit no seats — they showcase a workflow, so the seat machinery is
					// suppressed and the sub-line falls back to the turnaround.
					const hasSeats = stage.seatsTotal > 0;
					const hasPrice = stage.price.label.trim().length > 0;
					const hasDesc = stage.description.trim().length > 0;
					const seatWord = openSeats === 1 ? "seat" : "seats";
					const subText = !hasSeats
						? (stage.deliverables?.length
							? `${stage.deliverables.length} deliverable${
								stage.deliverables.length === 1 ? "" : "s"
							}`
							: (stage.turnaround ??
								(showEmpty && !hasDesc
									? (prompt ? "Add scope & pricing" : "Not configured yet")
									: "Scope & delivery")))
						: stage.status === "completed"
						? "Fully staffed"
						: isRoles
						? `${stage.roles.length} role${
							stage.roles.length === 1 ? "" : "s"
						} · ${openSeats} open ${seatWord}`
						: `${openSeats} open ${seatWord}`;
					const bodyId = `${stage.id}-body`;
					return (
						<li
							key={stage.id}
							id={stage.id}
							class="vw-stage"
							data-status={stage.status}
							data-open={open ? "true" : "false"}
						>
							<div class="vw-stage__rail" aria-hidden="true">
								<span class="vw-stage__node">
									{stage.status === "completed"
										? <ViewIcon name="check" size={13} />
										: <span class="vw-stage__num">{stage.index}</span>}
								</span>
							</div>

							<div class="vw-stage__card">
								<button
									type="button"
									class="vw-stage__head"
									aria-expanded={open}
									aria-controls={bodyId}
									onClick={() => toggle(stage.id)}
								>
									<span class="vw-stage__heading">
										<span class="vw-stage__name">
											{stage.name}
											{stage.status === "active"
												? <span class="vw-stage__flag">Active</span>
												: null}
										</span>
										<span class="vw-stage__sub">{subText}</span>
									</span>

									{hasSeats
										? (
											<span
												class="vw-seatmeter"
												aria-label={`${stage.seatsFilled} of ${stage.seatsTotal} seats filled`}
											>
												{Array.from({ length: stage.seatsTotal }, (_, i) => (
													<span
														key={i}
														class="vw-seatmeter__seg"
														data-filled={i < stage.seatsFilled ? "true" : "false"}
													/>
												))}
												<span class="vw-seatmeter__label">
													{openSeats > 0 ? `${openSeats} open` : "Full"}
												</span>
											</span>
										)
										: stage.turnaround
										? <span class="vw-stage__turn">{stage.turnaround}</span>
										: null}

									{hasPrice ? <span class="vw-stage__price">{stage.price.label}</span> : null}
									<ViewIcon name="chevron-down" size={18} class="vw-stage__chev" />
								</button>

								<div id={bodyId} class="vw-stage__body" role="region" aria-label={stage.name}>
									<div class="vw-stage__bodyinner">
										{hasDesc
											? <p class="vw-stage__desc">{stage.description}</p>
											: (
												<p class="vw-stage__desc vw-empty">
													{prompt
														? "Add a description, deliverables and pricing for this stage."
														: "No description added for this stage yet."}
												</p>
											)}

										<div class="vw-stage__facts">
											{hasSeats
												? (
													<span class="vw-stage__fact">
														<ViewIcon name="seats" size={16} />
														<span>
															<strong>{openSeats > 0 ? `${openSeats} open` : "Full"}</strong>
															{stage.status === "completed" ? " · fully staffed" : " · this stage"}
														</span>
													</span>
												)
												: null}
											{stage.turnaround
												? (
													<span class="vw-stage__fact">
														<ViewIcon name="clock" size={16} />
														<span>
															<strong>{stage.turnaround}</strong> turnaround
														</span>
													</span>
												)
												: null}
											{stage.dependency
												? (
													<span class="vw-stage__fact">
														<ViewIcon name="stages" size={16} />
														<span>{stage.dependency}</span>
													</span>
												)
												: null}
											{hasPrice
												? (
													<span class="vw-stage__fact">
														<ViewIcon name="ticket" size={16} />
														<span>
															<strong>{stage.price.label}</strong>
														</span>
													</span>
												)
												: null}
											{isRoles && stage.roles.length > 0
												? (
													<span class="vw-stage__fact">
														<ViewIcon name="roles" size={16} />
														<span>
															<strong>{stage.roles.length}</strong>{" "}
															role{stage.roles.length === 1 ? "" : "s"}
														</span>
													</span>
												)
												: null}
										</div>

										{/* Open Roles variant — named roles, each with its open-seat count + ticket price. */}
										{isRoles && stage.roles.length > 0
											? (
												<div class="vw-stage__group">
													<span class="vw-stage__grouplabel">Open roles</span>
													<ul class="vw-roles" role="list">
														{stage.roles.map((r, i) => (
															<li key={`${r.name}-${i}`} class="vw-role">
																<span class="vw-role__icon" aria-hidden="true">
																	<ViewIcon name="roles" size={15} />
																</span>
																<span class="vw-role__name">{r.name}</span>
																<span class="vw-role__seats">
																	{r.openSeats} open {r.openSeats === 1 ? "seat" : "seats"}
																</span>
																<span class="vw-role__price">{r.price.label}</span>
															</li>
														))}
													</ul>
												</div>
											)
											: null}

										{/* Open Seats variant — a general pool description + the shared ticket price. */}
										{!isRoles && stage.seatSummary
											? (
												<div class="vw-stage__group">
													<span class="vw-stage__grouplabel">Open seats</span>
													<div class="vw-seatpool">
														<p class="vw-seatpool__desc">{stage.seatSummary}</p>
														{stage.status !== "completed"
															? (
																<div class="vw-seatpool__meta">
																	<span class="vw-seatpool__count">
																		{openSeats} open {openSeats === 1 ? "seat" : "seats"}
																	</span>
																	<span class="vw-seatpool__price">{stage.price.label}</span>
																</div>
															)
															: null}
													</div>
												</div>
											)
											: null}

										{/* Deliverables — the "what you get" bullets (service stage showcase). */}
										{stage.deliverables && stage.deliverables.length > 0
											? (
												<div class="vw-stage__group">
													<span class="vw-stage__grouplabel">Deliverables</span>
													<ul class="vw-stage__deliverables" role="list">
														{stage.deliverables.map((d) => (
															<li key={d} class="vw-stage__deliverable">
																<ViewIcon name="check" size={14} />
																<span>{d}</span>
															</li>
														))}
													</ul>
												</div>
											)
											: null}

										<div class="vw-stage__group">
											<span class="vw-stage__grouplabel">Required skills</span>
											<ul class="vw-chips" role="list">
												{stage.skills.map((s) => (
													<li key={s.label} class="vw-chip vw-chip--skill" data-cat={s.category}>
														<ViewIcon name="skill" size={13} />
														<span>{s.label}</span>
													</li>
												))}
											</ul>
										</div>
									</div>
								</div>
							</div>
						</li>
					);
				})}
			</ol>
		</section>
	);
}

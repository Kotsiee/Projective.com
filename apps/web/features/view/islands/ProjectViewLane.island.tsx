import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
// Reuse the profile lane's `pf-lane*` skeleton (collapsed rail ⇄ expanded stack, density-switched by
// `.ui-splitter[data-mode]` / `:root[data-guest-nav]`); `project-view.css` layers the finance/jump
// content on top.
import "@features/profile/styles/profile.css";
import "../styles/project-view.css";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { ViewLaneHeader } from "../components/ViewLaneHeader.tsx";
import { ViewIcon } from "../components/view-glyphs.tsx";
import {
	applyToProject,
	jumpToStage,
	projectApplied,
	projectSaved,
	toggleProjectSaved,
} from "../core/view-state.ts";
import type { ExploreItem, ProjectViewExtra } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * ProjectViewLane — the Projects view's contextual navigation sidebar (the "side nav" brief). It reuses
 * the profile `pf-lane` skeleton VERBATIM, so it drops into the guest floating aside AND the authed
 * middle-nav lane with identical chrome + collapse behaviour. Instead of transactional CTAs it offers
 * *project navigation*: a ticket-price/seat summary + key-metric chips and quick-jumps to each stage
 * (writing the shared `selectedStageId`, which the `StageFlow` island expands + scrolls into view). The
 * collapsed rail becomes numbered stage-jump squares. Apply lives here too for reach when scrolled.
 */
export interface ProjectViewLaneProps {
	item: ExploreItem;
	project: ProjectViewExtra;
	authed: boolean;
	ctx: HrefContext;
}

function setLaneCollapsed(next: boolean): void {
	try {
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	} catch { /* SSR / no window — non-fatal */ }
}

export default function ProjectViewLane(
	{ item, project, authed, ctx }: ProjectViewLaneProps,
): JSX.Element {
	const { finance, metrics, stages } = project;
	const applied = projectApplied.value;

	return (
		<div class="pf-lane vw-lane vw-projlane">
			{/* Collapsed icon rail — CSS reveals it only at the narrow density. */}
			<nav class="pf-lane__rail" aria-label={`Navigate ${item.title}`}>
				<div class="pf-lane__rail-group">
					<Tooltip content={applied ? "Applied" : "Apply to project"} placement="right">
						<button
							type="button"
							class="pf-railbtn pf-railbtn--primary"
							data-on={applied ? "true" : undefined}
							aria-label="Apply to project"
							onClick={() => applyToProject(item, authed, ctx)}
						>
							<ViewIcon name={applied ? "check" : "apply"} />
						</button>
					</Tooltip>
					{stages.map((s) => (
						<Tooltip key={s.id} content={s.name} placement="right">
							<button
								type="button"
								class="pf-railbtn vw-railnum"
								data-status={s.status}
								aria-label={`Jump to stage ${s.index}: ${s.name}`}
								onClick={() => jumpToStage(s.id)}
							>
								<span class="vw-railnum__n">{s.index}</span>
							</button>
						</Tooltip>
					))}
				</div>
				<div class="pf-lane__rail-group pf-lane__rail-group--bottom">
					<Tooltip content="Expand lane" placement="right">
						<button
							type="button"
							class="pf-railbtn pf-railbtn--toggle"
							data-collapsed="true"
							aria-label="Expand lane"
							aria-pressed={true}
							onClick={() => setLaneCollapsed(false)}
						>
							<SidebarToggleIcon />
						</button>
					</Tooltip>
				</div>
			</nav>

			{/* Expanded stack. */}
			<div class="pf-lane__full">
				<ViewLaneHeader
					item={item}
					ctx={ctx}
					saved={projectSaved}
					onToggleSaved={toggleProjectSaved}
				/>

				<div class="pf-lane__scroll vw-lane__scroll">
					{/* Ticket price + seat summary. */}
					<section class="vw-fin" aria-label="Project overview">
						<div class="vw-fin__lead">
							<span class="vw-fin__label">Ticket price</span>
							<span class="vw-fin__value">{finance.ticketPrice.label}</span>
						</div>
						<div class="vw-fin__meta">
							<span class="vw-fin__note">
								{finance.openSeats} open of {finance.totalSeats} seats across the project
							</span>
						</div>

						<ul class="vw-metrics" role="list">
							{metrics.map((m) => (
								<li key={m.label} class="vw-metric">
									<span class="vw-metric__icon" aria-hidden="true">
										<ViewIcon name={m.icon} size={16} />
									</span>
									<span class="vw-metric__label">{m.label}</span>
									<span class="vw-metric__value">{m.value}</span>
								</li>
							))}
						</ul>
					</section>

					{/* Stage quick-jumps. */}
					<section class="vw-jumps" aria-label="Jump to a stage">
						<span class="vw-jumps__head">Stages</span>
						<ul class="vw-jumps__list" role="list">
							{stages.map((s) => {
								const openSeats = s.openSeats;
								return (
									<li key={s.id}>
										<button
											type="button"
											class="vw-jump"
											data-status={s.status}
											onClick={() => jumpToStage(s.id)}
										>
											<span class="vw-jump__idx" aria-hidden="true">{s.index}</span>
											<span class="vw-jump__text">
												<span class="vw-jump__name">{s.name}</span>
												<span class="vw-jump__sub">
													{openSeats > 0 ? `${openSeats} open` : "Full"} · {s.price.label}
												</span>
											</span>
											<ViewIcon name="chevron-right" size={16} class="vw-jump__chev" />
										</button>
									</li>
								);
							})}
						</ul>
					</section>

					<button
						type="button"
						class="vw-cta vw-cta--primary vw-projlane__apply"
						data-on={applied ? "true" : undefined}
						aria-pressed={applied}
						onClick={() => applyToProject(item, authed, ctx)}
					>
						<ViewIcon name={applied ? "check" : "apply"} size={18} />
						<span>{applied ? "Applied" : "Apply to project"}</span>
					</button>
				</div>

				<div class="pf-lane__footer">
					<Tooltip content="Collapse lane" placement="top">
						<button
							type="button"
							class="pf-lane__collapse"
							aria-label="Collapse lane"
							aria-pressed={false}
							onClick={() => setLaneCollapsed(true)}
						>
							<SidebarToggleIcon />
						</button>
					</Tooltip>
				</div>
			</div>
		</div>
	);
}

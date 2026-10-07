import type { ComponentChildren, JSX } from "preact";
import { EmptyState } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
import type { ProjectSummary } from "@projective/types/projects";
import PortfolioStyleAnchor from "../../islands/PortfolioStyleAnchor.island.tsx";
import {
	aggregateBurn,
	burnPercent,
	countByFilter,
	filterPortfolio,
	FORMAT_LABEL,
	meterSegments,
	PORTFOLIO_FILTER_LABEL,
	PORTFOLIO_FILTERS,
	type PortfolioFilter,
	portfolioHref,
	ROLE_LABEL,
	type StageBurn,
	stageBurnOf,
	STATUS_LABEL,
} from "../../core/portfolio-model.ts";

/**
 * ProjectPortfolio — the `/projects` index: every project in the active workspace, the portfolio's
 * aggregate stage burn, and a status filter.
 *
 * A SERVER component, and every control on it is a link. The status filter re-addresses the page
 * (`?status=`), so the server-rendered list it drives is re-rendered by the server — a control that
 * filtered this DOM from an island would be filtering markup it did not render (§3 gate 11), and a
 * filtered view a reader cannot link to is a view they cannot come back to.
 *
 * Layout follows the anti-card rules: the summary is unboxed type on the page's ground, the list is
 * hairline-separated rows (no card per project, no container around the list), metadata is one
 * middot line, and the only contained things are the filter controls (controls), their figures
 * (counts) and each row's lifecycle status (§B.11 — the three things containment is for).
 *
 * The empty state's one action opens the Quick-Init create modal, which lives in the projects lane
 * beside this page and opens on `?create=1` (the same deep link the header's Create menu uses).
 */
export interface ProjectPortfolioProps {
	items: readonly ProjectSummary[];
	filter: PortfolioFilter;
	contextLabel: string;
	/**
	 * Sections that follow the list on the same ground — the viewer's sent proposals
	 * (`ProposalList`). Rendered in the empty state too: a freelancer with no projects of their own
	 * may still have proposals out.
	 */
	children?: ComponentChildren;
}

export function ProjectPortfolio(
	{ items, filter, contextLabel, children }: ProjectPortfolioProps,
): JSX.Element {
	if (items.length === 0) {
		return (
			<div class="prj-port prj-port--empty">
				<PortfolioStyleAnchor />
				<EmptyState
					title="No projects yet"
					description="Post a brief, split it into stages and staff each one. You can set everything else up after the draft exists."
					actions={
						<a
							class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded"
							href="/projects?create=1"
						>
							<span class="ui-button__label">Create a project</span>
						</a>
					}
				/>
				{children}
			</div>
		);
	}

	const counts = countByFilter(items);
	const visible = filterPortfolio(items, filter);
	const burn = aggregateBurn(visible);
	const scope = filter === "all" ? "" : ` · ${PORTFOLIO_FILTER_LABEL[filter].toLowerCase()}`;

	return (
		<div class="prj-port">
			<PortfolioStyleAnchor />

			<header class="prj-port__head">
				<h1 class="prj-port__title">Projects</h1>
				<p class="prj-port__meta">
					{contextLabel}
					<span aria-hidden="true">·</span>
					<span>
						<span class="prj-port__num">{items.length}</span>{" "}
						{items.length === 1 ? "project" : "projects"}
					</span>
				</p>
			</header>

			{
				/*
				  The aggregate stage burn of what is IN VIEW — so filtering to Active answers "how far
				  through is the live work", which is the question a portfolio figure exists to answer.
				*/
			}
			<section class="prj-port__summary" aria-labelledby="prj-port-burn">
				<h2 class="prj-port__eyebrow" id="prj-port-burn">Stage burn{scope}</h2>
				{burn
					? (
						<>
							<p class="prj-port__figure">
								<span class="prj-port__pct">{burnPercent(burn)}%</span>
								<span class="prj-port__figurenote">
									<span class="prj-port__num">{burn.completed}</span> of{" "}
									<span class="prj-port__num">{burn.total}</span> stages delivered across{" "}
									<span class="prj-port__num">{burn.projects}</span> staged{" "}
									{burn.projects === 1 ? "project" : "projects"}
								</span>
							</p>
							<SegmentMeter burn={burn} size="lg" />
						</>
					)
					: (
						<p class="prj-port__figurenote">
							No staged projects in view, so there is nothing to burn through yet.
						</p>
					)}
			</section>

			<nav class="prj-port__filters" aria-label="Filter projects by status">
				{PORTFOLIO_FILTERS.map((f) => (
					<a
						key={f}
						class="prj-port__filter"
						href={portfolioHref(f)}
						aria-current={f === filter ? "page" : undefined}
					>
						<span>{PORTFOLIO_FILTER_LABEL[f]}</span>
						<span class="prj-port__count">{counts[f]}</span>
					</a>
				))}
			</nav>

			{visible.length === 0
				? (
					<p class="prj-port__none">
						No {PORTFOLIO_FILTER_LABEL[filter].toLowerCase()} projects.{" "}
						<a class="prj-port__inline" href={portfolioHref("all")}>Show all</a>
					</p>
				)
				: (
					<ul class="prj-port__list" aria-label={`${PORTFOLIO_FILTER_LABEL[filter]} projects`}>
						{visible.map((item) => <PortfolioRow key={item.id} item={item} />)}
					</ul>
				)}

			{children}
		</div>
	);
}

// #region Row
/** One project: the title as the row's link, a meta line, its lifecycle status and its stage burn. */
function PortfolioRow({ item }: { item: ProjectSummary }): JSX.Element {
	const burn = stageBurnOf(item);
	const meta = [FORMAT_LABEL[item.format], ROLE_LABEL[item.viewerRole], item.scopeLabel];
	if (item.counterparty) meta.push(item.counterparty.name);
	if (item.budgetLabel) meta.push(item.budgetLabel);

	return (
		<li class="prj-port__row" data-status={item.status}>
			<a class="prj-port__link" href={`/projects/${item.slug}`}>
				<span class="prj-port__name">{item.title}</span>
				<span class="prj-port__rowmeta">{meta.join(" · ")}</span>
			</a>

			<span class="prj-port__status" data-status={item.status}>
				<span class="prj-port__dot" aria-hidden="true" />
				{STATUS_LABEL[item.status]}
			</span>

			<span class="prj-port__burn">
				{burn
					? (
						<>
							<SegmentMeter burn={burn} size="sm" />
							<span class="prj-port__burnnote">
								<span class="prj-port__num">{burn.completed}</span>/<span class="prj-port__num">
									{burn.total}
								</span>{" "}
								stages
							</span>
						</>
					)
					: (
						<span class="prj-port__burnnote prj-port__burnnote--none">
							<Icon name="projects" size="xs" aria-hidden />
							No stages
						</span>
					)}
			</span>
		</li>
	);
}
// #endregion

// #region Meter
/**
 * A segmented track meter (§D.8.4): one segment per stage, filled for delivered ones. Discrete
 * segments rather than a width-driven fill, so the geometry is pure markup and needs no inline style
 * and no animated property — and decorative (`aria-hidden`), because the figure beside it is the fact.
 */
function SegmentMeter({ burn, size }: { burn: StageBurn; size: "sm" | "lg" }): JSX.Element {
	const { filled, total } = meterSegments(burn, size === "lg" ? 40 : 12);
	return (
		<span class={`prj-port__meter prj-port__meter--${size}`} aria-hidden="true">
			{Array.from(
				{ length: total },
				(_, i) => (
					<span
						key={i}
						class="prj-port__seg"
						data-done={i < filled ? "true" : undefined}
					/>
				),
			)}
		</span>
	);
}
// #endregion

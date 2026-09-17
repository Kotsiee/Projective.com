import type { JSX } from "preact";
import { ProgressiveImage } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { OwnerBadge } from "./OwnerBadge.tsx";
import { RatingTracks } from "./RatingTracks.tsx";
import { SkillPills } from "./SkillPill.tsx";
import { type HrefContext, itemHref } from "../core/routing.ts";
import { freelancerFloor, servicePricing } from "../core/pricing.ts";
import type { ExploreItem } from "../types/explore-types.ts";

/**
 * DetailPanel — the full item detail, shared by the Search Results split-pane drawer and the
 * standalone `/view/[id]` page. Renders media (when present — never for projects), owner attribution,
 * both reputation tracks, skills, an entity-specific meta block, and the synopsis. In the drawer,
 * `openFullHref` renders the primary "Open full page →" link (a real anchor, so middle-click opens a
 * new tab); on the standalone page it is omitted.
 */
export function DetailPanel(
	{ item, ctx = { scope: "explore" }, showOpenFull = true }: {
		item: ExploreItem;
		ctx?: HrefContext;
		showOpenFull?: boolean;
	},
): JSX.Element {
	return (
		<div class="ex-detail">
			{item.media && (
				<div class="ex-detail__media">
					<ProgressiveImage src={item.media} placeholder={item.mediaPlaceholder} loading="lazy" />
				</div>
			)}

			<div class="ex-detail__head">
				<span class="ex-eyebrow">{ENTITY_LABEL[item.type]}</span>
				<h2 class="ex-detail__title">{item.title}</h2>
				<OwnerBadge owner={item.owner} size="md" />
			</div>

			<MetaBlock item={item} />

			{/* Freelancers surface only their helper reputation — never their client track (§4a). */}
			<RatingTracks
				rating={item.type === "freelancers" ? { asHelper: item.rating?.asHelper } : item.rating}
				layout="stack"
			/>

			{item.skills.length > 0 && (
				<div class="ex-detail__section">
					<h3 class="ex-detail__label">Skills</h3>
					<SkillPills skills={item.skills} max={8} />
				</div>
			)}

			<div class="ex-detail__section">
				<h3 class="ex-detail__label">About</h3>
				<p class="ex-detail__summary">{item.summary}</p>
			</div>

			{showOpenFull && (
				<a class="ex-btn ex-btn--solid ex-detail__open" href={itemHref(item, ctx)}>
					<span>Open full page</span>
					<Icon name="arrow-right" aria-hidden />
				</a>
			)}
		</div>
	);
}

// #region Entity meta
const ENTITY_LABEL: Record<ExploreItem["type"], string> = {
	users: "Individual",
	freelancers: "Freelancer",
	teams: "Team",
	businesses: "Business",
	services: "Service",
	projects: "Project",
	products: "Product",
	articles: "Article",
};

/** The entity-specific facts row (price, stage, budget, delivery, …). */
function MetaBlock({ item }: { item: ExploreItem }): JSX.Element | null {
	switch (item.type) {
		case "freelancers": {
			const floor = freelancerFloor(item);
			return (
				<dl class="ex-detail__meta">
					<Fact label="Specialism" value={item.craft} />
					<Fact label="Delivered" value={`${item.delivered} engagements`} />
					<Fact label="Services" value={`${item.servicePrices?.length ?? 0}`} />
					{item.products !== undefined && <Fact label="Products" value={`${item.products}`} />}
					{item.workload && <Fact label="Availability" value={item.workload.status} />}
					{floor && <Fact label="From" value={floor.replace(/^from /, "")} />}
				</dl>
			);
		}
		case "users":
		case "teams":
		case "businesses":
			return (
				<dl class="ex-detail__meta">
					<Fact label="Specialism" value={item.craft} />
					{item.delivered > 0 && <Fact label="Delivered" value={`${item.delivered}`} />}
					{item.members ? <Fact label="Team size" value={`${item.members} people`} /> : null}
				</dl>
			);
		case "services": {
			const pricing = servicePricing(item);
			const priceLabel = item.serviceType === "Pipeline"
				? "Price per ticket"
				: item.serviceType === "Session"
				? "Price per session"
				: item.serviceType === "Group Session"
				? "Price per seat"
				: "Price";
			const priceValue = pricing.unit ? `${pricing.amount} / ${pricing.unit}` : pricing.amount;
			return (
				<dl class="ex-detail__meta">
					<Fact label="Type" value={item.serviceType} />
					<Fact label={priceLabel} value={priceValue} />
					<Fact label="Delivery" value={item.delivery} />
					<Fact label="Category" value={item.category} />
				</dl>
			);
		}
		case "projects":
			return (
				<>
					<dl class="ex-detail__meta">
						<Fact label="Client" value={item.org} />
						<Fact label="Stage" value={item.stage} />
						<Fact label="Escrow budget" value={item.budget} />
					</dl>
					<div class="ex-detail__section">
						<h3 class="ex-detail__label">Phase plan</h3>
						<ol class="ex-detail__phases">
							{item.phases.map((phase, i) => (
								<li class="ex-detail__phase" key={phase}>
									<span class="ex-detail__phase-idx" aria-hidden="true">{i + 1}</span>
									<span>{phase}</span>
								</li>
							))}
						</ol>
					</div>
					<div class="ex-detail__section">
						<h3 class="ex-detail__label">Hiring for</h3>
						{
							/*
							  The roles a brief is staffing are FACTS, not controls, so they are one
							  middot-separated line rather than a row of outlined tags (§B.11.2 — a container
							  asserts an interactivity a role name does not have).
							*/
						}
						<p class="ex-detail__inline">
							{item.roles.map((r, i) => (
								<span class="ex-detail__inlineitem" key={`${i}:${r}`}>
									{i > 0 && <span class="ex-detail__dot" aria-hidden="true">·</span>}
									{r}
								</span>
							))}
						</p>
					</div>
				</>
			);
		case "products":
			return (
				<dl class="ex-detail__meta">
					<Fact label="Price" value={item.price} />
					<Fact label="Category" value={item.category} />
				</dl>
			);
		case "articles":
			return (
				<dl class="ex-detail__meta">
					<Fact label="Topic" value={item.topic} />
					<Fact label="Read time" value={`${item.readMinutes} min`} />
				</dl>
			);
	}
}

function Fact({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div class="ex-detail__fact">
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}
// #endregion

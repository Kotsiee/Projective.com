import type { ComponentChildren, JSX } from "preact";
import { Avatar, ProgressiveImage } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { personFallbackImage } from "@web/components/UserAvatar.tsx";
import { OwnerBadge } from "./OwnerBadge.tsx";
import { RatingTracks } from "./RatingTracks.tsx";
import { SkillPills } from "./SkillPill.tsx";
import { VerifiedBadge } from "./VerifiedBadge.tsx";
import { facetValueLabel } from "../core/filter-config.ts";
import {
	freelancerFloorAmount,
	type PriceAmount,
	projectBudgetAmount,
	serviceStartingPrice,
} from "../core/pricing.ts";
import type { ExploreItem, ProfileItem } from "../types/explore-types.ts";

/**
 * DetailPanel — the Search Results drawer's body: media (the item's picture, or a profile's banner
 * and avatar), the one title heading, owner attribution, the entity's facts, both reputation tracks,
 * skills and the synopsis. `titleId` lets the drawer name itself by this heading rather than repeat it
 * in its header. Prices render through `MoneyView` from the same structured amounts the cards read,
 * so the drawer quotes exactly the figure the card showed, in the viewer's currency.
 */
export function DetailPanel(
	{ item, titleId }: { item: ExploreItem; titleId: string },
): JSX.Element {
	const profile = isProfileMedia(item) ? item : null;

	return (
		<div class="ex-detail">
			{profile
				? <ProfileMedia item={profile} />
				: item.media && (
					<div class="ex-detail__media">
						<ProgressiveImage src={item.media} placeholder={item.mediaPlaceholder} alt="" />
					</div>
				)}

			<div class="ex-detail__head">
				<span class="ex-eyebrow">{ENTITY_LABEL[item.type]}</span>
				<h2 id={titleId} class="ex-detail__title">
					<span>{item.title}</span>
					{profile?.owner.verified && <VerifiedBadge size="md" kind={profile.owner.kind} />}
				</h2>
				{profile
					? <span class="ex-detail__handle">{profile.owner.handle}</span>
					: <OwnerBadge owner={item.owner} size="md" />}
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

			{item.summary && (
				<div class="ex-detail__section">
					<h3 class="ex-detail__label">About</h3>
					<p class="ex-detail__summary">{item.summary}</p>
				</div>
			)}
		</div>
	);
}

// #region Media
/** The profile kinds that carry a public banner and avatar worth framing. */
function isProfileMedia(item: ExploreItem): item is ProfileItem {
	return item.type === "freelancers" || item.type === "teams" || item.type === "businesses";
}

function ProfileMedia({ item }: { item: ProfileItem }): JSX.Element {
	return (
		<div class="ex-detail__profile">
			<div class="ex-detail__banner">
				{item.cover && (
					<ProgressiveImage src={item.cover} placeholder={item.coverPlaceholder} alt="" />
				)}
			</div>
			<Avatar
				image={item.owner.avatar}
				fallbackImage={personFallbackImage(item.owner.kind)}
				placeholder={item.owner.avatarPlaceholder}
				label={item.title}
				alt=""
				size="xl"
				shape={item.type === "businesses" ? "square" : "circle"}
				class="ex-detail__avatar"
			/>
		</div>
	);
}
// #endregion

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

/** `1 engagement` · `3 engagements` — a count and its noun agree. */
function counted(n: number, one: string, many: string): string {
	return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The entity-specific facts row (price, stage, budget, delivery, …). */
function MetaBlock({ item }: { item: ExploreItem }): JSX.Element | null {
	switch (item.type) {
		case "freelancers": {
			const floor = freelancerFloorAmount(item);
			return (
				<dl class="ex-detail__meta">
					<Fact label="Specialism">{item.craft}</Fact>
					<Fact label="Delivered">{counted(item.delivered, "engagement", "engagements")}</Fact>
					<Fact label="Services">{`${item.servicePrices?.length ?? 0}`}</Fact>
					{item.products !== undefined && <Fact label="Products">{`${item.products}`}</Fact>}
					{item.workload && <Fact label="Availability">{item.workload.status}</Fact>}
					{floor && (
						<Fact label="Services from">
							<Price amount={floor} />
						</Fact>
					)}
				</dl>
			);
		}
		case "users":
		case "teams":
		case "businesses":
			return (
				<dl class="ex-detail__meta">
					<Fact label="Specialism">{item.craft}</Fact>
					{item.delivered > 0 && (
						<Fact label="Delivered">{counted(item.delivered, "engagement", "engagements")}</Fact>
					)}
					{item.members ? <Fact label="Team size">{counted(item.members, "person", "people")}</Fact> : null}
				</dl>
			);
		case "services": {
			const price = serviceStartingPrice(item);
			return (
				<>
					<dl class="ex-detail__meta">
						<Fact label="Type">{item.serviceType}</Fact>
						<Fact label="Price">
							<span class="ex-detail__price">
								{price.isFloor && (
									<>
										<span class="ex-detail__from">From</span>{" "}
									</>
								)}
								{price.amount ? <Price amount={price.amount} /> : price.fallback}
							</span>
							{price.unit && <span class="ex-detail__unit">/ {price.unit}</span>}
						</Fact>
						{item.delivery && <Fact label="Delivery">{item.delivery}</Fact>}
						{item.category && (
							<Fact label="Category">{facetValueLabel("services", "cat", item.category)}</Fact>
						)}
					</dl>
					{price.isFloor && (
						<p class="ex-detail__note">
							The Low-intensity rate. Each ticket's intensity sets its price, up to twice the
							standard rate.
						</p>
					)}
				</>
			);
		}
		case "projects": {
			const budget = projectBudgetAmount(item);
			return (
				<>
					<dl class="ex-detail__meta">
						<Fact label="Client">{item.org}</Fact>
						{item.stage && <Fact label="Stage">{item.stage}</Fact>}
						{(budget || item.budget) && (
							<Fact label="Escrow budget">{budget ? <Price amount={budget} /> : item.budget}</Fact>
						)}
					</dl>
					{item.phases.length > 0 && (
						<div class="ex-detail__section">
							<h3 class="ex-detail__label">Phase plan</h3>
							<ol class="ex-detail__phases">
								{item.phases.map((phase, i) => (
									<li class="ex-detail__phase" key={`${i}:${phase}`}>
										<span class="ex-detail__phase-idx" aria-hidden="true">{i + 1}</span>
										<span>{phase}</span>
									</li>
								))}
							</ol>
						</div>
					)}
					{item.roles.length > 0 && (
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
					)}
				</>
			);
		}
		case "products":
			return (
				<dl class="ex-detail__meta">
					<Fact label="Price">
						{typeof item.priceMinor === "number"
							? <Price amount={{ minor: item.priceMinor, currency: item.currency ?? "USD" }} />
							: item.price}
					</Fact>
					{item.category && (
						<Fact label="Category">{facetValueLabel("products", "cat", item.category)}</Fact>
					)}
				</dl>
			);
		case "articles":
			return (
				<dl class="ex-detail__meta">
					<Fact label="Topic">{facetValueLabel("articles", "topic", item.topic)}</Fact>
					<Fact label="Read time">{`${item.readMinutes} min`}</Fact>
				</dl>
			);
	}
}

/** A money fact — the viewer's currency first, its origin disclosed beside it when converted. */
function Price({ amount }: { amount: PriceAmount }): JSX.Element {
	return <MoneyView minor={amount.minor} currency={amount.currency} />;
}

function Fact({ label, children }: { label: string; children: ComponentChildren }): JSX.Element {
	return (
		<div class="ex-detail__fact">
			<dt>{label}</dt>
			<dd>{children}</dd>
		</div>
	);
}
// #endregion

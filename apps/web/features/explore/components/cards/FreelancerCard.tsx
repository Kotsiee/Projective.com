import type { JSX } from "preact";
import { Avatar, RatingStars } from "@projective/ui/display";
import { vars } from "@features/marketing/core/style.ts";
import { CardLink } from "../CardLink.tsx";
import { PromotedBadge } from "../PromotedBadge.tsx";
import { VerifiedBadge } from "../VerifiedBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { cardAccent } from "../../core/accent.ts";
import { freelancerFloor } from "../../core/pricing.ts";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProfileItem } from "../../types/explore-types.ts";

/**
 * FreelancerCard — the talent banner card shared by **freelancers and teams**, so the merged
 * "Freelancers & Teams" section reads as one language (and matches the People & Businesses banner). A
 * wide cover backs a circular avatar that overlaps its bottom edge; below sit the display name, muted
 * `@handle`, a single-line LinkedIn-style headline (`craft`, no bio), the sole Freelancer star rating,
 * the languages spoken, and a minimal counts row (services + products sold, or team size). On hover a
 * strip of top-work thumbnails slides up from the base, and the exposed actions cluster (incl. the
 * signed-in "Add to project" quick-action) fades in.
 */
export function FreelancerCard(
	{ item, ctx = { scope: "explore" }, onSelect, authed = false }: {
		item: ProfileItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
	},
): JSX.Element {
	const isTeam = item.type === "teams";
	const floor = freelancerFloor(item);
	const helper = item.rating?.asHelper;
	const services = item.servicePrices?.length ?? 0;
	const products = item.products ?? 0;

	// A minimal metric row: freelancers surface their catalogue depth; teams surface their size.
	const counts = isTeam ? [item.members ? `${item.members} people` : "Team"] : [
		`${services} ${services === 1 ? "service" : "services"}`,
		products ? `${products} products sold` : null,
	];

	return (
		<article
			class="ex-card ex-card--banner ex-card--talent"
			style={vars({ "--ex-accent": cardAccent(item.id) })}
		>
			<CardLink item={item} ctx={ctx} onSelect={onSelect} label={`${item.title} — ${item.craft}`} />
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} helper />

			<div
				class="ex-banner__cover"
				style={vars({ "--ex-cover": `url("${item.cover}")` })}
				aria-hidden="true"
			>
				{item.sponsored && (
					<span class="ex-flags">
						<PromotedBadge />
					</span>
				)}
			</div>

			<div class="ex-banner__body">
				<div class="ex-banner__id">
					<Avatar
						image={item.owner.avatar}
						alt=""
						size="lg"
						shape="circle"
						class="ex-banner__avatar"
					/>
					<span class="ex-banner__idtext">
						<span class="ex-banner__name">
							<span class="ex-banner__nametext">{item.title}</span>
							{item.owner.verified && <VerifiedBadge size="md" />}
						</span>
						<span class="ex-banner__handle">{item.owner.handle}</span>
					</span>
				</div>

				<p class="ex-talent__headline">{item.craft}</p>

				{
					/* One metadata line, not three stacked rows — rating, languages and counts are the same
				    kind of quiet secondary fact, so they read together and let the face stay primary. */
				}
				<div class="ex-talent__meta">
					{helper && (
						<RatingStars
							value={helper.value}
							count={helper.count}
							size="sm"
							compact
							label={`Rated ${
								helper.value.toFixed(1)
							} out of 5 as a helper, ${helper.count} ratings`}
						/>
					)}
					{item.languages?.length
						? (
							<span class="ex-talent__langs">
								<span class="ex-talent__langs-label">Speaks</span> {item.languages.join(", ")}
							</span>
						)
						: null}
					{counts.filter(Boolean).map((c) => (
						<span class="ex-talent__count" key={c as string}>{c}</span>
					))}
				</div>

				<div class="ex-card__foot">
					<span class="ex-muted">{item.delivered} delivered</span>
					{floor && <span class="ex-price">{floor}</span>}
				</div>

				{item.highlights?.length
					? (
						<div class="ex-talent__highlights" aria-hidden="true">
							{item.highlights.slice(0, 4).map((src) => (
								<span class="ex-talent__thumb" key={src}>
									<img src={src} alt="" loading="lazy" decoding="async" />
								</span>
							))}
						</div>
					)
					: null}
			</div>
		</article>
	);
}

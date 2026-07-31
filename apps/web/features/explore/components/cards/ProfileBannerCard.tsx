import type { JSX } from "preact";
import { Avatar, Tag } from "@projective/ui/display";
import { vars } from "@features/marketing/core/style.ts";
import { cardAccent } from "../../core/accent.ts";
import { CardLink } from "../CardLink.tsx";
import { PromotedBadge } from "../PromotedBadge.tsx";
import { RatingTracks } from "../RatingTracks.tsx";
import { VerifiedBadge } from "../VerifiedBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProfileItem } from "../../types/explore-types.ts";

/**
 * ProfileBannerCard — the WIDE horizontal banner card for users, teams, and businesses (the profile
 * entities that carry a cover, unlike freelancers). A full-bleed cover backs the identity block
 * (logo/avatar + name + handle) — which serves as the prominent owner attribution — over the
 * reputation tracks and discipline pills. The whole card routes to the profile via the stretched link.
 */
function kindTag(item: ProfileItem): { label: string; severity: "primary" | "secondary" } {
	if (item.type === "teams") {
		return { label: item.members ? `Team · ${item.members}` : "Team", severity: "primary" };
	}
	if (item.type === "businesses") return { label: "Business", severity: "secondary" };
	return { label: "Individual", severity: "secondary" };
}

export function ProfileBannerCard(
	{ item, ctx = { scope: "explore" }, onSelect, authed = false }: {
		item: ProfileItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
	},
): JSX.Element {
	const tag = kindTag(item);
	return (
		<article class="ex-card ex-card--banner" style={vars({ "--ex-accent": cardAccent(item.id) })}>
			<CardLink item={item} ctx={ctx} onSelect={onSelect} label={`${item.title} — ${item.craft}`} />
			<CardActions
				title={item.title}
				href={itemHref(item, ctx)}
				authed={authed}
				helper={item.type === "teams"}
			/>
			<div
				class="ex-banner__cover"
				style={vars({ "--ex-cover": `url("${item.cover}")` })}
				aria-hidden="true"
			>
				<span class="ex-flags ex-flags--row">
					{item.sponsored && <PromotedBadge />}
					<Tag value={tag.label} severity={tag.severity} variant="subtle" rounded />
				</span>
			</div>
			<div class="ex-banner__body">
				<div class="ex-banner__id">
					<Avatar
						image={item.owner.avatar}
						alt=""
						size="lg"
						shape={item.type === "businesses" ? "square" : "circle"}
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
				<p class="ex-banner__craft">{item.craft}</p>
				<RatingTracks rating={item.rating} />
				{
					/* Languages share the talent card's single metadata line, so both banner variants set
				    secondary facts at one weight instead of each inventing a band. */
				}
				{item.languages?.length
					? (
						<div class="ex-talent__meta">
							<span class="ex-talent__langs">
								<span class="ex-talent__langs-label">Speaks</span> {item.languages.join(", ")}
							</span>
						</div>
					)
					: null}
				<div class="ex-card__foot">
					{item.delivered > 0 && <span class="ex-muted">{item.delivered} delivered</span>}
					{item.members ? <span class="ex-muted">{item.members} people</span> : null}
				</div>
			</div>
		</article>
	);
}

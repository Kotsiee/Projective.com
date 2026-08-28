import type { JSX } from "preact";
import { Avatar, RatingStars } from "@projective/ui/display";
import { vars } from "@features/marketing/core/style.ts";
import { CardLink } from "../CardLink.tsx";
import { PromotedBadge } from "../PromotedBadge.tsx";
import { StatusChip } from "../StatusChip.tsx";
import { VerifiedBadge } from "../VerifiedBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { cardAccent } from "../../core/accent.ts";
import { languageSummary, profileMetrics, profileSignals } from "../../core/card-signals.ts";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProfileItem } from "../../types/explore-types.ts";

/**
 * ProfileCard — the single card for every profile-shaped entity: individuals, freelancers, teams and
 * businesses.
 *
 * This replaces the former `FreelancerCard` / `ProfileBannerCard` pair. The two rendered the same
 * object with two anatomies (one avatar left-aligned over a cover, one a wide horizontal banner with
 * reputation tracks), so the same seller looked like two different kinds of result depending on which
 * section of `/explore` surfaced them. A card's job is to make results comparable; two layouts for one
 * entity class is the opposite. What genuinely varies by kind — the avatar's shape, and whether the
 * footer counts a catalogue or a headcount — varies inside ONE composition.
 *
 * Anatomy, top to bottom: a cover banner that fades out into the card at its lower edge; a large
 * circular avatar centred on that seam and overlapping it by about half; the centred display name and
 * `@handle`; then a LEFT-aligned two-line headline, a quiet location + languages line, and a foot
 * splitting the star rating from the stacked key metrics.
 *
 * The centre-then-left break is deliberate: identity is a single focal object and centres under the
 * avatar, while the headline and metadata are running text that a reader scans down a shared left
 * edge. Centring those too would give the card no anchor line at all.
 *
 * The hover HIGHLIGHTS strip — four thumbnails of recent work, revealed on hover for freelancers and
 * teams — has been removed. It was `aria-hidden` decoration, so it said nothing to assistive tech; it
 * changed the card's height mid-hover inside a row of equalised cards; and it spent four image
 * requests per card on pictures with no caption, no link, and no way for the reader to tell what they
 * were looking at. The card's job is to make one profile comparable with the next, and the strip was
 * the only part of it that appeared on some cards and not others.
 */
export function ProfileCard(
	{ item, ctx = { scope: "explore" }, onSelect, authed = false }: {
		item: ProfileItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
	},
): JSX.Element {
	const helper = item.rating?.asHelper ?? item.rating?.asClient;
	const signals = profileSignals(item);
	const metrics = profileMetrics(item);
	const languages = languageSummary(item.languages);
	// One line, two facts, one separator — and the separator only appears when both sides exist, so a
	// profile missing a location never renders a leading bullet.
	const meta = [item.location, languages].filter(Boolean).join(" • ");

	return (
		<article
			class="ex-card ex-card--profile"
			data-item-id={item.id}
			data-item-type={item.type}
			data-ambient-src={item.cover}
			style={vars({ "--ex-accent": cardAccent(item.id) })}
		>
			<CardLink item={item} ctx={ctx} onSelect={onSelect} label={`${item.title} — ${item.craft}`} />
			<CardActions
				title={item.title}
				href={itemHref(item, ctx)}
				authed={authed}
				helper={item.type === "freelancers" || item.type === "teams"}
			/>

			<div class="ex-pcard__banner">
				<img
					class="ex-pcard__cover"
					src={item.cover}
					alt=""
					loading="lazy"
					decoding="async"
				/>
				{signals.length > 0 && (
					<span class="ex-signals">
						{signals.map((s) => <StatusChip signal={s} key={s.id} />)}
					</span>
				)}
				{item.sponsored && <PromotedBadge />}
			</div>

			<div class="ex-pcard__body">
				<div class="ex-pcard__identity">
					<Avatar
						image={item.owner.avatar}
						alt=""
						size="xl"
						shape={item.type === "businesses" ? "square" : "circle"}
						class="ex-pcard__avatar"
					/>
					<span class="ex-pcard__name">
						<span class="ex-pcard__nametext">{item.title}</span>
						{item.owner.verified && <VerifiedBadge size="md" />}
					</span>
					<span class="ex-pcard__handle">{item.owner.handle}</span>
				</div>

				<p class="ex-pcard__headline">{item.craft}</p>

				{meta && <p class="ex-pcard__meta">{meta}</p>}

				<div class="ex-pcard__foot">
					{helper
						? (
							<RatingStars
								value={helper.value}
								count={helper.count}
								size="sm"
								compact
								label={`Rated ${helper.value.toFixed(1)} out of 5 from ${helper.count} reviews`}
							/>
						)
						: <span class="ex-muted">{item.delivered} delivered</span>}

					{metrics.length > 0 && (
						<ul class="ex-pcard__metrics" role="list">
							{metrics.map((m) => (
								<li class="ex-pcard__metric" key={m.label}>
									<span class="ex-pcard__metric-value">{m.value}</span>{" "}
									<span class="ex-pcard__metric-label">{m.label}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</article>
	);
}

import type { JSX } from "preact";
import { Avatar, RatingStars } from "@projective/ui/display";
import { VerifiedBadge } from "@features/explore/components/VerifiedBadge.tsx";
import { profileHref } from "@features/explore/core/routing.ts";
import type { EntityView } from "@projective/types/explore";
import { badgeTagsFor, ENTITY_LABEL } from "../core/view-model.ts";

/**
 * ViewDetails — the hero's right details column (Part 1.2). The entity overview: eyebrow + title, the
 * badge tag row (category · engagement/delivery mode · Promoted), the creator profile header card
 * (avatar/logo · name · `@handle` · verified crest, linking to `/[handle]`), a rating & reviews
 * summary that jumps to the reviews section, and the rich description + key specifications. The
 * transactional actions live in the sidebar action lane (Part 2), so this column is purely
 * informational.
 */
export function ViewDetails({ view }: { view: EntityView }): JSX.Element {
	const { item, reviews, deliverables } = view;
	const owner = item.owner;
	const href = profileHref(owner.handle);
	const badges = badgeTagsFor(item);
	const summary = reviews.summary;

	return (
		<div class="vw-details">
			<span class="vw-details__eyebrow">{ENTITY_LABEL[item.type]}</span>
			<h1 class="vw-details__title">{item.title}</h1>

			{badges.length > 0
				? (
					<div class="vw-badges">
						{badges.map((b) => (
							<span key={b.label} class="vw-badge" data-tone={b.tone}>{b.label}</span>
						))}
					</div>
				)
				: null}

			{/* Creator profile header card. */}
			<a class="vw-creator" href={href} aria-label={`${owner.name} — view profile`}>
				<Avatar
					image={owner.avatar}
					alt=""
					size="lg"
					shape={owner.kind === "business" ? "square" : "circle"}
					class="vw-creator__avatar"
				/>
				<span class="vw-creator__id">
					<span class="vw-creator__name">
						<span class="vw-creator__nametext">{owner.name}</span>
						{owner.verified ? <VerifiedBadge size="md" /> : null}
					</span>
					<span class="vw-creator__handle">{owner.handle}</span>
				</span>
			</a>

			{/* Rating & reviews summary — jumps to the full section below. */}
			{summary.count > 0
				? (
					<a class="vw-ratesum" href="#view-reviews">
						<span class="vw-ratesum__score">{summary.average.toFixed(1)}</span>
						<RatingStars value={summary.average} size="sm" />
						<span class="vw-ratesum__count">
							{summary.count.toLocaleString("en-US")} review{summary.count === 1 ? "" : "s"}
						</span>
					</a>
				)
				: null}

			{/* Description. */}
			<div class="vw-section">
				<h2 class="vw-section__label">About this {ENTITY_LABEL[item.type].toLowerCase()}</h2>
				<p class="vw-details__summary">{item.summary}</p>
			</div>

			{/* Key specifications / deliverables. */}
			{deliverables.length > 0
				? (
					<div class="vw-section">
						<h2 class="vw-section__label">What’s included</h2>
						<ul class="vw-specs">
							{deliverables.map((d) => (
								<li key={d} class="vw-specs__item">
									<CheckMark />
									<span>{d}</span>
								</li>
							))}
						</ul>
					</div>
				)
				: null}
		</div>
	);
}

function CheckMark(): JSX.Element {
	return (
		<svg
			class="vw-specs__check"
			viewBox="0 0 24 24"
			width={16}
			height={16}
			fill="none"
			stroke="currentColor"
			stroke-width={2.2}
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M20 6L9 17l-5-5" />
		</svg>
	);
}

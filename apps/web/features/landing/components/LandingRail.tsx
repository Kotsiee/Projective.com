import type { JSX } from "preact";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";
import {
	type Rail,
	railByline,
	type RailItem,
	railLabel,
	railMonogram,
	railStepLabel,
	railTrackId,
} from "@features/landing/core/rails.ts";

// #region Card
/** Props for {@link RailCard}. */
export interface RailCardProps {
	item: RailItem;
}

/** The byline: the owner's avatar beside "by {ownerName}", inline meta text. */
function Byline({ item }: RailCardProps): JSX.Element {
	return (
		<span class="lp-rail-card__by">
			<img
				class="lp-rail-card__avatar"
				src={item.avatar}
				alt=""
				width={20}
				height={20}
				loading="lazy"
				decoding="async"
			/>
			<span class="lp-meta lp-rail-card__meta">{railByline(item.ownerName)}</span>
		</span>
	);
}

/**
 * A brief's card: text-forward, as Explore's project card is — who posted it, the title, its own
 * description, its stages as inline meta text and its budget at the foot. The title comes first in
 * the source, so the link's name opens with it; the stylesheet draws the byline above it.
 */
function BriefCard({ item }: RailCardProps): JSX.Element {
	return (
		<a class="lp-rail-card lp-rail-card--brief" href={item.href} data-kind={item.kind}>
			<span class="lp-rail-card__title">{item.title}</span>
			<Byline item={item} />
			{item.summary ? <span class="lp-rail-card__summary">{item.summary}</span> : null}
			{item.detail ? <span class="lp-meta lp-rail-card__stages">{item.detail}</span> : null}
			{item.price ? <span class="lp-rail-card__price">{item.price}</span> : null}
		</a>
	);
}

/**
 * The picture frame: the payload's picture; else the owner's own avatar on the surface tone; else —
 * when the avatar would be the default picture, which says nothing about whose card this is — the
 * name's initials ({@link railMonogram}). The initials are always in the frame, under any picture:
 * `data-picture` hides them while it shows, and the RailScroll island marks a picture that fails to
 * load (`data-failed`), which hides it and lets them through, so a broken picture never shows.
 */
function Cover({ item }: RailCardProps): JSX.Element {
	const avatar = item.cover === null && item.avatar !== DEFAULT_AVATAR_URL;
	const name = item.kind === "profile" ? item.title : item.ownerName;
	return (
		<span class="lp-rail-card__cover" data-picture={item.cover || avatar ? "" : undefined}>
			{item.cover
				? (
					<img
						class="lp-rail-card__img"
						src={item.cover}
						alt=""
						width={640}
						height={360}
						loading="lazy"
						decoding="async"
					/>
				)
				: null}
			{avatar
				? (
					<img
						class="lp-rail-card__mono"
						src={item.avatar}
						alt=""
						width={56}
						height={56}
						loading="lazy"
						decoding="async"
					/>
				)
				: null}
			<span class="lp-rail-card__initials" aria-hidden="true">{railMonogram(name)}</span>
		</span>
	);
}

/**
 * RailCard — one listing on a live rail (`flows/LANDING.md` §4.5). The whole card is ONE link, so
 * it is the only contained object in the section, and nothing inside it is a container: a 16 / 9
 * picture frame ({@link Cover}: the payload's picture, lazy and sized, or who it belongs to), then
 * the title and inline meta text. A service prints "by {owner}" beside the owner's avatar; a profile
 * its name and headline, with its avatar beside them when the frame holds its cover; a brief has no
 * picture and reads as text ({@link BriefCard}). The price line shows only when the payload carries
 * a real figure. Every picture is decorative (`alt=""`): the link's words name it.
 */
export function RailCard({ item }: RailCardProps): JSX.Element {
	if (item.kind === "brief") return <BriefCard item={item} />;
	return (
		<a class="lp-rail-card" href={item.href} data-kind={item.kind}>
			<Cover item={item} />
			{item.kind === "profile"
				? (
					<span class="lp-rail-card__who">
						{item.cover
							? (
								<img
									class="lp-rail-card__avatar"
									src={item.avatar}
									alt=""
									width={40}
									height={40}
									loading="lazy"
									decoding="async"
								/>
							)
							: null}
						<span class="lp-rail-card__text">
							<span class="lp-rail-card__title">{item.title}</span>
							{item.detail ? <span class="lp-meta lp-rail-card__meta">{item.detail}</span> : null}
						</span>
					</span>
				)
				: (
					<span class="lp-rail-card__text">
						<span class="lp-rail-card__title">{item.title}</span>
						<Byline item={item} />
					</span>
				)}
			{item.price ? <span class="lp-rail-card__price">{item.price}</span> : null}
		</a>
	);
}
// #endregion

// #region Rail
/** Props for {@link LandingRail}. */
export interface LandingRailProps {
	rail: Rail;
}

/**
 * LandingRail — one live marketplace rail (`flows/LANDING.md` §4.5, §2.1 note 15, §2.3 note 14,
 * §2.4): the rail's title, its scroll buttons and "See all" (`explorePath`), then a native horizontal
 * scroller of {@link RailCard}s — scroll-snap, fade edges, no autoplay — named "{title}, {n} items"
 * as a carousel region. The scroll buttons ("Scroll {title} back" / "forward") are rendered here and
 * wired by the RailScroll island; the stylesheet shows them only for a fine pointer, once wired and
 * while the rail overflows, so a button never shows before it works. Touch scrolls the rail itself,
 * and the keyboard reaches every card in order (the browser scrolls each focused card into view).
 */
export function LandingRail({ rail }: LandingRailProps): JSX.Element {
	const trackId = railTrackId(rail.id);
	return (
		<div class="lp-rail" data-rail={rail.id}>
			<div class="lp-rail__head">
				<h3 class="lp-heading lp-rail__title">{rail.title}</h3>
				<div class="lp-rail__tools">
					<div class="lp-rail__steps">
						<button
							type="button"
							class="lp-rail__step lp-rail__step--back"
							data-rail-step="-1"
							aria-controls={trackId}
							aria-label={railStepLabel(rail.title, "back")}
							aria-disabled="true"
						/>
						<button
							type="button"
							class="lp-rail__step lp-rail__step--forward"
							data-rail-step="1"
							aria-controls={trackId}
							aria-label={railStepLabel(rail.title, "forward")}
						/>
					</div>
					<a class="lp-ways__link lp-rail__all" href={rail.seeAllHref}>{rail.seeAllLabel}</a>
				</div>
			</div>
			<div
				id={trackId}
				class="lp-rail__track"
				role="region"
				aria-roledescription="carousel"
				aria-label={railLabel(rail)}
			>
				<ul class="lp-rail__list">
					{rail.items.map((item) => (
						<li key={item.id} class="lp-rail__item">
							<RailCard item={item} />
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
// #endregion

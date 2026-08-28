import type { JSX } from "preact";
import { Avatar, RatingStars } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
// `profile.css` is load-bearing here, not cosmetic reuse: the GUEST shell keys its sub-header glass
// underlay, hairline and elevation off the literal selector
// `.guest-shell__subheader:has(.pf-stickyhead[data-condensed="true"])`, and `profile.css` supplies the
// reveal transition plus the `visibility`-based tab-order gating. A band that drops `.pf-stickyhead`
// renders unstyled for guests while looking correct when signed in — the worst kind of regression.
import "@features/profile/styles/profile.css";
import "../styles/entity-view.css";
import { ARCHETYPE_LABEL, type EntityArchetype } from "../core/entity-archetype.ts";
import { viewHeaderCondensed } from "../core/view-state.ts";
import { scrollToId } from "../core/scroll-to.ts";
import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * EntityStickyHeader — the condensed listing identity that MIGRATES into the middle-nav frame's header
 * band as the body hero scrolls away (`DESIGN_SYSTEM.md` §D.7.6).
 *
 * It reads the shared {@link viewHeaderCondensed} signal, which the body {@link EntityHeroProbe} flips
 * from an IntersectionObserver on `.evp-hero`. Reveal is driven by `min-block-size`/`max-block-size`,
 * **never `block-size`** — the band sits in the frame's grid context, which overrides an explicit
 * height, so only the min/max logical constraints are honoured (verified and recorded in `profile.css`).
 *
 * **It carries no control that commits, and now no control that opens a panel either.** The band is
 * identity plus one navigation jump: what you are looking at, who is selling it, and how they rate.
 * `.guest-shell__subheader` is `display: none` at ≤767px while `.ui-middle-nav__header` still renders
 * there, so anything placed here exists for a signed-in phone user and not for a guest one — which is
 * why the purchase control has always been withheld (§D.7.4), and why the Contact trigger has now gone
 * the same way. Contacting the seller lives in the conversion lane and in `EntityBuyBar`, each anchored
 * to the region that owns the offer; a third trigger in a strip half the readers cannot see is a third
 * place for that flow to drift.
 *
 * Its ONE interactive element besides the seller link is the rating, and it is a real anchor to
 * `#evp-reviews` whose handler only UPGRADES the jump — it cancels the hash navigation and scrolls to a
 * position that clears the pinned chrome, which a bare `#hash` cannot do. Same control, same target and
 * the same `scrollToId` the lane's `.evp-lane__rating` uses, so the two cannot land in different places.
 */
export interface EntityStickyHeaderProps {
	item: ExploreItem;
	archetype: EntityArchetype;
	authed: boolean;
	ctx: HrefContext;
}

export default function EntityStickyHeader(
	{ item, archetype }: EntityStickyHeaderProps,
): JSX.Element {
	const condensed = viewHeaderCondensed.value;
	const owner = item.owner;
	const handle = owner.handle.replace(/^@/, "");
	const rating = item.rating?.asHelper ?? item.rating?.asClient ?? null;

	return (
		<div
			class="pf-stickyhead evp-stickyhead"
			data-condensed={condensed ? "true" : "false"}
			aria-hidden={condensed ? undefined : "true"}
		>
			<div class="evp-stickyhead__lead">
				{
					/*
				  Native truncation at 24ch. `text-overflow` needs all three of `overflow: hidden`,
				  `white-space: nowrap` and a bounded box to do anything at all — they live together in
				  `.evp-stickyhead__title`. `title` carries the untruncated string so the full name is
				  still reachable.
				*/
				}
				<span class="evp-stickyhead__title" title={item.title}>{item.title}</span>
				<span class="evp-stickyhead__kind">{ARCHETYPE_LABEL[archetype]}</span>
			</div>

			{
				/*
			  The seller block sits at the band's INLINE END. `.evp-stickyhead__lead` grows to fill the row,
			  so this is pushed to the far edge by the flex distribution rather than by a margin — which
			  keeps it correct under `dir="rtl"` for free, because "end" is a logical edge where a physical
			  `margin-left` would not be.

			  The rating is no longer INSIDE the seller anchor. It was, which made it a nested interactive
			  region inside a link: the stars could not be their own target, and a reader who aimed at them
			  — the universal gesture for "show me the reviews" — landed on the seller's profile instead.
			*/
			}
			<div class="evp-stickyhead__end">
				<a class="evp-stickyhead__seller" href={`/${owner.handle}`}>
					<Avatar
						image={owner.avatar}
						label={owner.name}
						size={24}
						shape={owner.kind === "business" ? "square" : "circle"}
					/>
					<span class="evp-stickyhead__handle">@{handle}</span>
					{owner.verified && (
						<Icon name="verified" size="xs" filled class="evp-stickyhead__crest" aria-hidden />
					)}
				</a>

				{rating && (
					<a
						class="evp-stickyhead__rating"
						href="#evp-reviews"
						onClick={(e) => {
							if (scrollToId("evp-reviews")) e.preventDefault();
						}}
					>
						<RatingStars
							value={rating.value}
							count={rating.count}
							compact
							size="sm"
							label={`Rated ${
								rating.value.toFixed(1)
							} out of 5 from ${rating.count} reviews — jump to the reviews`}
						/>
					</a>
				)}
			</div>
		</div>
	);
}

import type { JSX } from "preact";
import { Avatar, RatingStars, VerificationStampBadge } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { ownerVerificationStamp } from "@projective/types/org";
// `profile-skeleton.css` is load-bearing here, not cosmetic reuse: the GUEST shell keys its sub-header glass
// underlay, hairline and elevation off the literal selector
// `.guest-shell__subheader:has(.pf-stickyhead[data-condensed="true"])`, and `profile-skeleton.css` supplies the
// reveal transition plus the `visibility`-based tab-order gating. A band that drops `.pf-stickyhead`
// renders unstyled for guests while looking correct when signed in — the worst kind of regression.
import "@features/profile/styles/profile-skeleton.css";
// The migrating back control's withdrawal/entrance rules ride THIS island: the page copy is a server
// component and cannot carry a stylesheet (Decision #39), and the band is always mounted beside it.
import "@features/shell/styles/migrating-back.css";
import "../styles/entity-view.css";
import { ARCHETYPE_LABEL, type EntityArchetype } from "../core/entity-archetype.ts";
import { headerCondensed } from "@features/shell/core/migrating-header.ts";
import { scrollToId } from "../core/scroll-to.ts";
import { BackLink } from "../components/BackLink.tsx";
import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import { personFallbackImage } from "@web/components/UserAvatar.tsx";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { ctaMirror, type MirroredCta, pastFrame } from "../core/cta-mirror.ts";
import { currentOffer } from "../core/booking-state.ts";
import ContactPopover from "./ContactPopover.island.tsx";

/**
 * EntityStickyHeader — the condensed listing identity that MIGRATES into the middle-nav frame's header
 * band as the body hero scrolls away (`DESIGN_SYSTEM.md` §D.7.6).
 *
 * It reads the shell's shared {@link headerCondensed} signal, which the body `EntityHeroProbe` flips
 * through the shared `useMigratingHeader` probe (the same hook the profile hero runs on its rig).
 * Reveal is driven by `min-block-size`/`max-block-size`,
 * **never `block-size`** — the band sits in the frame's grid context, which overrides an explicit
 * height, so only the min/max logical constraints are honoured (verified and recorded in `profile-skeleton.css`).
 *
 * **At rest it carries no control that commits or opens a panel.** The band is identity plus one
 * navigation jump: what you are looking at, who is selling it, and how they rate. Only once the reader
 * has scrolled past the frame, so the conversion lane is off screen, does it add the rig's own controls
 * (Decision #521, {@link HeaderActions}): the ghost Contact me, then the primary at the inline end. The
 * transaction is therefore never on screen twice, and the Contact control it shows is the lane's own
 * `ContactPopover`, so both open one panel.
 *
 * The band LEADS with the page's one back control — the same {@link BackLink} the frame renders at
 * rest, in its compact band presentation (the shell's `MigratingBack`) — so the way out migrates
 * into the header exactly as the identity does: the page copy withdraws as this one reveals
 * (`:root[data-header-condensed]`, written by the probe), only one is ever in the tab order, and
 * focus follows the hand-over. It is a real anchor, so route-back works with JavaScript off and on a
 * middle-click, and after hydration it points at the exact page of the tree the visitor came from,
 * filters intact.
 *
 * Its other interactive element besides the seller link is the rating, and it is a real anchor to
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
	{ item, archetype, ctx }: EntityStickyHeaderProps,
): JSX.Element {
	const condensed = headerCondensed.value;
	const owner = item.owner;
	const handle = owner.handle.replace(/^@/, "");
	const rating = item.rating?.asHelper ?? item.rating?.asClient ?? null;
	const mirror = ctaMirror.value;
	const actions = condensed && pastFrame.value ? mirror?.primary ?? null : null;

	return (
		<div
			class="pf-stickyhead evp-stickyhead"
			data-condensed={condensed ? "true" : "false"}
			data-actions={actions ? "true" : undefined}
			aria-hidden={condensed ? undefined : "true"}
		>
			<BackLink ctx={ctx} placement="band" />

			<div class="evp-stickyhead__lead">
				{
					/*
				  Native truncation at 24ch. `text-overflow` needs all three of `overflow: hidden`,
				  `white-space: nowrap` and a bounded box to do anything at all — they live together in
				  `.evp-stickyhead__title`. A full-text Tooltip carries the untruncated string so the full
				  name is still reachable.
				*/
				}
				<Tooltip content={item.title} whenTruncated>
					<span class="evp-stickyhead__title">{item.title}</span>
				</Tooltip>
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
						fallbackImage={personFallbackImage(owner.kind)}
						label={owner.name}
						size={24}
						shape={owner.kind === "business" ? "square" : "circle"}
					/>
					<span class="evp-stickyhead__handle">@{handle}</span>
					<VerificationStampBadge
						stamp={ownerVerificationStamp(owner)}
						size="xs"
						mode="decorative"
						class="evp-stickyhead__crest"
					/>
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

				{actions && <HeaderActions primary={actions} contact={mirror?.contact ?? null} />}
			</div>
		</div>
	);
}

/**
 * The band's transaction controls, offered only once the reader has scrolled past the frame and the
 * lane has left the screen (Decision #521, owner ruling), in reading order: the contact control as a
 * small GHOST button with its glyph and label — on a service the lane's own `ContactPopover`, so it
 * opens the same Contact me panel, and on a brief the rig's Message client link — then the rig's
 * primary as a small filled pill at the band's inline end (Decision #524). Each runs the rig's own
 * handler.
 */
function HeaderActions(
	{ primary, contact }: { primary: MirroredCta; contact: MirroredCta | null },
): JSX.Element {
	const offer = currentOffer.value;
	const severity = primary.tone === "primary" ? "primary" : "accent";
	return (
		<div class="evp-stickyhead__actions" role="group" aria-label="Actions">
			{offer
				? <ContactPopover offer={offer} variant="band" />
				: contact?.href
				? (
					<Tooltip content={contact.label} placement="bottom" whenTruncated>
						<a
							class="ui-button ui-button--secondary ui-button--text ui-button--size-sm ui-button--rounded evp-stickyhead__contact"
							href={contact.href}
						>
							<span class="ui-button__icon">
								<Icon name={contact.icon} size="sm" aria-hidden />
							</span>
							<span class="ui-button__label">{contact.label}</span>
						</a>
					</Tooltip>
				)
				: null}
			{primary.href
				? (
					<a
						class={`ui-button ui-button--${severity} ui-button--filled ui-button--size-sm ui-button--rounded evp-stickyhead__cta`}
						href={primary.href}
					>
						<span class="ui-button__icon">
							<Icon name={primary.icon} size="sm" aria-hidden />
						</span>
						<span class="ui-button__label">{primary.label}</span>
					</a>
				)
				: severity === "accent"
				? (
					<Button
						severity="accent"
						variant="filled"
						size="sm"
						rounded
						class="evp-stickyhead__cta"
						icon={<Icon name={primary.icon} size="sm" aria-hidden />}
						label={primary.label}
						disabled={primary.disabled}
						onClick={() => primary.run?.()}
					/>
				)
				: (
					<Button
						severity="primary"
						variant="filled"
						size="sm"
						rounded
						class="evp-stickyhead__cta"
						icon={<Icon name={primary.icon} size="sm" aria-hidden />}
						label={primary.label}
						disabled={primary.disabled}
						onClick={() => primary.run?.()}
					/>
				)}
		</div>
	);
}

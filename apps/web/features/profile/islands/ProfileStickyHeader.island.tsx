import type { JSX } from "preact";
import { Avatar, RatingStars } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import type { PublicCallOffer } from "@projective/types/scheduling";
// `profile-skeleton.css` is load-bearing, not cosmetic reuse: the GUEST shell keys its sub-header
// glass underlay, hairline and elevation off the literal selector
// `.guest-shell__subheader:has(.pf-stickyhead[data-condensed="true"])`, and the skeleton supplies the
// band's reveal transition plus the `visibility`-based tab-order gating (the same contract the
// entity view's band rides). `profile-rig.css` is the rig's own sheet; it reads no `--pf-*` token,
// because this island mounts in the SHELL's header slot, outside `.pf`.
import "../styles/profile-skeleton.css";
// The migrating back control's withdrawal/entrance rules ride THIS island — the band is where the
// hand-over is drawn, and it is always mounted beside the hero's copy.
import "@features/shell/styles/migrating-back.css";
import "../styles/profile-rig.css";
import "../styles/profile-band.css";
import { MigratingBack } from "@features/shell/components/MigratingBack.tsx";
import { EXPLORE_FALLBACK } from "@features/explore/core/explore-history.ts";
import { ProfileRig } from "../components/ProfileRig.tsx";
import { ENTITY_META } from "../components/profile-glyphs.tsx";
import { availabilityAt, localTimeLabel, wallClockAt } from "../core/hours.ts";
import { type HireProject, reviewsHref } from "../core/profile-model.ts";
import { headerCondensed } from "@features/shell/core/migrating-header.ts";
import { useMinuteClock } from "../hooks/useMinuteClock.ts";
import type { ProfileView, ServiceItem } from "../types/profile-types.ts";
import { settingsOf } from "@projective/types/profile";

/**
 * ProfileStickyHeader — the condensed profile identity that MIGRATES into the shell's header slot
 * as the hero's action rig scrolls away: the authenticated frame's `ui-middle-nav__header` band, or
 * the guest shell's floating `guest-shell__subheader` — the same two homes the entity view's
 * `EntityStickyHeader` has (§D.7.6), so a listing and the seller behind it condense into one shape
 * of strip.
 *
 * It reads the shell's shared {@link headerCondensed} signal, which the hero flips from the shared
 * scroll probe on its rig (`@features/shell/hooks/useMigratingHeader.ts` — the same hook the entity
 * view runs on its hero). Reveal is driven by `min-block-size` ⁄
 * `max-block-size`, never `block-size` — the band sits in the frame's grid context, which
 * overrides an explicit height (recorded in `profile-skeleton.css`).
 *
 * # What it carries, and why the rig is here at all
 *
 * The contextual Back control · the avatar · the name and its trust crest · `@handle` and the
 * entity kind · the live **Available now ⁄ Away** badge and the seller's local time (published
 * hours only, on the SAME minute clock the context bar's block ticks on) · the rating, as one jump
 * to the reviews · and the {@link ProfileRig} — the hero's own controls, in their compact size.
 *
 * The entity view's band deliberately withholds its purchase control (§D.7.4): there the offer has
 * a home below the frame breakpoint, and a second one in a strip half the readers cannot see would
 * be a place for it to drift. A profile has no such second home — the rig IS the hero's, and once
 * it has scrolled away nothing else on the page can open the conversation or the hire flow. So the
 * band takes the rig over, and the probe's threshold is what keeps §B.8.2 whole: the band reveals
 * exactly as the rig leaves, so the two copies of the filled Hire are mutually exclusive by render
 * condition. Every control in it acts through `core/rig-actions.ts`, on the same signals the hero's
 * modals are mounted on, so a listing picked here opens the modal a listing picked there would.
 *
 * The badge and the clock are NOT a live region — the context bar's block already announces the
 * change of state, and a second `role="status"` would read it twice. The local clock follows the
 * owner's own switch (`settings.showLocalTime`), exactly as the context bar's does.
 */
export interface ProfileStickyHeaderProps {
	profile: ProfileView;
	/** The owner previewing their own profile — the visitor's rig, explained instead of acting. */
	preview: boolean;
	/** Whether the viewer is signed in. */
	authed: boolean;
	/** The seller's active listings — the Hire popover's rows. */
	services: ServiceItem[];
	/** The seller's public call offer, or `null` — the popover's consultation row. */
	consultation: PublicCallOffer | null;
	/** The VIEWER's open projects — the Add-to-project popover's rows. */
	hireProjects: HireProject[];
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

export default function ProfileStickyHeader(props: ProfileStickyHeaderProps): JSX.Element {
	const { profile, preview, authed, services, hireProjects, consultation } = props;
	const condensed = headerCondensed.value;
	const avatar = profile.avatar;
	const showClock = settingsOf(profile).showLocalTime;
	const hours = profile.hours && profile.hours.rules.length > 0 ? profile.hours : null;
	const now = useMinuteClock();
	const rating = profile.rating.asHelper ?? profile.rating.asClient;

	const state = hours ? availabilityAt(hours, now.value) : null;
	const clock = hours ? wallClockAt(hours.timezone, now.value) : null;
	const timeLabel = hours ? localTimeLabel(hours.timezone, now.value) : "";
	const timeAttr = clock ? `${pad(Math.floor(clock.minute / 60))}:${pad(clock.minute % 60)}` : "";

	return (
		<div
			class="pf-stickyhead pf-band"
			data-condensed={condensed ? "true" : "false"}
			aria-hidden={condensed ? undefined : "true"}
		>
			<MigratingBack
				placement="band"
				fallback={EXPLORE_FALLBACK}
				fallbackLabel="Back to Explore"
			/>

			<div class="pf-band__id">
				<Avatar
					image={avatar}
					placeholder={profile.avatarPlaceholder}
					label={profile.name}
					size={28}
					shape="circle"
					class="pf-band__avatar"
				/>
				<span class="pf-band__name" title={profile.name}>{profile.name}</span>
				{profile.verified && (
					<Icon name="verified" size="xs" filled class="pf-band__crest" aria-hidden />
				)}
				<span class="pf-band__meta">
					<span class="pf-band__handle">{profile.handle}</span>
					<span class="pf-band__dot" aria-hidden="true">·</span>
					<span>{ENTITY_META[profile.kind].label}</span>
				</span>
			</div>

			<div class="pf-band__facts">
				{hours && state && (
					<span class="pf-band__avail" data-state={state.available ? "available" : "away"}>
						<span class="pf-band__pip" aria-hidden="true" />
						<span class="pf-band__availtext">{state.available ? "Available now" : "Away"}</span>
						{showClock && (
							<>
								<span class="pf-band__sep" aria-hidden="true">·</span>
								<span class="pf-band__clock">
									<time dateTime={timeAttr}>{timeLabel}</time> local
								</span>
							</>
						)}
					</span>
				)}
				{rating && rating.count > 0 && (
					<a class="pf-band__rating" href={reviewsHref(profile.handle)}>
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

			<ProfileRig
				profile={profile}
				canEdit={false}
				preview={preview}
				authed={authed}
				services={services}
				consultation={consultation}
				hireProjects={hireProjects}
				variant="band"
				class="pf-band__actions"
			/>
		</div>
	);
}

import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { memberNoticeFor } from "../core/profile-model.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileMemberNotice — the line a MEMBER reads above a team or business page that everybody outside
 * it is told does not exist (BP1, Decision #244; Teams P1): it is a draft, archived, or invite-only.
 * The database decides both facts under the viewer's own session (`org.get_profile_view`'s
 * `workspace`) — an outsider never reaches this page at all, so the notice is never a stranger's to
 * read. What it says, and whether a link sits beside it, is `memberNoticeFor`'s decision.
 *
 * One InlineNotice (the required-disclosure container, unboxed), stating the fact. A member holding
 * `manage_settings` gets a tier-4 link to the console's Settings beside it (the neutral outlined
 * pill, Button matrix §B.8.1) only once that kind's Settings can publish the entity and change its
 * visibility (`SETTINGS_PUBLISHES`) — a link must land on a surface that can act (root CLAUDE.md
 * §3.11). Neither kind's can yet: the business's link waits by Decision #244 (d), the team's for the
 * Settings screen Teams C6 builds, so today every line stands alone.
 *
 * A server component: its sheet (`profile-base.css`) rides the profile islands' barrel import, and
 * the InlineNotice and Button sheets ride the hero's `@projective/ui/feedback` and `/fields` imports.
 */
export function ProfileMemberNotice({ profile }: { profile: ProfileView }): JSX.Element | null {
	const notice = memberNoticeFor(profile);
	if (!notice) return null;
	const noun = profile.kind === "business" ? "Business" : "Team";
	return (
		<div class="pf-notice">
			<InlineNotice
				align="start"
				icon={<Icon name="lock" size="sm" />}
				text={notice.text}
				class="pf-notice__line"
			/>
			{notice.settingsHref && (
				<a
					class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm ui-button--rounded pf-notice__action"
					href={notice.settingsHref}
				>
					<span class="ui-button__label">{noun} settings</span>
				</a>
			)}
		</div>
	);
}

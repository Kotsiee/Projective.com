import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { ProfileIcon } from "./profile-glyphs.tsx";
import type { ProfileView } from "../types/profile-types.ts";
import { personFallbackImage } from "@web/components/UserAvatar.tsx";

/**
 * ProfileCalendarHead — the one-line identity strip above the full-page availability calendar
 * (`/[handle]/availability`, reached from the context bar's "Full calendar" link). The page has no
 * profile chrome, and a calendar with no name on it answers nobody's question, so this carries a way
 * back and whose calendar this is, and nothing else.
 *
 * The name is the page's one `<h1>` — the calendar below carries no title of its own — drawn in the
 * strip's meta register (the UA heading margin, size and weight reset in `profile-base.css`).
 */
export function ProfileCalendarHead({ profile }: { profile: ProfileView }): JSX.Element {
	return (
		<header class="pf-calhead">
			<a class="pf-calhead__back" href={`/${profile.handle}`}>
				<ProfileIcon name="back" class="pf-calhead__back-icon" />
				<span>Profile</span>
			</a>
			<Avatar
				image={profile.avatar}
				fallbackImage={personFallbackImage(profile.kind)}
				label={profile.name}
				size={24}
				shape="circle"
			/>
			<h1 class="pf-calhead__name">{profile.name} · availability</h1>
		</header>
	);
}

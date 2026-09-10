import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { ProfileIcon } from "./profile-glyphs.tsx";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileCalendarHead — the one-line identity strip above the full-page availability calendar
 * (`/[handle]/availability`). The profile itself no longer links here (Decision #96 stripped the
 * availability toggle, the clock and the presence pip from the layout), but the route still resolves
 * for anyone holding its address, and a calendar with no name on it answers nobody's question. It
 * carries a way back and whose calendar this is, and nothing else.
 */
export function ProfileCalendarHead({ profile }: { profile: ProfileView }): JSX.Element {
	return (
		<header class="pf-calhead">
			<a class="pf-calhead__back" href={`/${profile.handle}`}>
				<ProfileIcon name="back" class="pf-calhead__back-icon" />
				<span>Profile</span>
			</a>
			<Avatar image={profile.avatar} label={profile.name} size={24} shape="circle" />
			<span class="pf-calhead__name">{profile.name} · availability</span>
		</header>
	);
}

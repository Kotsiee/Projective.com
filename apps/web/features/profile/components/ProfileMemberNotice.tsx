import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { hiddenNoticeText } from "../core/profile-model.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileMemberNotice — the line a MEMBER reads above a business page that everybody outside it is
 * told does not exist (BP1, Decision #244): it is a draft, archived, or invite-only. The database
 * decides both facts under the viewer's own session (`org.get_profile_view`'s `workspace`) — an
 * outsider never reaches this page at all, so the notice is never a stranger's to read.
 *
 * One InlineNotice (the required-disclosure container, unboxed), stating the fact and nothing more.
 * BP1 asks for a tier-4 link to the business's Settings beside it, and the read already carries that
 * door (`workspace.settingsHref`, for a `manage_settings` holder) — but no surface can publish a
 * business or change its visibility yet (the Settings module is a placeholder that points at a
 * profile editor with no business visibility), and a link must land on a surface that can act
 * (root CLAUDE.md §3.11). So the link is withheld until Settings can, and the sentence never
 * promises a step (Decision #244 (d)).
 *
 * A server component: its sheet (`profile-base.css`) rides the profile islands' barrel import, and
 * the InlineNotice sheet rides the hero's `@projective/ui/feedback` import.
 */
export function ProfileMemberNotice({ profile }: { profile: ProfileView }): JSX.Element | null {
	const facts = profile.workspace;
	if (!facts?.hiddenReason) return null;
	return (
		<div class="pf-notice">
			<InlineNotice
				align="start"
				icon={<Icon name="lock" size="sm" />}
				text={hiddenNoticeText(facts.hiddenReason, profile.name)}
				class="pf-notice__line"
			/>
		</div>
	);
}

import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/member-rig.css";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { inviteAvailable, membersZoom, openInvite } from "../core/member-view-state.ts";
import { GridIcon, ListIcon } from "../components/file-glyphs.tsx";
import { UserPlusIcon } from "../components/member-glyphs.tsx";

/**
 * MemberViewControlRig — the Members tab's footer band, mounted in the middle-nav FOOTER slot by
 * {@link membersFooterFor} (and, on `/messages/[id]/members`, by the conversation footer resolver). The
 * shared {@link ViewZoomRig} sits on the LEFT — the cards ⇄ table switch is the zoom's centre marker,
 * exactly as on Files and Submissions — and the roster's one primary action, **Invite**, is pinned
 * far RIGHT (the footer owns actions; the body only views and selects, Decision #60). Invite renders
 * only once the body has published that the viewer may invite ({@link inviteAvailable}); pressing it
 * opens the body's modal through the shared signal. In a narrow footer the label folds into the
 * Tooltip and the button keeps its name. Dumb island: no data access.
 */
export default function MemberViewControlRig(): JSX.Element {
	useEffect(() => membersZoom.restoreZoom(), []);

	return (
		<div class="mem-rig">
			<ViewZoomRig
				store={membersZoom}
				label="Members view zoom"
				class="mem-rig__zoom"
				listIcon={<ListIcon size={16} />}
				gridIcon={<GridIcon size={16} />}
			/>
			<span class="mem-rig__spacer" />
			{inviteAvailable.value
				? (
					<Tooltip content="Invite people to this project" placement="top">
						<Button
							size="sm"
							class="mem-rig__invite"
							icon={<UserPlusIcon />}
							label="Invite"
							aria-label="Invite people"
							onClick={openInvite}
						/>
					</Tooltip>
				)
				: null}
		</div>
	);
}

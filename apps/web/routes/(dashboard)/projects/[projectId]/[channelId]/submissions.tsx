import { define } from "@web/utils/state.ts";
import { ChannelTabBody } from "@web/features/projects/components/ChannelTabBody.tsx";

/**
 * Submissions tab — deliverables sent for review on this stage. Present on pipeline & one-off
 * engagements only (the header omits the tab otherwise); a deep-link on a session engagement still
 * lands here but is a scaffold for now.
 */
export default define.page(function ChannelSubmissionsPage() {
	return (
		<ChannelTabBody
			title="Submissions"
			note="Deliverables submitted on this stage — sent for the client's review with escrow released on acceptance."
			filler={6}
		/>
	);
});

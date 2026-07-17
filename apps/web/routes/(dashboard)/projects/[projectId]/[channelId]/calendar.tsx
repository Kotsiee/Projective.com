import { define } from "@web/utils/state.ts";
import { ChannelTabBody } from "@web/features/projects/components/ChannelTabBody.tsx";

/**
 * Calendar tab — the session schedule. Present on session-based engagements only (the header omits
 * the tab otherwise).
 */
export default define.page(function ChannelCalendarPage() {
	return (
		<ChannelTabBody
			title="Calendar"
			note="Scheduled sessions for this engagement — upcoming and past, with booking and reschedule controls."
			filler={5}
		/>
	);
});

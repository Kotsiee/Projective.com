import { define } from "@web/utils/state.ts";
import { ChannelTabBody } from "@web/features/projects/components/ChannelTabBody.tsx";

/** Members tab — participants with access to this channel (`/projects/[projectId]/[channelId]/members`). */
export default define.page(function ChannelMembersPage() {
	return (
		<ChannelTabBody
			title="Members"
			note="The people with access to this channel — their role in the engagement and presence."
			filler={6}
		/>
	);
});

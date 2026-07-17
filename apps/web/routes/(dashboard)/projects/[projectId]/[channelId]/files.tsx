import { define } from "@web/utils/state.ts";
import { ChannelTabBody } from "@web/features/projects/components/ChannelTabBody.tsx";

/** Files tab — attachments shared in this channel (`/projects/[projectId]/[channelId]/files`). */
export default define.page(function ChannelFilesPage() {
	return (
		<ChannelTabBody
			title="Files"
			note="Files shared in this channel — attachments, deliverables, and references, newest first."
			filler={8}
		/>
	);
});

import type { JSX } from "preact";
import { EmptyState } from "@projective/ui/utils";
import ConversationChat from "@web/features/messaging/islands/ConversationChat.island.tsx";
import { FilesView } from "@web/features/projects/components/workspace-views.tsx";
import type { ChannelPageData } from "../core/channel-route.ts";

/**
 * ChannelScreen — one entity channel's body (Decision #306), in its two views (Decision #308):
 *
 *   - **Chat** — the `/messages` chat stack's {@link ConversationChat} over the channel's conversation,
 *     its composer mounted in the frame's footer band and its header in the header band, exactly as a
 *     conversation's are.
 *   - **Files** — the files shared in the channel, through the shared {@link FilesView} in its
 *     `conversation` scope: the same explorer the `/messages` and project channel Files tabs mount.
 *
 * An entity with no channel at all says so; the lane's Channels "+" is where one is added.
 */
export function ChannelScreen(props: { data: ChannelPageData }): JSX.Element {
	const { channel, conversationId, tab, page, files } = props.data;
	if (!channel || !conversationId) {
		return (
			<div class="wsp-channel wsp-channel--empty">
				<EmptyState
					title="No channels yet"
					description={`Add one from Channels in the lane. Everyone in ${props.data.workspace.name} is in every channel.`}
				/>
			</div>
		);
	}
	if (tab === "files") {
		if (!files) {
			return (
				<div class="wsp-channel wsp-channel--empty">
					<EmptyState
						title="Files couldn't be read"
						description="The files shared in this channel couldn't be read just now. Try again in a moment."
					/>
				</div>
			);
		}
		return (
			<div class="chan-view wsp-channel">
				<FilesView
					scope="conversation"
					id={conversationId}
					channelId={conversationId}
					initial={files}
				/>
			</div>
		);
	}
	return (
		<div class="chan-view wsp-channel">
			<ConversationChat conversationId={conversationId} initial={page} />
		</div>
	);
}

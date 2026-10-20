import type { JSX } from "preact";
import { EmptyState } from "@projective/ui/utils";
import ConversationChat from "@web/features/messaging/islands/ConversationChat.island.tsx";
import type { ChannelPageData } from "../core/channel-route.ts";

/**
 * ChannelScreen — one entity channel's body (Decision #306): the `/messages` chat stack's
 * {@link ConversationChat} over the channel's conversation, its composer mounted in the frame's footer
 * band and its title in the header band, exactly as a conversation's are. An entity with no channel at
 * all says so; the lane's Channels "+" is where one is added.
 */
export function ChannelScreen(props: { data: ChannelPageData }): JSX.Element {
	const { channel, conversationId, page } = props.data;
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
	return (
		<div class="chan-view wsp-channel">
			<ConversationChat conversationId={conversationId} initial={page} />
		</div>
	);
}

import { define } from "@web/utils/state.ts";
import { resolveMessageFeed } from "@web/features/projects/core/messages-ssr.ts";
import ChatFeed from "@web/features/projects/islands/ChatFeed.island.tsx";
import { readActor } from "@web/utils/api-session.ts";

/**
 * Chat tab — the default channel view (`/projects/[projectId]/[channelId]/chat`, and the bare index).
 * A thin page: it SSR-resolves the LATEST message page straight from the fat service
 * ({@link resolveMessageFeed}, no HTTP hop) and hands it to the {@link ChatFeed} island, which
 * bottom-anchors + virtualizes the stream against the native window scroll. The floating
 * {@link ChatComposer} is the middle-nav frame's sticky footer band (Decision #31), not part of this
 * body, so the stream scrolls unhindered beneath it.
 */
export default define.page(async function ChannelChatPage(ctx) {
	const actor = readActor(ctx);
	const { projectId, channelId } = ctx.params;
	const { page } = await resolveMessageFeed(projectId, channelId, actor);
	return <ChatFeed projectId={projectId} channelId={channelId} initial={page} />;
});

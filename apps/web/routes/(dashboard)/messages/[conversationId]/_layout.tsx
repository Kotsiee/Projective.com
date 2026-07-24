import { define } from "@web/utils/state.ts";

/**
 * Conversation view layout — the scrolling body chrome for a `/messages/[conversationId]/{chat,files,
 * members}` tab. It STRICTLY MIRRORS the project channel layout (`.chan-view`): the ConversationHeader
 * (header band) and the Chat composer (footer band) are mounted by the shell into the middle-nav frame
 * (resolved by `conversationHeaderFor` / `conversationFooterFor`), so the header pins to the top and the
 * composer to the bottom while this body flows between them.
 */
export default define.page(function ConversationLayout(ctx) {
	return (
		<div class="chan-view">
			<ctx.Component />
		</div>
	);
});

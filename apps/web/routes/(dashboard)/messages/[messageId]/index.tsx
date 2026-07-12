import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function ConversationPage(ctx) {
	return (
		<PagePlaceholder
			title="Conversation"
			path={`/messages/${ctx.params.messageId}`}
			note="Active thread — PII-masked during the Protected Phase (PRODUCT_SPEC §Messaging)."
		/>
	);
});

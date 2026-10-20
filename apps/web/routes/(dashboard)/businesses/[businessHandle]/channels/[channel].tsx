import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { channelOutcome } from "@features/workspaces/core/channel-route.ts";
import { consoleResponse } from "@features/workspaces/core/console-route.ts";
import { ChannelScreen } from "@features/workspaces/components/ChannelScreen.tsx";

/**
 * `/businesses/[businessHandle]/channels/[channel]` — one business channel's chat (Decision #306), the
 * buyer-side twin of the team route.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const outcome = await channelOutcome(
			"business",
			ctx.params.businessHandle,
			ctx.params.channel,
			ctx.url,
			readActor(ctx),
		);
		if (outcome.kind !== "data") return consoleResponse(outcome);
		ctx.state.title = `# ${outcome.data.channel?.slug ?? "channels"} · ${outcome.data.workspace.name}`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function BusinessChannelPage({ data }) {
	return <ChannelScreen data={data} />;
});

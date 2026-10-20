import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { channelLabel } from "@projective/types/workspace";
import { channelOutcome } from "@features/workspaces/core/channel-route.ts";
import { consoleResponse } from "@features/workspaces/core/console-route.ts";
import { ChannelScreen } from "@features/workspaces/components/ChannelScreen.tsx";

/**
 * `/teams/[teamHandle]/channels/[channel]` — one team channel's chat (Decision #306): the `/messages`
 * chat stack over the channel's conversation. An unknown or archived channel 303s to `/channels`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const outcome = await channelOutcome(
			"team",
			ctx.params.teamHandle,
			ctx.params.channel,
			ctx.url,
			readActor(ctx),
		);
		if (outcome.kind !== "data") return consoleResponse(outcome);
		ctx.state.title = `# ${outcome.data.channel ? channelLabel(outcome.data.channel) : "channels"} · ${outcome.data.workspace.name}`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function TeamChannelPage({ data }) {
	return <ChannelScreen data={data} />;
});

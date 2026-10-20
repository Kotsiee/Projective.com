import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { channelOutcome } from "@features/workspaces/core/channel-route.ts";
import { consoleResponse } from "@features/workspaces/core/console-route.ts";
import { ChannelScreen } from "@features/workspaces/components/ChannelScreen.tsx";

/**
 * `/teams/[teamHandle]/channels` — 303s to the team's default channel (Decision #306), or says it has
 * none. The redirect lives in the handler; see `channel-route.ts`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const outcome = await channelOutcome(
			"team",
			ctx.params.teamHandle,
			null,
			ctx.url,
			readActor(ctx),
		);
		if (outcome.kind !== "data") return consoleResponse(outcome);
		ctx.state.title = `Channels · ${outcome.data.workspace.name}`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function TeamChannelsPage({ data }) {
	return <ChannelScreen data={data} />;
});

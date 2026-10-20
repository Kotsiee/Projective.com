import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { channelLabel } from "@projective/types/workspace";
import { channelOutcome } from "@features/workspaces/core/channel-route.ts";
import { consoleResponse } from "@features/workspaces/core/console-route.ts";
import { ChannelScreen } from "@features/workspaces/components/ChannelScreen.tsx";

/**
 * `/teams/[teamHandle]/channels/[channel]/files` — the files shared in one team channel (Decision
 * #308): the `/messages` Files tab's explorer over the channel's conversation. An unknown or archived
 * channel 303s to `/channels`, as its Chat view does.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const outcome = await channelOutcome(
			"team",
			ctx.params.teamHandle,
			ctx.params.channel,
			ctx.url,
			readActor(ctx),
			"files",
		);
		if (outcome.kind !== "data") return consoleResponse(outcome);
		const room = outcome.data.channel ? channelLabel(outcome.data.channel) : "channels";
		ctx.state.title = `Files · # ${room} · ${outcome.data.workspace.name}`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function TeamChannelFilesPage({ data }) {
	return <ChannelScreen data={data} />;
});

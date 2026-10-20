import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { channelLabel } from "@projective/types/workspace";
import { channelOutcome } from "@features/workspaces/core/channel-route.ts";
import { consoleResponse } from "@features/workspaces/core/console-route.ts";
import { ChannelScreen } from "@features/workspaces/components/ChannelScreen.tsx";

/**
 * `/businesses/[businessHandle]/channels/[channel]/files` — the files shared in one business channel (Decision
 * #308): the `/messages` Files tab's explorer over the channel's conversation. An unknown or archived
 * channel 303s to `/channels`, as its Chat view does.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const outcome = await channelOutcome(
			"business",
			ctx.params.businessHandle,
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

export default define.page<typeof handler>(function BusinessChannelFilesPage({ data }) {
	return <ChannelScreen data={data} />;
});

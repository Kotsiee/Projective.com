import { signal } from "@preact/signals";
import type { ProjectChannel, ProjectDetail } from "@projective/types/projects";

/**
 * channel-stars — the viewer's starred project rooms (a `project_channel` bookmark, Decision #181).
 * The server's answer rides each channel's `starred`; a star toggled in the channel header lands here
 * at once so the sidebar tree's Starred filter (a different island on the same page) agrees without a
 * reload. Never persisted on the client: the next read carries the server's state.
 */
export const channelStarOverrides = signal<Record<string, boolean>>({});

/** Whether a room is starred, the optimistic override first. */
export function isChannelStarred(channel: Pick<ProjectChannel, "id" | "starred">): boolean {
	return channelStarOverrides.value[channel.id] ?? channel.starred ?? false;
}

/** The server's star for one room of the engagement, by its `comms.project_channels` id. */
export function channelStarredIn(
	detail: Pick<ProjectDetail, "channels">,
	channelId: string,
): boolean {
	const { general, stages, teams } = detail.channels;
	const room = [...general, ...stages.map((s) => s.channel), ...teams.flatMap((t) => t.channels)]
		.find((c) => c.id === channelId);
	return room?.starred ?? false;
}

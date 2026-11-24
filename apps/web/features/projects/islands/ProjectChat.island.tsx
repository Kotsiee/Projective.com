import type { JSX } from "preact";
import ChatFeed from "./ChatFeed.island.tsx";
import { useChatReadWhenSeen } from "../hooks/useChatReadWhenSeen.ts";
import type { MessagePage } from "../types/projects-types.ts";

/**
 * ProjectChat — a project chat's message stream (`/projects/[projectSlug]/discussion`,
 * `/projects/[projectSlug]/[channelId]/chat`): the {@link ChatFeed} island, unchanged, plus the read
 * mark. Once the latest page has painted in a visible tab it posts the mark
 * ({@link useChatReadWhenSeen}; PROJECTS CH3, CAS M10), so reading a stage room clears its dot in the
 * tree and reading a DM inside the project clears it in `/messages` too. The page's GET writes nothing
 * (PRD-C11). The project twin of the inbox's `ConversationChat`.
 */
export default function ProjectChat(
	{ projectId, channelId, initial }: {
		projectId: string;
		channelId: string;
		initial: MessagePage | null;
	},
): JSX.Element {
	useChatReadWhenSeen(projectId, channelId, initial !== null);
	return <ChatFeed projectId={projectId} channelId={channelId} initial={initial} />;
}

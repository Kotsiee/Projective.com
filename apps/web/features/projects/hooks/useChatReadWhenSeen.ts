import { useEffect } from "preact/hooks";
import { whenSeen } from "@web/features/messaging/core/read-marks.ts";
import { markChatSeen } from "../core/chat-read-marks.ts";

/**
 * useChatReadWhenSeen — marks a project chat read once its latest page has painted in a visible tab
 * (PROJECTS CH3; CAS M10, PRD-C11), the project twin of the inbox's `useReadWhenSeen`.
 *
 * The effect runs after the island's first paint, which is when the person can first have seen the
 * latest page; a tab opened in the background waits for its first `visibilitychange` to visible, so
 * a room nobody has looked at stays unread. One mark per chat the island shows; `ready` is false
 * while there is no page to have seen, and then nothing is sent. A `cht-` channel marks the thread,
 * so the inbox's dot clears too; any other channel marks the viewer's own mark in the room. The
 * visibility listener is a browser API, which is why this is an effect and not a signal.
 */
export function useChatReadWhenSeen(projectId: string, channelId: string, ready: boolean): void {
	useEffect(() => {
		if (!ready || typeof document === "undefined") return;
		return whenSeen(document, () => void markChatSeen(projectId, channelId));
	}, [projectId, channelId, ready]);
}

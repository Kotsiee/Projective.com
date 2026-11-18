import { useEffect } from "preact/hooks";
import { markConversationSeen, whenSeen } from "../core/read-marks.ts";

/**
 * useReadWhenSeen — marks a conversation read once its thread has painted in a visible tab (CAS M10,
 * PRD-C11).
 *
 * The effect runs after the island's first paint, which is when the person can first have seen the
 * latest page. A tab opened in the background waits for its first `visibilitychange` to visible
 * instead, so a thread nobody has looked at stays unread. One mark per conversation the island
 * shows; `ready` is false while there is no page to have seen, and then nothing is sent. The
 * visibility listener is a browser API, which is why this is an effect and not a signal.
 */
export function useReadWhenSeen(conversationId: string, ready: boolean): void {
	useEffect(() => {
		if (!ready || typeof document === "undefined") return;
		return whenSeen(document, () => void markConversationSeen(conversationId));
	}, [conversationId, ready]);
}

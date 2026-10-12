import { apiFetch } from "@web/utils/api-client.ts";
import { optimistic, type ToggleOutcome } from "@features/saved/core/optimistic.ts";

const FAILED = "That pin didn't save. Try again.";

/**
 * Pin or unpin a message for everyone in its room (`POST|DELETE /api/messages/[id]/pin`), with the
 * same optimistic discipline as a save: `apply` shows the new state at once and is called again with
 * the old one if the server refuses. Shared by the project chat feed and the popout chat.
 */
export function toggleMessagePin(
	id: string,
	next: boolean,
	apply: (pinned: boolean) => void,
): Promise<ToggleOutcome> {
	return optimistic(`pin:${id}`, next, apply, async () => {
		try {
			const res = await apiFetch(`/api/messages/${encodeURIComponent(id)}/pin`, {
				method: next ? "POST" : "DELETE",
				headers: { accept: "application/json" },
			});
			const body = await res.json().catch(() => null);
			return { ok: res.ok, message: body?.message ?? (res.ok ? "" : FAILED) };
		} catch {
			return { ok: false, message: FAILED };
		}
	}, next ? "Message pinned." : "Message unpinned.");
}

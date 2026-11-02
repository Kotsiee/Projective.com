import { signal } from "@preact/signals";
import { type NavPreviewItem, type NavPreviewKind, NavPreviewSchema } from "@projective/types/user";
import { apiFetch } from "@web/utils/api-client.ts";

/**
 * nav-preview-state — the client cache behind the rail's right-click previews (Decision #370).
 * Nothing is read on page load: {@link loadNavPreview} runs when a destination's menu opens, and a
 * read younger than {@link NAV_PREVIEW_STALE_MS} answers a repeat right-click with no request. A stale
 * read keeps showing while its refresh is in flight.
 */

/** One destination's preview: in flight with nothing to show, its rows, or a failed first read. */
export type NavPreviewState =
	| { status: "loading" }
	| { status: "ready"; items: readonly NavPreviewItem[] }
	| { status: "error" };

/** How long a read answers repeat right-clicks before it is refreshed. */
export const NAV_PREVIEW_STALE_MS = 45_000;

/** Every destination's preview read so far on this page. */
export const navPreviews = signal<Partial<Record<NavPreviewKind, NavPreviewState>>>({});

const readAt = new Map<NavPreviewKind, number>();

function put(kind: NavPreviewKind, state: NavPreviewState): void {
	navPreviews.value = { ...navPreviews.value, [kind]: state };
}

/** Read `kind`'s preview unless a fresh read (or one in flight) already answers it. */
export async function loadNavPreview(kind: NavPreviewKind, now = Date.now()): Promise<void> {
	const last = readAt.get(kind);
	if (last !== undefined && now - last < NAV_PREVIEW_STALE_MS) return;
	readAt.set(kind, now);
	const shown = navPreviews.value[kind];
	if (shown?.status !== "ready") put(kind, { status: "loading" });
	try {
		const res = await apiFetch(`/api/nav/preview?kind=${kind}`);
		const body = NavPreviewSchema.safeParse(res.ok ? await res.json() : null);
		if (!body.success) throw new Error(`nav preview ${kind}: ${res.status}`);
		put(kind, { status: "ready", items: body.data.items });
	} catch {
		// Retry on the next open; a stale list stays up rather than turning into an error.
		readAt.delete(kind);
		if (navPreviews.value[kind]?.status !== "ready") put(kind, { status: "error" });
	}
}

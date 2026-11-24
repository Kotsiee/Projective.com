import type { ProjectsResult } from "../types/results.ts";
import { apiFetch } from "@web/utils/api-client.ts";
import { BACKGROUND_HEADER } from "@web/utils/offline.ts";

/**
 * Projects transport primitives — the `fetch` helpers the thin {@link ProjectSidebarService} composes
 * over. Reads are GETs; mutations are JSON POST/PATCH/DELETE. Any network/parse failure degrades to a
 * soft `{ ok: false, message }` rather than throwing, so islands stay dumb (mirrors `explore/core/api.ts`).
 *
 * Requests go through {@link apiFetch}, so an expired access token on a live `/api/projects/*` read is
 * silently refreshed and retried (or, if the session is truly gone, routed to `/login` with the
 * current path preserved) instead of surfacing as a bare failure or a surprise logout.
 *
 * The three write verbs share one body ({@link sendProjects}) because the only thing that differs
 * between them is the method string — and a mutation whose failure handling depended on which verb
 * carried it would be a mutation with three chances to swallow an error.
 */

/** GET a projects endpoint, folding the response into a soft {@link ProjectsResult}. */
export async function getProjects<T>(path: string): Promise<ProjectsResult<T>> {
	try {
		const res = await apiFetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as ProjectsResult<T>;
		return { ok: false, message: "Unexpected response from the projects service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** Send a JSON body to a projects endpoint under one verb, folding the response into a result. */
async function sendProjects<T>(
	method: "POST" | "PATCH" | "PUT" | "DELETE",
	path: string,
	payload: unknown,
): Promise<ProjectsResult<T>> {
	try {
		const res = await apiFetch(path, {
			method,
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(payload),
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as ProjectsResult<T>;
		return { ok: false, message: "Unexpected response from the projects service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** POST JSON to a projects endpoint, folding the response into a soft {@link ProjectsResult}. */
export function postProjects<T>(path: string, payload: unknown): Promise<ProjectsResult<T>> {
	return sendProjects<T>("POST", path, payload);
}

/**
 * POST a background signal to a projects endpoint that answers with no body (a 204): a read mark the
 * page sends on its own, never on a person's click. Marked as a background request, so the offline
 * shell never queues or announces it, and `keepalive`, so a mark sent as the tab closes still lands.
 * Mirrors the inbox's `signalMessaging`.
 */
export async function signalProjects(
	path: string,
	payload: unknown,
): Promise<ProjectsResult<null>> {
	try {
		const res = await apiFetch(path, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				[BACKGROUND_HEADER]: "1",
			},
			body: JSON.stringify(payload),
			keepalive: true,
		});
		if (res.ok) return { ok: true, data: null };
		const body = await res.json().catch(() => null);
		return {
			ok: false,
			message: typeof body?.message === "string"
				? body.message
				: "The projects service refused it.",
		};
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** PATCH JSON to a projects endpoint — a partial edit of an existing engagement. */
export function patchProjects<T>(path: string, payload: unknown): Promise<ProjectsResult<T>> {
	return sendProjects<T>("PATCH", path, payload);
}

/**
 * DELETE a projects endpoint, with a body.
 *
 * A body on a DELETE is unusual and deliberate: archiving carries an optional reason, and the
 * alternative — putting it in the query string — would write a person's stated reason for closing an
 * engagement into every access log and referrer header on the way (root CLAUDE.md §Privacy).
 */
export function deleteProjects<T>(path: string, payload: unknown): Promise<ProjectsResult<T>> {
	return sendProjects<T>("DELETE", path, payload);
}

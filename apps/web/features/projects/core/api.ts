import type { ProjectsResult } from "../types/results.ts";

/**
 * Projects transport primitives — the `fetch` helpers the thin {@link ProjectSidebarService} composes
 * over. Reads are GETs; mutations (Create) are JSON POSTs. Any network/parse failure degrades to a
 * soft `{ ok: false, message }` rather than throwing, so islands stay dumb (mirrors `explore/core/api.ts`).
 */

/** GET a projects endpoint, folding the response into a soft {@link ProjectsResult}. */
export async function getProjects<T>(path: string): Promise<ProjectsResult<T>> {
	try {
		const res = await fetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as ProjectsResult<T>;
		return { ok: false, message: "Unexpected response from the projects service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** POST JSON to a projects endpoint, folding the response into a soft {@link ProjectsResult}. */
export async function postProjects<T>(path: string, payload: unknown): Promise<ProjectsResult<T>> {
	try {
		const res = await fetch(path, {
			method: "POST",
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

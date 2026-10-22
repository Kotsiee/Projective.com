import type { WorkspaceMember } from "@projective/types/workspace";

/**
 * member-inspector-model — the member inspector's address and lookups (Decision #322), pure so the
 * server's panel resolver, the inspector island and the Members body agree on one reading of
 * `?member=<handle>`.
 */

/** The query parameter naming the member the inspector stands open on. */
export const MEMBER_PARAM = "member";

/** `search` with `?member=` set to `handle`, or dropped for `null`; every other parameter kept. */
export function memberSearch(search: string, handle: string | null): string {
	const params = new URLSearchParams(search);
	if (handle) params.set(MEMBER_PARAM, handle);
	else params.delete(MEMBER_PARAM);
	const next = params.toString();
	return next ? `?${next}` : "";
}

/** The handle an address names, or `null` when it names none. */
export function memberOfSearch(search: string): string | null {
	const handle = new URLSearchParams(search).get(MEMBER_PARAM)?.trim() ?? "";
	return handle === "" ? null : handle;
}

/** The active member a handle names — a member who left, or a stale link, names nobody. */
export function inspectedMember<M extends Pick<WorkspaceMember, "handle" | "state">>(
	members: readonly M[],
	handle: string | null,
): M | null {
	if (!handle) return null;
	const key = handle.replace(/^@/, "").toLowerCase();
	return members.find((m) => m.state === "active" && m.handle.toLowerCase() === key) ?? null;
}

/** The slide-over inspector's root class — the Members body waits for it to leave before a dialog. */
export const MEMBER_SHEET_CLASS = "wsp-inspector-sheet";

import {
	DISCUSSION_REF,
	discussionOf,
	type FileChannelRef,
	type ProjectDetail,
} from "@projective/types/projects";

/**
 * file-tree-route — the File Explorer's folder tree as an address (Decision #317).
 *
 * The project-scope tree (All files · Project files · the channels) is a real location: the selection
 * rides in `?in=` on `/projects/{project}/files`, so a node is deep-linkable, copyable and walked by
 * Back, and the SSR page reads the same node the island will. On a channel's own Files route the same
 * tree is drawn with that channel selected, and every node is a LINK to its own address.
 *
 * A channel node's key is its room id (what the file index carries), but a room id is not an address:
 * a stage routes only by its `stg-…` slug (Decision #88). {@link fileChannelRoutes} maps one onto the
 * other from the engagement's own channel tree, and every address here is built from that map.
 *
 * Pure (types only), so it is unit-tested without the dev seam the explorer island reaches.
 */

// #region Model
/** A node of the project-scope tree. */
export type FileTreeSelection =
	| { kind: "all" }
	| { kind: "project" }
	| { kind: "channel"; id: string };

/** The query parameter the selection rides in. */
export const FILES_IN_PARAM = "in";

/** The `?in=` value of the client's Project files node. */
const PROJECT_NODE = "project";

/** Room id → the route ref that addresses it (a stage's slug; any other room's own id). */
export type FileChannelRoutes = Record<string, string>;

/**
 * Every room of the engagement against the ref that routes it: the engagement's discussion by
 * `discussion` (Decision #133, whichever room it is), a stage by its `stg-…` slug, a general or team
 * channel by its id, a direct message by its thread.
 */
export function fileChannelRoutes(
	detail: Pick<ProjectDetail, "format" | "structure" | "channels">,
): FileChannelRoutes {
	const { channels } = detail;
	const routes: FileChannelRoutes = {};
	for (const c of channels.general) routes[c.id] = c.id;
	for (const s of channels.stages) routes[s.id] = s.slug;
	for (const t of channels.teams) for (const c of t.channels) routes[c.id] = c.id;
	for (const d of channels.dms) routes[d.chatId] = d.chatId;
	const discussion = discussionOf(detail);
	if (discussion) {
		routes[discussion.kind === "stage" ? discussion.stage.id : discussion.channel.id] =
			DISCUSSION_REF;
	}
	return routes;
}

/** The room a route ref names, when the map knows it; otherwise the ref itself. */
export function roomOfRef(routes: FileChannelRoutes, ref: string): string {
	for (const [room, route] of Object.entries(routes)) if (route === ref) return room;
	return ref;
}

/** The selection a `?in=` value names — the project files node, a channel by its route ref, or all. */
export function selectionOfSearch(
	search: string,
	routes: FileChannelRoutes = {},
): FileTreeSelection {
	const raw = new URLSearchParams(search).get(FILES_IN_PARAM)?.trim() ?? "";
	if (!raw) return { kind: "all" };
	if (raw === PROJECT_NODE) return { kind: "project" };
	return { kind: "channel", id: roomOfRef(routes, raw) };
}

/** A search string carrying a selection, every other parameter kept; `""` when nothing is left. */
export function searchWithSelection(
	search: string,
	selection: FileTreeSelection,
	routes: FileChannelRoutes = {},
): string {
	const params = new URLSearchParams(search);
	if (selection.kind === "all") params.delete(FILES_IN_PARAM);
	else if (selection.kind === "project") params.set(FILES_IN_PARAM, PROJECT_NODE);
	else params.set(FILES_IN_PARAM, routes[selection.id] ?? selection.id);
	const out = params.toString();
	return out ? `?${out}` : "";
}

/**
 * The address of a node from a channel's own Files route: All files and Project files on the
 * project's Files route, a channel on its own. `null` for a room the map cannot route.
 */
export function selectionHref(
	projectSlug: string,
	selection: FileTreeSelection,
	routes: FileChannelRoutes,
): string | null {
	const files = `/projects/${encodeURIComponent(projectSlug)}/files`;
	if (selection.kind === "all") return files;
	if (selection.kind === "project") return `${files}?${FILES_IN_PARAM}=${PROJECT_NODE}`;
	const ref = routes[selection.id];
	return ref
		? `/projects/${encodeURIComponent(projectSlug)}/${encodeURIComponent(ref)}/files`
		: null;
}

/** The node's title — the header band's heading for the folder in view. */
export function selectionTitle(
	selection: FileTreeSelection,
	channels: readonly FileChannelRef[],
): string {
	if (selection.kind === "all") return "All files";
	if (selection.kind === "project") return "Project files";
	return channels.find((c) => c.id === selection.id)?.name ?? "Channel files";
}

/** Whether two selections name the same node. */
export function sameSelection(a: FileTreeSelection, b: FileTreeSelection): boolean {
	if (a.kind !== b.kind) return false;
	return a.kind !== "channel" || a.id === (b as { id: string }).id;
}
// #endregion

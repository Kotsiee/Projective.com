/**
 * files-dnd — the addressing behind the hub's drag and drop.
 *
 * A file dragged from the body lands on a folder in the grid, a crumb in the trail or a row of the
 * lane's tree. Those live in three components the drag does not own, and the lane is another hydration
 * root, so no shared `DndContext` can reach it. So a target is marked in the DOM and found there:
 * {@link dropAttrs} on the element, `elementFromPoint` while the pointer moves. What a person drops on
 * is therefore exactly what is painted under the pointer, including a tree row scrolled out of view,
 * which keeps its rect but is no longer there to drop on. A source is marked the same way
 * ({@link dragAttrs}) so one delegated listener serves every grid cell and table row.
 *
 * Pure and DOM-free apart from the attribute names, so the decoding is testable.
 */

/** The attribute that marks an element as a drag source: `asset:{id}` or `folder:{id}`. */
export const DRAG_ATTR = "data-fh-drag";

/** The attribute that marks an element as a drop target: a folder id, or the library root. */
export const DROP_ATTR = "data-fh-drop";

/** The drop id of the library root, a real destination that has no folder id. */
const ROOT_DROP = "root";

export type DragKind = "asset" | "folder";

/** Mark an element as a drag source. */
export function dragAttrs(kind: DragKind, id: string): Record<`data-${string}`, string> {
	return { [DRAG_ATTR]: `${kind}:${id}` };
}

/** Mark an element as the drop target for a folder, or for the library root (`null`). */
export function dropAttrs(folderId: string | null): Record<`data-${string}`, string> {
	return { [DROP_ATTR]: folderId ?? ROOT_DROP };
}

/** The source a drag id names. */
export function dragOf(id: string): { kind: DragKind; id: string } {
	const at = id.indexOf(":");
	return { kind: id.slice(0, at) === "folder" ? "folder" : "asset", id: id.slice(at + 1) };
}

/** The folder a drop id lands in; `null` is the library root. */
export function folderOfDrop(id: string): string | null {
	return id === ROOT_DROP ? null : id;
}

/** What a drag carries. */
export interface DragPayload {
	assetIds: string[];
	folderIds: string[];
}

/**
 * What a drag from `source` moves. A drag from a selected item carries the selection, and one from
 * anything else carries only itself, which is what somebody who selected nothing means by it. Only
 * what the viewer manages travels: `manageable` is the rows that may, by kind.
 */
export function payloadOf(
	source: { kind: DragKind; id: string },
	selection: readonly string[],
	manageable: DragPayload,
): DragPayload {
	const carried = selection.includes(source.id) ? selection : [source.id];
	return {
		assetIds: manageable.assetIds.filter((id) => carried.includes(id)),
		folderIds: manageable.folderIds.filter((id) => carried.includes(id)),
	};
}

/** Whether a drop would change nothing: the place the rows already are, or a folder onto itself. */
export function isIdleDrop(
	payload: DragPayload,
	target: string | null,
	here: string | null,
): boolean {
	return target === here || (target !== null && payload.folderIds.includes(target));
}

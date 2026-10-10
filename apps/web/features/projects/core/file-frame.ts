import type { ModalFrame, ModalStack } from "@ui/overlay/core/modal-stack.ts";
import type { AssetItem } from "../types/projects-types.ts";

/**
 * file-frame — the preview as a frame of a modal stack. Opening a file from inside another modal
 * (a ticket, a review) REPLACES that modal on its stack rather than covering it; the files the
 * preview pages through travel in the new frame's cache, and the opener records which file it came
 * from so focus can return to that tile when the frame is popped.
 *
 * Pure and DOM-free: the stack is the only state it touches.
 */

// #region Cache keys
/** The frame-cache key a file frame keeps the files it pages through under. */
export const FILE_FRAME_FILES = "files";
/** The frame-cache key a file frame keeps the id of the file it opened on under. */
export const FILE_FRAME_START = "startFileId";
/**
 * The frame-cache key a frame keeps its focus-return trigger under when another frame replaces it:
 * the id of the file that opened a preview, or a control token the frame resolves itself.
 */
export const FILE_FRAME_TRIGGER = "triggerFileId";
// #endregion

// #region Opening
/** How a file frame joins its stack: on top of the open frame, or as a new chain. */
export type FileFrameMode = "push" | "open";

/**
 * Open a file frame on `stack`, seeded with the group it pages through.
 *
 * In `push` mode the frame beneath records `fileId` as the trigger to refocus when it is restored.
 * The cache is written synchronously after the frame is created, before any host re-renders.
 */
export function openFileFrame<K extends string, I>(
	stack: ModalStack<K, I>,
	kind: K,
	input: I,
	files: readonly AssetItem[],
	fileId: string,
	mode: FileFrameMode = "push",
): ModalFrame<K, I> {
	const parent = mode === "push" ? stack.top.peek() : null;
	if (parent) stack.write(parent.uid, FILE_FRAME_TRIGGER, fileId);
	const frame = mode === "push" ? stack.push(kind, fileId, input) : stack.open(kind, fileId, input);
	stack.write(frame.uid, FILE_FRAME_FILES, [...files]);
	stack.write(frame.uid, FILE_FRAME_START, fileId);
	return frame;
}
// #endregion

// #region Reading
/** What a file frame renders from: its group and the index it opened on. */
export interface FileFrameSeed {
	files: AssetItem[];
	startIndex: number;
}

/** The group a file frame pages through and the index of the file it opened on (0 if missing). */
export function fileFrameSeed(stack: ModalStack<string, unknown>, uid: number): FileFrameSeed {
	const files = stack.read<AssetItem[]>(uid, FILE_FRAME_FILES, []);
	const start = stack.read<string | null>(uid, FILE_FRAME_START, null);
	const index = start === null ? -1 : files.findIndex((f) => f.id === start);
	return { files, startIndex: Math.max(0, index) };
}

/** Read and clear the trigger a restored frame should refocus; `null` when none was recorded. */
export function takeFileTrigger(stack: ModalStack<string, unknown>, uid: number): string | null {
	const id = stack.read<string | null>(uid, FILE_FRAME_TRIGGER, null);
	if (id !== null) stack.write(uid, FILE_FRAME_TRIGGER, null);
	return id;
}

/** Apply `patch` to one file of a group, leaving the others as they are. */
export function patchFile(
	files: readonly AssetItem[],
	id: string,
	patch: (file: AssetItem) => AssetItem,
): AssetItem[] {
	return files.map((f) => (f.id === id ? patch(f) : f));
}
// #endregion

// #region Carrying state between frames
/** Cached values of one frame, keyed as the frame wrote them. */
export type FrameSnapshot = ReadonlyMap<string, unknown>;

/** Copy the listed keys a frame has written; keys it never wrote are left out. */
export function snapshotFrame(
	stack: ModalStack<string, unknown>,
	uid: number,
	keys: readonly string[],
): FrameSnapshot {
	const out = new Map<string, unknown>();
	for (const key of keys) if (stack.has(uid, key)) out.set(key, stack.read(uid, key, null));
	return out;
}

/** Write a snapshot into a frame's cache before it first renders. */
export function seedFrame(
	stack: ModalStack<string, unknown>,
	uid: number,
	snapshot: FrameSnapshot,
): void {
	for (const [key, value] of snapshot) stack.write(uid, key, value);
}
// #endregion

// #region Click intent
/** The pointer facts a tile click carries. */
export interface TileClick {
	button: number;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

/**
 * What a click on a file tile asks for: the in-app preview for a plain primary click, a new tab for
 * a middle click or a modified primary click (the browser's own convention), nothing otherwise.
 */
export function fileOpenIntent(click: TileClick): "preview" | "tab" | null {
	if (click.button === 1) return "tab";
	if (click.button !== 0) return null;
	return click.ctrlKey || click.metaKey || click.shiftKey ? "tab" : "preview";
}
// #endregion

import type { FileItem, FileKind, FileSortKey } from "../types/projects-types.ts";

/**
 * file-model — pure, DOM-free helpers for the File Explorer (labels, filter/sort vocabularies, and
 * the message-group resolution the preview modal's carousel needs). No JSX, no signals — safe to
 * import from SSR and islands alike (glyphs live in `components/file-glyphs.tsx`).
 */

// #region Kind vocabulary
/** Human label for a file kind (the filter chips + the list "type" cell + a11y). */
export function kindLabel(kind: FileKind): string {
	switch (kind) {
		case "image":
			return "Image";
		case "video":
			return "Video";
		case "audio":
			return "Audio";
		case "pdf":
			return "PDF";
		case "doc":
			return "Document";
		case "code":
			return "Code";
		case "archive":
			return "Archive";
		default:
			return "File";
	}
}

/** The Attachment-Types filter options, in display order. */
export const FILE_KIND_OPTIONS: { value: FileKind; label: string }[] = [
	{ value: "image", label: "Images" },
	{ value: "video", label: "Videos" },
	{ value: "audio", label: "Audio" },
	{ value: "pdf", label: "PDFs" },
	{ value: "doc", label: "Documents" },
	{ value: "code", label: "Code" },
	{ value: "archive", label: "Archives" },
	{ value: "file", label: "Other" },
];

/** The sort-property options for the SortControl + the table's clickable headers. */
export const FILE_SORT_OPTIONS: { value: FileSortKey; label: string }[] = [
	{ value: "date", label: "Date" },
	{ value: "name", label: "Name" },
	{ value: "size", label: "Size" },
	{ value: "sender", label: "Sender" },
	{ value: "type", label: "Type" },
];
// #endregion

// #region Message grouping (the preview carousel)
/**
 * The sibling files that were posted together with `file` (same `messageId`), in stable id order —
 * the set the preview modal's swipe carousel + companion tray walk. A lone attachment yields a
 * one-item group.
 */
export function messageGroup(items: FileItem[], file: FileItem): FileItem[] {
	const group = items.filter((it) => it.messageId === file.messageId);
	if (group.length <= 1) return [file];
	return group.slice().sort((a, b) => a.id.localeCompare(b.id));
}

/** The index of `file` within its message group. */
export function groupIndexOf(group: FileItem[], file: FileItem): number {
	const i = group.findIndex((it) => it.id === file.id);
	return i === -1 ? 0 : i;
}
// #endregion

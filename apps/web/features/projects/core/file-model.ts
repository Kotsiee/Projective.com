import { formatDate } from "@ui/display/core/table-format.ts";
import type { ExplorerFileItem, FileKind, FileSortKey } from "../types/projects-types.ts";

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
 * the set the preview modal's swipe carousel + companion tray walk. A lone attachment, or a project
 * file (posted in no message), yields a one-item group.
 */
export function messageGroup<T extends ExplorerFileItem>(items: T[], file: T): T[] {
	if (file.messageId === null) return [file];
	const group = items.filter((it) => it.messageId === file.messageId);
	if (group.length <= 1) return [file];
	return group.slice().sort((a, b) => a.id.localeCompare(b.id));
}

/** The index of `file` within its message group. */
export function groupIndexOf(group: ExplorerFileItem[], file: ExplorerFileItem): number {
	const i = group.findIndex((it) => it.id === file.id);
	return i === -1 ? 0 : i;
}
// #endregion

// #region Dates
/**
 * A file's date on the viewer's own clock, in the shape of the server's `dateLabel`
 * (`Nov 6 · 10:05 PM`). The server writes that label in UTC, the one zone it can render the same way
 * twice, so it can be a day out for the person reading it. `en-US` is the shape, not a language.
 */
export function formatFileDate(ms: number): string {
	return formatDate(ms, "datetime", "en-US", Date.now());
}

/** {@link formatFileDate} for a row. One with no stored date keeps the words it came with. */
export function fileDateLabel(
	file: { createdAt: string; dateLabel: string; status?: string },
): string {
	const ms = Date.parse(file.createdAt);
	return Number.isNaN(ms) || file.status === "pending_upload" ? file.dateLabel : formatFileDate(ms);
}
// #endregion

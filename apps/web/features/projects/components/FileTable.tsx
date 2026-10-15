import type { JSX } from "preact";
import { computed, type ReadonlySignal, type Signal } from "@preact/signals";
import { useMemo } from "preact/hooks";
import { type DataColumn, type DataSort, DataTable } from "@projective/ui/display";
import type { MenuItem } from "@projective/ui/navigation";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";
import { assetMediaSrc, assetPlaceholder } from "@features/files/core/asset-media.ts";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import {
	type AssetItem,
	type FileSortDir,
	type FileSortKey,
	sourceLabel,
} from "../types/projects-types.ts";
import { displayZoom, listRowHeight, listShowsThumbnails } from "../core/view-state.ts";
import { FileKindIcon } from "./file-glyphs.tsx";

/**
 * FileTable — the file list as a `DataTable` preset: Name (kind glyph, or a thumbnail once zoomed in) ·
 * Sender · Date · Size, sorted on the server through the caller's shared sort signals, with row
 * height driven by the files zoom. Used by every file surface: the projects and messages explorers,
 * Submissions, the `/files` hub and the ticket and event attachment tabs.
 */
export interface FileTableProps {
	items: AssetItem[];
	/** Shared sort key (a plain-string signal so it binds the same signal the toolbar SortControl uses). */
	sortKey: ReadonlySignal<string>;
	sortDir: ReadonlySignal<FileSortDir>;
	/** Set/toggle the shared sort (owned by the island — it refetches). */
	onSort: (key: FileSortKey) => void;
	onOpen: (file: AssetItem) => void;
	onReachEnd?: () => void;
	/** The next page is loading. */
	loading?: boolean;
	/**
	 * Whether rows window-virtualize. Default on — the explorer's corpus is unbounded. Turn it off
	 * inside a dialog, whose scroller is its own body and whose list is a bounded handful.
	 */
	virtualize?: boolean;
	/** Selected asset ids; with `onSelectionChange`, rows select (Ctrl/Cmd toggles, Shift ranges). */
	selection?: readonly string[];
	onSelectionChange?: (ids: string[]) => void;
	/** The Shift-range anchor, shared with a grid view of the same files. */
	selectionAnchor?: Signal<string | null>;
	/** Per-file actions on a trailing kebab and on right-click. */
	rowActions?: (file: AssetItem) => readonly MenuItem[];
}

const MEDIA_KINDS: ReadonlySet<string> = new Set(["image", "video"]);

const FILE_COLUMNS: readonly DataColumn<AssetItem>[] = [
	{
		id: "name",
		header: "Name",
		type: "file",
		sortKey: "name",
		fill: true,
		minWidth: 200,
		pinned: true,
		value: (file) => {
			const src = MEDIA_KINDS.has(file.kind) ? assetMediaSrc(file, "sm") : null;
			return {
				name: file.name,
				icon: <FileKindIcon kind={file.kind} size={18} />,
				thumb: src ? { src, placeholder: assetPlaceholder(file) } : null,
			};
		},
	},
	{
		id: "sender",
		header: "Sender",
		type: "person",
		sortKey: "sender",
		width: 200,
		priority: 2,
		value: (file) => (file.sender ? { name: file.sender.name, avatar: file.sender.avatar } : null),
		fallback: (file) => sourceLabel(file.source),
	},
	{
		id: "date",
		header: "Date",
		type: "date",
		sortKey: "date",
		format: "datetime",
		width: 176,
		priority: 3,
		value: (file) => file.createdAt,
	},
	{
		id: "size",
		header: "Size",
		type: "fileSize",
		sortKey: "size",
		width: 112,
		priority: 1,
		value: (file) => file.sizeBytes,
	},
];

const ROW_HEIGHT = computed(() => listRowHeight(displayZoom.value));
const COLUMN_STATE = { key: LocalKeys.FILES_COLUMNS, version: 2 };
const STICKY_TOP = "calc(var(--fx-chrome, var(--shell-topbar-h, 0px)) + var(--fx-toolbar-h, 0px))";

export function FileTable(props: FileTableProps): JSX.Element {
	const { items, sortKey, sortDir, onSort } = props;
	const sorts: readonly DataSort[] = sortKey.value
		? [{ key: sortKey.value, dir: sortDir.value }]
		: [];
	const selection = useMemo(() => new Set(props.selection ?? []), [props.selection]);
	const selectable = Boolean(props.onSelectionChange);

	return (
		<DataTable
			rows={items}
			rowKey={(file) => file.id}
			rowLabel={(file) => file.name}
			columns={FILE_COLUMNS}
			aria-label="Files"
			dataMode="server"
			sort={sorts}
			multiSort={false}
			onSortChange={(next) => onSort((next[0]?.key ?? sortKey.peek()) as FileSortKey)}
			selectionMode={selectable ? "multiple" : "none"}
			selection={selectable ? selection : undefined}
			onSelectionChange={props.onSelectionChange
				? (next) => props.onSelectionChange?.([...next])
				: undefined}
			selectionAnchor={props.selectionAnchor}
			onRowActivate={(file) => props.onOpen(file)}
			rowActions={props.rowActions}
			rowHeight={ROW_HEIGHT}
			thumbnailMinRowHeight={listShowsThumbnails(displayZoom.value) ? 0 : Number.POSITIVE_INFINITY}
			onReachEnd={props.onReachEnd}
			loadingMore={props.loading}
			virtualize={props.virtualize}
			columnState={COLUMN_STATE}
			stickyTop={STICKY_TOP}
			avatarFallback={DEFAULT_AVATAR_URL}
		/>
	);
}

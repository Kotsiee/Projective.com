import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { Message } from "@projective/ui/feedback";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import type { AssetItem, FileSortDir, FileSortKey } from "@projective/types/files";
import type { CalendarEvent } from "@projective/types/scheduling";
import { FileCard } from "@features/projects/components/FileCard.tsx";
import { FileTable } from "@features/projects/components/FileTable.tsx";
import { GridIcon, ListIcon } from "@features/projects/components/file-glyphs.tsx";
import { filesZoom, gridColWidth, viewMode, zoom } from "@features/projects/core/view-state.ts";

// This tab mounts the `/files` cards, table and empty state, so it carries their sheets — a component
// and not its host island is the right carrier (root CLAUDE.md §8 Decision #39: shared CSS reaches a
// page only through an island's module graph, and this modal is opened from more than one island).
import "@features/projects/styles/file-explorer.css";
import "@features/projects/styles/file-table.css";
import "@features/projects/styles/file-card.css";

/**
 * EventAttachmentsTab — the agenda pack: briefs, decks, references and recordings hung on the
 * occurrence.
 *
 * It mounts the SAME {@link FileCard} grid and {@link FileTable} list the File Explorer and the ticket
 * modal do, and shares the SAME zoom store — so the density a viewer chose on `/files` is the density
 * they get here, `Ctrl`+wheel works identically, and crossing the centre marker transitions list ⇄
 * grid with no second toggle competing with it. An event's attachments ARE assets; a second renderer
 * is how the two stop agreeing.
 *
 * What it does NOT share is the virtualization. The explorer windows an unbounded corpus against the
 * page scroller; this tab lives inside a modal whose scroller is its own body, so a window-virtualized
 * list here would measure a box the rows are not in. An event's pack is a bounded handful, so it all
 * renders.
 *
 * Only the HOST attaches. An attendee reads and downloads — the pack is the material the arranger
 * hands out, and an attendee's own work belongs in the project it is for, not stapled to a meeting.
 */
export interface EventAttachmentsTabProps {
	event: CalendarEvent;
	/** Whether the acting viewer arranges this event (the host). */
	canUpload: boolean;
	onPatch: (patch: Partial<CalendarEvent>) => void;
}

export function EventAttachmentsTab(props: EventAttachmentsTabProps): JSX.Element {
	const { event, canUpload } = props;
	const workspaceRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	useCtrlWheelZoom(workspaceRef, filesZoom);

	// A bounded set sorts in place — there is no server page to re-request for a handful of rows.
	const sortKey = useSignal<string>("date");
	const sortDir = useSignal<FileSortDir>("desc");
	/** Why a press did nothing. Cleared by the next one that does something. */
	const notice = useSignal<string | null>(null);

	const attachments = event.attachments ?? [];
	const items = sortAssets(attachments, sortKey.value as FileSortKey, sortDir.value);

	/**
	 * Staged by NAME only, matching every other write on this surface. Real upload lands with the
	 * backend gate; a progress bar over a file that is going nowhere would be worse than an honest
	 * placeholder that says what it is.
	 */
	function stage(files: FileList | null): void {
		const added = Array.from(files ?? []);
		if (added.length === 0) return;
		props.onPatch({
			attachments: [
				...attachments,
				...added.map((f, i) => stagedAsset(event, attachments.length + i, f)),
			],
		});
	}

	/**
	 * Open an attachment in a new tab.
	 *
	 * `noopener,noreferrer` is not optional here: an attachment URL is arbitrary — an external drive's
	 * signed link, a link asset somebody pasted — and without it the opened document gets a live
	 * `window.opener` handle back into this one and can navigate it (reverse tabnabbing). Every call
	 * site in the `/files` hub this tab mounts its cards from passes the same pair.
	 *
	 * A staged row has no bytes anywhere yet — the files domain's stub `url` is the placeholder `"#"` —
	 * so there is nothing to open and the press says so rather than spawning a blank tab.
	 */
	function openAsset(file: AssetItem): void {
		if (file.status === "pending_upload" || !file.url || file.url === "#") {
			notice.value = `“${file.name}” hasn't been uploaded yet, so there is nothing to open.`;
			return;
		}
		notice.value = null;
		globalThis.open(file.url, "_blank", "noopener,noreferrer");
	}

	function applySort(key: FileSortKey): void {
		if (sortKey.value === key) {
			if (sortDir.value === "asc") sortDir.value = "desc";
			else sortKey.value = "";
		} else {
			sortKey.value = key;
			sortDir.value = "asc";
		}
	}

	return (
		<div class="evm-files">
			<div class="evm-files__bar">
				<h3 class="evm-h">
					Agenda pack
					{attachments.length > 0 ? <span class="evm-h__count">{attachments.length}</span> : null}
				</h3>
				<ViewZoomRig
					store={filesZoom}
					label="Attachment view zoom"
					listIcon={<ListIcon size={16} />}
					gridIcon={<GridIcon size={16} />}
					class="evm-files__zoom"
				/>
				{canUpload
					? (
						<>
							<button
								type="button"
								class="evm-addfile"
								onClick={() => inputRef.current?.click()}
							>
								<Icon name="upload" size="xs" />
								Add attachment
							</button>
							<input
								ref={inputRef}
								type="file"
								multiple
								class="evm-sr"
								aria-label="Attach files to this event"
								onChange={(e) => {
									const input = e.currentTarget as HTMLInputElement;
									stage(input.files);
									input.value = "";
								}}
							/>
						</>
					)
					: null}
			</div>

			<div class="evm-files__work" ref={workspaceRef}>
				{attachments.length === 0
					? (
						<div class="fx-empty" role="status">
							<p class="fx-empty__title">Nothing attached yet</p>
							<p class="fx-empty__note">
								{canUpload
									? "Add the agenda, the deck and anything people should read first."
									: "The organiser has not shared any material for this one."}
							</p>
						</div>
					)
					: viewMode.value === "grid"
					? (
						<div class="evm-files__grid" style={`--evm-col:${gridColWidth(zoom.value)}px`}>
							{items.map((f) => <FileCard key={f.id} file={f} onOpen={() => openAsset(f)} />)}
						</div>
					)
					: (
						<FileTable
							items={items}
							sortKey={sortKey}
							sortDir={sortDir}
							onSort={applySort}
							onOpen={openAsset}
							virtualize={false}
						/>
					)}
			</div>

			{/* `.evm-files` is a flex column with a gap, so this needs no rule of its own. */}
			{notice.value ? <Message severity="info" size="sm">{notice.value}</Message> : null}

			{!canUpload
				? (
					<p class="evm-note">
						<Icon name="info" size="2xs" />
						Only the organiser adds material to an event.
					</p>
				)
				: null}
		</div>
	);
}

/** Sort in place over a bounded set. An empty key is the third state — the order they arrived in. */
function sortAssets(items: AssetItem[], key: FileSortKey | "", dir: FileSortDir): AssetItem[] {
	if (!key) return items;
	const sign = dir === "asc" ? 1 : -1;
	return [...items].sort((a, b) => {
		switch (key) {
			case "name":
				return sign * a.name.localeCompare(b.name);
			case "size":
				return sign * (a.sizeBytes - b.sizeBytes);
			case "sender":
				return sign * (a.sender?.name ?? "").localeCompare(b.sender?.name ?? "");
			default:
				return sign * (Date.parse(a.createdAt) - Date.parse(b.createdAt));
		}
	});
}

/**
 * A row for a file the viewer has chosen but which has not moved yet.
 *
 * Every field is honest about that: `status: "pending_upload"` is the lifecycle state the files domain
 * already has for exactly this, `url` is that domain's documented stub value (`"#"` — a placeholder,
 * NOT a link, which is why {@link EventAttachmentsTab}'s open handler refuses it rather than spawning
 * a blank tab over it), and the size is the real one the browser reported. Nothing here claims the
 * bytes have gone anywhere.
 */
function stagedAsset(event: CalendarEvent, index: number, file: File): AssetItem {
	const dot = file.name.lastIndexOf(".");
	const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
	const kb = file.size / 1024;
	return {
		id: `${event.id}-staged-${index}`,
		kind: "file",
		category: "Other",
		name: file.name,
		ext,
		url: "#",
		thumbnailUrl: null,
		sizeBytes: file.size,
		sizeLabel: kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`,
		width: null,
		height: null,
		durationLabel: null,
		channelId: null,
		channelName: null,
		channelKind: null,
		messageId: null,
		messageText: null,
		messageAudioUrl: null,
		sender: null,
		createdAt: new Date(file.lastModified).toISOString(),
		timeLabel: "—",
		dayLabel: "Not uploaded",
		dateLabel: "Not uploaded",
		starred: false,
		source: "supabase",
		status: "pending_upload",
		visibility: "link",
		ownerType: "user",
		ownerId: event.organiser?.handle ?? "host",
		folderId: null,
		folderPath: [],
		contentHash: null,
		hashSampled: false,
		external: null,
		link: null,
		shareSlug: null,
		downloadCount: 0,
		downloadedByViewer: false,
		canManage: true,
	};
}

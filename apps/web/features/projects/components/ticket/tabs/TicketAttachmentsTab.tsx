import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import type {
	BoardCard,
	FileItem,
	FileSortDir,
	FileSortKey,
} from "../../../types/projects-types.ts";
import { filesZoom, gridColWidth, viewMode, zoom } from "../../../core/view-state.ts";
import { FileCard } from "../../FileCard.tsx";
import { FileTable } from "../../FileTable.tsx";
import { GridIcon, ListIcon } from "../../file-glyphs.tsx";

/**
 * TicketAttachmentsTab — the reference material the CLIENT hung on the ticket, read the way
 * `/projects/[id]/files` reads.
 *
 * It mounts the SAME {@link FileCard} grid and {@link FileTable} list the File Explorer does, and
 * shares the SAME zoom store — so the density a viewer chose on `/files` is the density they get
 * here, `Ctrl`+wheel works identically, and crossing the centre marker transitions list ⇄ grid with
 * no second toggle competing with it. A ticket's attachments ARE the project's attachments; a second
 * renderer is how the two stop agreeing.
 *
 * What it does not share is the virtualization. The explorer windows an unbounded corpus against the
 * page scroller; this tab lives inside a modal whose scroller is the modal body, and a
 * window-virtualized list inside a dialog measures the wrong box. A ticket's attachments are a
 * bounded handful, so they all render.
 *
 * The upload asymmetry is a product rule, not a permissions oversight. A client attaches briefs,
 * references and source files directly, because those are INPUTS to the work. A freelancer's files
 * are OUTPUTS, and outputs go through Submissions so they are versioned, reviewable and tied to the
 * escrow release — an upload here would be a delivery with no review attached to it. So a provider
 * seat gets the grid and the downloads and no drop zone, and is told where its own uploads belong
 * rather than left to wonder.
 */
/**
 * The Asset Picker routing key.
 *
 * A module constant rather than a per-instance id, because exactly one ticket modal is open at a
 * time — the modal STACK replaces a frame rather than covering it (Decision #65), so two attachment
 * tabs cannot be mounted at once and there is nothing for a second key to disambiguate.
 */
const PICKER_ID = "ticket-attachments";

export interface TicketAttachmentsTabProps {
	card: BoardCard;
	/** Whether the viewer may attach files here (client side). */
	canUpload: boolean;
	onPatch: (patch: Partial<BoardCard>) => void;
}

export function TicketAttachmentsTab(props: TicketAttachmentsTabProps): JSX.Element {
	const { card, canUpload } = props;
	const workspaceRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	useCtrlWheelZoom(workspaceRef, filesZoom);

	// The list presentation sorts in place — there is no server page to re-request for a set this
	// small, so the sort is applied to what is already here.
	const sortKey = useSignal<string>("date");
	const sortDir = useSignal<FileSortDir>("desc");

	const items = sortFiles(card.attachments, sortKey.value as FileSortKey, sortDir.value);

	/**
	 * Staged by NAME only, matching every other write on this surface. Real upload lands with
	 * `PROJECTS_BACKEND_LIVE`; a progress bar over a file that is going nowhere would be worse than an
	 * honest count.
	 */
	function stage(files: FileList | null): void {
		const names = Array.from(files ?? []).map((f) => f.name);
		if (names.length === 0) return;
		props.onPatch({ attachmentCount: card.attachmentCount + names.length });
	}

	/**
	 * Attach reference material the client already has, from the Asset Picker.
	 *
	 * Counted the same way a device upload is, because at this stage of the board both are the same
	 * kind of claim — a count that is honest about how many things were added and does not pretend the
	 * bytes have gone anywhere. The library path will diverge when the backend lands: a pick is a
	 * LINK to an existing asset and never a second copy, so it costs the client no additional storage.
	 */
	function stageAssets(assets: AssetItem[]): void {
		if (assets.length === 0) return;
		props.onPatch({ attachmentCount: card.attachmentCount + assets.length });
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
		<div class="tkv-files">
			{
				/* The bar mirrors the Submissions tab exactly: what you are looking at on the left, how
			    you are looking at it and what you can add on the right. */
			}
			<div class="tkv-subs__bar">
				<div class="tkv-subs__trail">
					<h3 class="tkv-h tkv-h--bar">
						Attached by the client
						{card.attachments.length > 0
							? <span class="tkv-h__count">{card.attachments.length}</span>
							: null}
					</h3>
				</div>
				<ViewZoomRig
					store={filesZoom}
					label="Attachment view zoom"
					listIcon={<ListIcon size={16} />}
					gridIcon={<GridIcon size={16} />}
					class="tkv-subs__zoom"
				/>
				{canUpload
					? (
						<>
							<button
								type="button"
								class="tkv-addfile"
								onClick={() =>
									openPicker({
										requesterId: PICKER_ID,
										title: "Attach from your files",
										multiple: true,
									})}
							>
								<Icon name="folder" size="xs" />
								From library
							</button>
							<button
								type="button"
								class="tkv-addfile"
								onClick={() => inputRef.current?.click()}
							>
								<Icon name="upload" size="xs" />
								Add attachment
							</button>
							<input
								ref={inputRef}
								type="file"
								multiple
								class="tkv-sr"
								aria-label="Attach reference files"
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

			<div class="tkv-subs__work" ref={workspaceRef}>
				{card.attachments.length === 0
					? (
						<div class="fx-empty" role="status">
							<p class="fx-empty__title">Nothing attached yet</p>
							<p class="fx-empty__note">
								{canUpload
									? "Add the briefs, references and source files this ticket works from."
									: "The client has not attached any reference material to this ticket."}
							</p>
						</div>
					)
					: viewMode.value === "grid"
					? (
						<div class="tkv-subs__grid" style={`--tkv-col:${gridColWidth(zoom.value)}px`}>
							{items.map((f) => (
								<FileCard
									key={f.id}
									file={f}
									onOpen={() => globalThis.open(f.url, "_blank")}
								/>
							))}
						</div>
					)
					: (
						<FileTable
							items={items}
							sortKey={sortKey}
							sortDir={sortDir}
							onSort={applySort}
							onOpen={(f) => globalThis.open(f.url, "_blank")}
							virtualize={false}
						/>
					)}
			</div>

			{!canUpload
				? (
					<p class="tkv-note">
						<Icon name="info" size="2xs" />
						Deliverables go through Submissions, where they are versioned and reviewed.
					</p>
				)
				: null}

			{
				/* Mounted unconditionally, and NOT behind `canUpload`: an island is only in the page's
			    island graph once it renders, and that graph is what carries its stylesheet — a picker
			    that appeared with the first client seat would paint its first frame unstyled. It draws
			    nothing until it is opened, and only a client seat has a control that opens it. */
			}
			<AssetPicker requesterId={PICKER_ID} onPick={stageAssets} />
		</div>
	);
}

/** Sort in place over a bounded set. An empty key is the third state — the order they arrived in. */
function sortFiles(files: FileItem[], key: FileSortKey | "", dir: FileSortDir): FileItem[] {
	if (!key) return files;
	const sign = dir === "asc" ? 1 : -1;
	return [...files].sort((a, b) => {
		switch (key) {
			case "name":
				return sign * a.name.localeCompare(b.name);
			case "size":
				return sign * (a.sizeBytes - b.sizeBytes);
			case "sender":
				return sign * a.sender.name.localeCompare(b.sender.name);
			default:
				return sign * (Date.parse(a.createdAt) - Date.parse(b.createdAt));
		}
	});
}

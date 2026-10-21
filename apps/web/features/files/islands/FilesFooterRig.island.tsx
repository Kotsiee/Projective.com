import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/files-chrome.css";
import { Dialog, Tooltip } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { filesZoom } from "@web/features/projects/core/view-state.ts";
import UploadDrawer from "./UploadDrawer.island.tsx";
import { ConnectDriveDialog } from "../components/ConnectDriveDialog.tsx";
import { FilesService } from "../core/FilesService.ts";
import { openUploadDrawer, uploadDrawerOpen } from "../core/upload-drawer-state.ts";
import {
	commitFiles,
	enqueueUploads,
	folderId,
	items,
	readOnly,
	uploadQueue,
	uploadsActive,
} from "../core/files-state.ts";
import { type AssetOwnerType, type FileScope, sourceLabel } from "../types/file-types.ts";
import { uploadTasksOf } from "../core/upload-tasks.ts";

/**
 * FilesFooterRig — the sticky action bar, and the only place on `/files` a file enters the library
 * from the chrome (the body's empty state and its drop target are the other two doors).
 *
 * ## Drawn like the catalogue workspace rig (Decision #311)
 *
 * The density control and the upload queue's status sit at the start; the actions sit at the end:
 * the secondaries — New folder · Attach link · Connect drive · Export — as neutral outlined circles,
 * each with a portal `Tooltip` and an `aria-label`, then **Upload**, the region's one filled action,
 * last in the inline direction (§B.8.2 / §B.8.6). There is no overflow menu: every action stays on
 * the bar at every width, and the narrowest container tier folds Upload's label into its Tooltip
 * rather than removing anything.
 *
 * `container-type: inline-size` on the root still stops the band bidding for the lane's space (the
 * `/wallet` 739px min-content defect) and makes that tier switch a container query.
 *
 * ## The action layer mounts HERE
 *
 * The trigger owns the layer, so every `/files` route gets the same dialogs. That includes the
 * {@link UploadDrawer}, mounted UNCONDITIONALLY: a conditionally-rendered island is absent from the
 * page's island graph until its condition flips, and that graph is what carries component CSS.
 *
 * ## Two gates, told apart on purpose
 *
 * A **read-only LOCATION** (a mounted channel, a connected drive) withholds Upload, New folder and
 * Attach link by ABSENCE. `Connect drive` survives: it is an account-level action, not a write into the
 * place being viewed. Export and density survive because reading is never gated.
 *
 * Dumb island: everything goes through the thin `FilesService` / `/api/*`; no database, no fixtures.
 */

// #region Props
export interface FilesFooterRigProps {
	/** The route base every deep link in this scope hangs off. */
	base: string;
	scope: FileScope;
	subjectId: string | null;
	/** The folder path within the scope; `[]` is the scope root. */
	segments: string[];
	ownerType: AssetOwnerType;
	ownerId: string;
	/**
	 * Whether Connect drive is offered (default `true`). A connection belongs to the person's acting
	 * context, so a team's or business's drive withholds it.
	 */
	connectDrive?: boolean;
	/**
	 * Why the whole library takes nothing new, when the host knows it does not (an archived entity's
	 * drive). Set, it withholds every write action as a read-only location does and is the rig's note.
	 */
	lockedNote?: string | null;
}

type SecondaryAction = "new_folder" | "attach_link" | "connect_drive" | "export";

interface ActionSpec {
	key: SecondaryAction;
	label: string;
	icon: IconName;
	/** Withheld at a read-only location — see the module note on the two gates. */
	writes: boolean;
}
// #endregion

// #region Action model
const SECONDARY: readonly ActionSpec[] = [
	{ key: "new_folder", label: "New folder", icon: "folder", writes: true },
	{ key: "attach_link", label: "Attach link", icon: "link", writes: true },
	// `box` is the glyph the tree's `NodeMark` gives a connected drive: the action and its result match.
	{ key: "connect_drive", label: "Connect drive", icon: "box", writes: false },
	{ key: "export", label: "Export list", icon: "download", writes: false },
];

/** Escape one CSV cell — quote it and double any embedded quote, per RFC 4180. */
function csvCell(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}
// #endregion

interface RigIconProps {
	spec: ActionSpec;
	disabled?: boolean;
	onClick: () => void;
}

function RigIcon({ spec, disabled, onClick }: RigIconProps): JSX.Element {
	return (
		<Tooltip content={spec.label} placement="top">
			<Button
				rounded
				iconOnly
				size="sm"
				severity="neutral"
				variant="outlined"
				class="fh-rig__icon ui-hit"
				aria-label={spec.label}
				icon={<Icon name={spec.icon} size="sm" />}
				disabled={disabled}
				onClick={onClick}
			/>
		</Tooltip>
	);
}

export default function FilesFooterRig(props: FilesFooterRigProps): JSX.Element {
	const fileInput = useRef<HTMLInputElement>(null);

	const folderOpen = useSignal(false);
	const folderName = useSignal("");
	const linkOpen = useSignal(false);
	const linkUrl = useSignal("");
	const driveOpen = useSignal(false);
	/** The last write's outcome, shown inside the dialog that produced it. Never swallowed. */
	const notice = useSignal<string | null>(null);
	const busy = useSignal(false);

	useEffect(() => filesZoom.restoreZoom(), []);

	const connectDrive = props.connectDrive ?? true;
	const lockedNote = props.lockedNote ?? null;
	const locked = readOnly.value || lockedNote !== null;
	const secondaries = SECONDARY.filter((a) =>
		(locked ? !a.writes : true) && (connectDrive || a.key !== "connect_drive")
	);

	/**
	 * The queue affordance's label, or `null` when there is no queue to describe. Keyed on the WHOLE
	 * queue rather than on `uploadsActive`: a failed upload is not active, and gating on activity
	 * would take the affordance away at the moment the last file of a drop failed — and with it the
	 * only route back to the reason.
	 */
	const queueLabel = useComputed<string | null>(() => {
		const rows = uploadQueue.value;
		if (rows.length === 0) return null;
		const active = uploadsActive.value.length;
		if (active > 0) return `${active} uploading`;
		const failed = rows.filter((t) => t.phase === "error" || t.phase === "blocked").length;
		if (failed > 0) {
			return failed === 1 ? "1 file did not upload" : `${failed} files did not upload`;
		}
		const done = rows.filter((t) => t.phase === "done").length;
		if (done === 0) return "Upload queue";
		return done === 1 ? "1 file uploaded" : `${done} files uploaded`;
	});

	// #region Actions
	/**
	 * Enqueue the picked files for the pipeline that owns hashing, dedup and the upload handshake. The
	 * rig stops at the QUEUE (`files-state.uploadQueue`, the shared contract): a second implementation of
	 * the handshake in the action bar is how the two would drift.
	 */
	function onFilesPicked(list: FileList | null): void {
		if (!list || list.length === 0) return;
		enqueueUploads(uploadTasksOf(Array.from(list), folderId.value));
	}

	async function createFolder(): Promise<void> {
		const name = folderName.value.trim();
		if (!name || busy.value) return;
		busy.value = true;
		const res = await FilesService.createFolder({
			name,
			parentId: folderId.value,
			ownerType: props.ownerType,
			ownerId: props.ownerId,
		});
		busy.value = false;
		if (res.ok) {
			folderName.value = "";
			folderOpen.value = false;
			notice.value = null;
			commitFiles();
		} else {
			// Closing a dialog on a failure reads as success. It stays open, carrying the reason.
			notice.value = res.message ?? "That folder could not be created.";
		}
	}

	async function attachLink(): Promise<void> {
		const url = linkUrl.value.trim();
		if (!url || busy.value) return;
		busy.value = true;
		const res = await FilesService.attachLink({
			url,
			folderId: folderId.value,
			ownerType: props.ownerType,
			ownerId: props.ownerId,
		});
		busy.value = false;
		if (res.ok) {
			linkUrl.value = "";
			linkOpen.value = false;
			notice.value = null;
			commitFiles();
		} else {
			notice.value = res.message ?? "That link could not be attached.";
		}
	}

	/**
	 * Export what is LOADED, and say so. There is no export endpoint; a client-side CSV of the rows in
	 * view is honest and complete for what it claims, and the label names the scope ("Export list").
	 */
	function exportCsv(): void {
		const rows = items.value;
		if (rows.length === 0) return;
		const header = ["Name", "Kind", "Size", "Added", "Where it lives", "Added by"];
		const body = rows.map((it) =>
			[
				csvCell(it.name),
				csvCell(it.kind),
				csvCell(it.sizeLabel),
				csvCell(it.dateLabel),
				csvCell(sourceLabel(it.source)),
				csvCell(it.sender?.name ?? ""),
			].join(",")
		);
		const csv = [header.map(csvCell).join(","), ...body].join("\r\n");
		const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = `files-${props.segments.at(-1) ?? "library"}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function activate(action: SecondaryAction): void {
		notice.value = null;
		switch (action) {
			case "new_folder":
				folderOpen.value = true;
				return;
			case "attach_link":
				linkOpen.value = true;
				return;
			case "connect_drive":
				driveOpen.value = true;
				return;
			case "export":
				exportCsv();
				return;
		}
	}
	// #endregion

	return (
		<div class="fh-rig" data-readonly={locked ? "true" : undefined}>
			<div class="fh-rig__status">
				<ViewZoomRig
					store={filesZoom}
					label="File view zoom"
					class="fh-rig__density"
					listIcon={<Icon name="list" />}
					gridIcon={<Icon name="grid" />}
				/>

				{locked && (
					<span class="fh-rig__note">
						{lockedNote ?? "Read-only here — this location is mounted, not stored in your library."}
					</span>
				)}

				{
					/*
					 * The way back into the queue: while it runs, the only path to cancelling a transfer;
					 * once it stops, the only path to what went wrong. No live-region role — `role="status"`
					 * on a button REPLACES the button role. The open flag is read from the shared module,
					 * because a `Signal` prop does not survive the island boundary as the same instance.
					 */
				}
				{queueLabel.value !== null && (
					<button
						type="button"
						class="fh-rig__uploads"
						aria-haspopup="dialog"
						aria-expanded={uploadDrawerOpen.value ? "true" : "false"}
						onClick={openUploadDrawer}
					>
						{queueLabel.value}
					</button>
				)}
			</div>

			<div class="fh-rig__actions">
				{secondaries.map((spec) => (
					<RigIcon
						key={spec.key}
						spec={spec}
						disabled={spec.key === "export" && items.value.length === 0}
						onClick={() => activate(spec.key)}
					/>
				))}
				{!locked && (
					<Tooltip content="Upload files" placement="top">
						<Button
							size="sm"
							label="Upload"
							icon={<Icon name="upload" size="sm" />}
							class="fh-rig__upload"
							onClick={() => fileInput.current?.click()}
						/>
					</Tooltip>
				)}
			</div>

			<input
				ref={fileInput}
				class="ui-visually-hidden"
				type="file"
				multiple
				tabIndex={-1}
				aria-hidden="true"
				onChange={(e) => {
					const el = e.currentTarget;
					onFilesPicked(el.files);
					// Reset, or picking the same file twice in a row fires no change event at all.
					el.value = "";
				}}
			/>

			<Dialog
				visible={folderOpen}
				header="New folder"
				width="26rem"
				footer={
					<div class="fh-rig__dialogfoot">
						<Button variant="text" label="Cancel" onClick={() => (folderOpen.value = false)} />
						<Button
							label="Create folder"
							loading={busy.value}
							disabled={busy.value || folderName.value.trim().length === 0}
							onClick={() => void createFolder()}
						/>
					</div>
				}
			>
				{
					/*
					 * The visible label is ASSOCIATED by id, not replaced by an `aria-label`, so the name a
					 * screen-reader user hears matches the words a speech-control user says (WCAG 2.5.3).
					 */
				}
				<label class="fh-rig__fieldlabel" for="fh-folder-name">Folder name</label>
				<InputText
					id="fh-folder-name"
					value={folderName.value}
					placeholder="Brand assets"
					block
					onValueChange={(v) => (folderName.value = v)}
				/>
				{notice.value && <p class="fh-rig__error" role="status">{notice.value}</p>}
			</Dialog>

			<Dialog
				visible={linkOpen}
				header="Attach a link"
				width="28rem"
				footer={
					<div class="fh-rig__dialogfoot">
						<Button variant="text" label="Cancel" onClick={() => (linkOpen.value = false)} />
						<Button
							label="Attach link"
							loading={busy.value}
							disabled={busy.value || linkUrl.value.trim().length === 0}
							onClick={() => void attachLink()}
						/>
					</div>
				}
			>
				<label class="fh-rig__fieldlabel" for="fh-link-url">Link address</label>
				<InputText
					id="fh-link-url"
					value={linkUrl.value}
					type="url"
					placeholder="https://…"
					block
					onValueChange={(v) => (linkUrl.value = v)}
				/>
				<p class="fh-rig__hint">
					A link is stored as a file in its own right, so you can find it beside everything else.
					Only <code>https://</code> addresses can be attached.
				</p>
				{notice.value && <p class="fh-rig__error" role="status">{notice.value}</p>}
			</Dialog>

			{connectDrive && <ConnectDriveDialog visible={driveOpen} returnTo={props.base} />}

			<UploadDrawer ownerType={props.ownerType} ownerId={props.ownerId} />
		</div>
	);
}

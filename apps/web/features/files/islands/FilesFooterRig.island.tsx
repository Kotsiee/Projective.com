import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/files-chrome.css";
import { Dialog, Popover, Tooltip } from "@projective/ui/feedback";
import { InputText } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { filesZoom } from "@web/features/projects/core/view-state.ts";
import { SourceMark } from "../components/file-hub-glyphs.tsx";
import UploadDrawer from "./UploadDrawer.island.tsx";
import { FilesService } from "../core/FilesService.ts";
import { postFiles } from "../core/api.ts";
import { simFromSeam } from "../core/files-seam.ts";
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
import {
	type AssetOwnerType,
	type AssetSource,
	type FileScope,
	formatMib,
	MIB,
	sourceLabel,
	type UploadTask,
} from "../types/file-types.ts";

/**
 * FilesFooterRig — the sticky action bar, and the only place on `/files` anything enters the library.
 *
 * ## Adaptation is by CONTAINER WIDTH, and no action is ever lost to it
 *
 * `container-type: inline-size` on the rig root is load-bearing twice over, and both reasons are
 * failures this codebase has already shipped:
 *
 *  1. **It stops the band bidding for the lane's space.** The middle-nav content column is a `1fr`
 *     grid track whose automatic minimum is `auto`, so one `nowrap` row of labelled buttons exports
 *     its full min-content to the whole frame — on `/wallet` that was 739px, which starved the nav
 *     lane to 2px at an 820px viewport and overflowed the frame's `clip` at 768px. Inline-size
 *     containment makes this band's width a function of the band, never of its contents.
 *  2. **It makes the tier switch a container query** keyed on the band's real width, so the collapse
 *     is deterministic CSS rather than a client width observer — the same "render both, reveal one"
 *     technique the collapsed rail uses.
 *
 * The three tiers are glyph + label · glyph only (§B.6.3's icon-only sticky footer, the name relocated
 * to the `Tooltip` every control already carries) · one menu. **The menu holds every action at every
 * tier**, so no width can remove a path to getting a file in — which is exactly what `/wallet`'s old
 * `nth-child(n + 3) { display: none }` mobile rule did on four pages that had no menu to recover from.
 *
 * ## The action layer mounts HERE
 *
 * Not in a body screen. `/wallet` learned this the hard way: its layer lived in one of eight route
 * bodies while the rig that opens it renders on all eight, so seven routes had actions that opened
 * nothing. The trigger owns the layer.
 *
 * That includes the {@link UploadDrawer}, which is mounted UNCONDITIONALLY rather than while the
 * queue is non-empty. A conditionally-rendered island is absent from the page's island graph until
 * its condition flips, and that graph is what carries component CSS — a drawer mounted only once a
 * file was picked would paint its first frame unstyled. It renders nothing while closed.
 *
 * ## Two gates, told apart on purpose
 *
 * A **read-only LOCATION** (a mounted channel, a connected drive — `AssetListPage.readOnly`) withholds
 * Upload, New folder and Attach link by ABSENCE, because the surface is not a second write path into
 * someone else's system of record and offering a target it will refuse teaches nothing. `Connect
 * drive` survives: it is an account-level action that happens to be reachable from here, not a write
 * into the place being viewed. Export and density survive because reading is never gated.
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
}

/** Everything the rig can do. The order is the reading order of the inline cluster and the menu. */
type RigAction = "upload" | "new_folder" | "attach_link" | "connect_drive" | "export";

interface ActionSpec {
	key: RigAction;
	label: string;
	icon: IconName;
	/** Withheld at a read-only location — see the module note on the two gates. */
	writes: boolean;
}
// #endregion

// #region Action model
const ACTIONS: readonly ActionSpec[] = [
	{ key: "upload", label: "Upload", icon: "upload", writes: true },
	{ key: "new_folder", label: "New folder", icon: "folder", writes: true },
	{ key: "attach_link", label: "Attach link", icon: "link", writes: true },
	// `box` is the SAME glyph the tree's `NodeMark` gives a connected drive, so the action and the
	// thing it produces are one vocabulary rather than two.
	{ key: "connect_drive", label: "Connect drive", icon: "box", writes: false },
	{ key: "export", label: "Export", icon: "download", writes: false },
];

/** The storage connectors a drive can be mounted from, in the order the tree lists them. */
const DRIVE_PROVIDERS: readonly { slug: string; source: AssetSource }[] = [
	{ slug: "google_drive", source: "google_drive" },
	{ slug: "dropbox", source: "dropbox" },
	{ slug: "frameio", source: "frameio" },
	{ slug: "s3", source: "s3" },
];

/** A client-minted queue key. `randomUUID` needs a secure context, so there is a plain fallback. */
function queueKey(): string {
	try {
		return globalThis.crypto?.randomUUID?.() ?? `q-${Date.now()}-${Math.random().toString(36)}`;
	} catch {
		return `q-${Date.now()}-${Math.random().toString(36)}`;
	}
}

/** Escape one CSV cell — quote it and double any embedded quote, per RFC 4180. */
function csvCell(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}
// #endregion

export default function FilesFooterRig(props: FilesFooterRigProps): JSX.Element {
	const menuOpen = useSignal(false);
	const menuRef = useRef<HTMLButtonElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	const folderOpen = useSignal(false);
	const folderName = useSignal("");
	const linkOpen = useSignal(false);
	const linkUrl = useSignal("");
	const driveOpen = useSignal(false);
	/** The last action's outcome, shown inside the dialog that produced it. Never swallowed. */
	const notice = useSignal<string | null>(null);
	const busy = useSignal(false);

	useEffect(() => filesZoom.restoreZoom(), []);

	const available = useComputed(() => ACTIONS.filter((a) => (readOnly.value ? !a.writes : true)));

	/**
	 * The queue affordance's label, or `null` when there is no queue to describe.
	 *
	 * Keyed on the WHOLE queue rather than on `uploadsActive`, because a failed upload is not active:
	 * gating on activity alone would take the affordance away at the exact moment the last file of a
	 * drop failed, and with it the only route back to the reason. The queue empties when the person
	 * clears it, not when it stops moving.
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
	 * Enqueue a drop for the pipeline that owns hashing, dedup and the upload handshake.
	 *
	 * The rig deliberately stops at the QUEUE: `files-state.uploadQueue` is the shared contract, and a
	 * second implementation of the three-step handshake living in the action bar is how the two would
	 * drift. Every task lands in `queued` with its own client-minted key, because a task exists from
	 * the moment a file is picked — before the server has minted anything to key it on.
	 */
	function onFilesPicked(list: FileList | null): void {
		if (!list || list.length === 0) return;
		const tasks: UploadTask[] = Array.from(list).map((file) => ({
			id: queueKey(),
			file,
			name: file.name,
			sizeBytes: file.size,
			sizeLabel: formatMib(file.size / MIB),
			mimeType: file.type || "application/octet-stream",
			folderId: folderId.value,
			phase: "queued",
			progress: 0,
			fingerprint: null,
			verdict: null,
			resolution: null,
			assetId: null,
			ticket: null,
			error: null,
		}));
		enqueueUploads(tasks);
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
		}, simFromSeam());
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
	 * Begin an OAuth consent for a storage connector.
	 *
	 * This is a SEPARATE grant from signing in with Google (`features/auth/`): GoTrue's sign-in retains
	 * no third-party API token, so a person who signed in with Google has granted the platform no
	 * access to their Drive. `returnTo` is a same-origin PATH and is validated server-side — an
	 * attacker-chosen return URL would turn a consent screen into an open redirect wearing this
	 * domain's credibility.
	 */
	async function connect(slug: string): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		const res = await postFiles<{ state: string; authorizeUrl: string; expiresAt: string }>(
			"/api/integrations/start",
			{ providerSlug: slug, returnTo: props.base },
		);
		busy.value = false;
		if (res.ok && res.data?.authorizeUrl) {
			globalThis.location.assign(res.data.authorizeUrl);
		} else {
			notice.value = res.message ?? "That drive could not be connected right now.";
		}
	}

	/**
	 * Export what is LOADED, and say so.
	 *
	 * There is no `/api/files/export` endpoint, and inventing a link to one would ship a control that
	 * 404s. A client-side CSV of the rows currently in view is honest, complete for what it claims, and
	 * needs no server work; the label names the scope so nobody mistakes it for a whole-library dump.
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
		try {
			const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
			const a = document.createElement("a");
			a.href = url;
			a.download = `files-${props.segments.at(-1) ?? "library"}.csv`;
			a.click();
			URL.revokeObjectURL(url);
		} catch { /* no DOM / blocked download — non-fatal */ }
	}

	function activate(action: RigAction): void {
		menuOpen.value = false;
		notice.value = null;
		switch (action) {
			case "upload":
				fileInput.current?.click();
				return;
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

	// #region Controls
	/**
	 * `primary` is granted to **Upload specifically**, not to whatever happens to lead the row.
	 *
	 * Position is the wrong rule here: at a read-only mount the writing actions are absent, so the first
	 * inline control becomes `Connect drive` — and dressing an account-level setup step as the page's
	 * primary action tells a reader that connecting a drive is what this screen is for. The menu is its
	 * own decision region and lists everything at one weight; a filled row inside a list of five reads
	 * as a recommendation the surface has no business making.
	 */
	function button(spec: ActionSpec, _index: number, inMenu: boolean): JSX.Element {
		const disabled = spec.key === "export" && items.value.length === 0;
		const control = (
			<button
				type="button"
				class="fh-rig__action"
				data-variant={spec.key === "upload" && !inMenu ? "primary" : "tonal"}
				disabled={disabled}
				aria-label={spec.label}
				role={inMenu ? "menuitem" : undefined}
				onClick={() => activate(spec.key)}
			>
				<span class="fh-rig__glyph" aria-hidden="true">
					<Icon name={spec.icon} />
				</span>
				<span class="fh-rig__label">{spec.label}</span>
			</button>
		);
		// In the menu the label is always visible, so a tooltip would only repeat it.
		if (inMenu) return <span key={spec.key}>{control}</span>;
		return <Tooltip key={spec.key} content={spec.label} placement="top">{control}</Tooltip>;
	}
	// #endregion

	return (
		<div class="fh-rig" data-readonly={readOnly.value ? "true" : undefined}>
			{
				/*
				 * The density control. One continuous zoom drives list ⇄ grid AND the density within each,
				 * so there is deliberately no view toggle beside it — the SAME store the projects File
				 * Explorer uses, because a person who set their file density in one place has set it.
				 */
			}
			<ViewZoomRig
				store={filesZoom}
				label="File view zoom"
				class="fh-rig__density"
				listIcon={<Icon name="list" />}
				gridIcon={<Icon name="grid" />}
			/>

			<div class="fh-rig__actions">
				{available.value.map((spec, i) => button(spec, i, false))}
			</div>

			{readOnly.value && (
				<span class="fh-rig__note">
					Read-only here — this location is mounted, not stored in your library.
				</span>
			)}

			{
				/*
				 * The way back into the queue. A real button rather than a status line: while it is
				 * running it is the only path to cancelling a transfer, and once it has stopped it is the
				 * only path to what went wrong. It carries no live-region role — `role="status"` on a
				 * button REPLACES the button role, so the control would announce as a status and stop
				 * reading as something you can press. The queue announces its own progress from inside
				 * the drawer, which opens itself the moment work starts.
				 *
				 * The open flag is read from the shared module, not from a signal handed to the drawer:
				 * a `Signal` prop does not survive the island boundary as the same instance, so this
				 * button reported `aria-expanded="false"` over a drawer that was open.
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

			<Tooltip content="All file actions" placement="top">
				<button
					type="button"
					class="fh-rig__more"
					ref={menuRef}
					aria-label="All file actions"
					aria-haspopup="menu"
					aria-expanded={menuOpen.value ? "true" : "false"}
					onClick={() => {
						menuOpen.value = !menuOpen.value;
					}}
				>
					<span class="fh-rig__glyph" aria-hidden="true">
						<Icon name="kebab-horizontal" />
					</span>
					<span class="fh-rig__more-label">Actions</span>
				</button>
			</Tooltip>
			<Popover open={menuOpen} targetRef={menuRef} placement="top-end">
				<div class="fh-rig__menu" role="menu">
					{available.value.map((spec, i) => button(spec, i, true))}
				</div>
			</Popover>

			{
				/*
				 * The action layer. Mounted beside the controls that open it, so every `/files` route gets
				 * the same dialogs rather than only the one route that happened to host them.
				 */
			}
			<input
				ref={fileInput}
				class="fh-rig__file"
				type="file"
				multiple
				tabIndex={-1}
				aria-hidden="true"
				onChange={(e) => {
					const el = e.currentTarget as HTMLInputElement;
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
						<button
							type="button"
							class="fh-rig__action"
							data-variant="tonal"
							onClick={() => (folderOpen.value = false)}
						>
							<span class="fh-rig__label">Cancel</span>
						</button>
						<button
							type="button"
							class="fh-rig__action"
							data-variant="primary"
							disabled={busy.value || folderName.value.trim().length === 0}
							onClick={() => void createFolder()}
						>
							<span class="fh-rig__label">Create folder</span>
						</button>
					</div>
				}
			>
				{
					/*
					 * The visible label is ASSOCIATED by id, not replaced by an `aria-label`. An
					 * `aria-label` on a control that already has visible text overrides that text for
					 * assistive technology, so the name a screen-reader user hears stops matching the
					 * words a speech-control user has to say (WCAG 2.5.3 — the defect Decision #62 fixed
					 * in the catalogue modal).
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
						<button
							type="button"
							class="fh-rig__action"
							data-variant="tonal"
							onClick={() => (linkOpen.value = false)}
						>
							<span class="fh-rig__label">Cancel</span>
						</button>
						<button
							type="button"
							class="fh-rig__action"
							data-variant="primary"
							disabled={busy.value || linkUrl.value.trim().length === 0}
							onClick={() => void attachLink()}
						>
							<span class="fh-rig__label">Attach link</span>
						</button>
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

			<Dialog visible={driveOpen} header="Connect a drive" width="28rem">
				<p class="fh-rig__hint">
					Connecting is a separate permission from signing in — signing in with Google grants no
					access to your Drive. A connected drive is browsable here and stays read-only.
				</p>
				<div class="fh-rig__providers">
					{DRIVE_PROVIDERS.map((p) => (
						<button
							key={p.slug}
							type="button"
							class="fh-rig__provider"
							disabled={busy.value}
							onClick={() => void connect(p.slug)}
						>
							<span class="fh-rig__provider-mark" aria-hidden="true">
								<SourceMark source={p.source} size={20} />
							</span>
							<span class="fh-rig__provider-label">{sourceLabel(p.source)}</span>
							<Icon name="chevron-right" class="fh-rig__provider-caret" />
						</button>
					))}
				</div>
				{notice.value && <p class="fh-rig__error" role="status">{notice.value}</p>}
			</Dialog>

			{
				/*
				 * The upload pipeline: fingerprint → duplicate check → init/PUT/complete, plus the queue
				 * that reports on it. Mounted always (see the module note on the island graph and CSS); it
				 * opens itself when the queue gains work, and stays reachable from the affordance above
				 * once the person has closed it.
				 */
			}
			<UploadDrawer ownerType={props.ownerType} ownerId={props.ownerId} />
		</div>
	);
}

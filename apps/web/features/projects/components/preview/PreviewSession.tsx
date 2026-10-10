import type { JSX, RefObject } from "preact";
import { effect } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { useId, useIsMobile } from "@projective/ui/hooks";
import {
	createModalStack,
	type ModalStack,
	useFrameScroll,
	useFrameState,
} from "@projective/ui/overlay";
import type { InspectAsset } from "@projective/types/files";
import { InspectorSheet, useInspectorHost } from "@features/inspector/components/embed/mod.ts";
import { FilesService } from "@features/files/core/FilesService.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import type { AssetItem } from "../../types/projects-types.ts";
import {
	canRenameFile,
	clampPage,
	type GoToMessageMode,
	goToMessageMode,
	pickSource,
	previewAssetId,
	type PreviewContext,
	previewDownloadHref,
	previewIconName,
	previewInspectHref,
	previewMetaLine,
	previewShareOf,
	previewShortcuts,
	resolvePreviewContext,
	sourceFromFile,
	sourceLookup,
	type SourcePaint,
	stepPage,
} from "./preview-model.ts";
import { useAttachmentSources, useInspectAsset } from "./use-preview-data.ts";
import { PreviewHeader } from "./PreviewHeader.tsx";
import { PreviewStage } from "./PreviewStage.tsx";
import { PreviewAside, type PreviewNotesState } from "./PreviewAside.tsx";
import { PreviewTray } from "./PreviewTray.tsx";

/** The modal-stack frame a preview renders as, when it is one. */
export interface PreviewFrame {
	stack: ModalStack<string, unknown>;
	uid: number;
}

/** Props for {@link PreviewSession}. */
export interface PreviewSessionProps {
	files: AssetItem[];
	startIndex: number;
	viewerId: string;
	projectId: string;
	notesMode: boolean;
	onClose: () => void;
	onRename: (fileId: string, name: string) => void;
	onToggleStar: (fileId: string) => void;
	onSaveNote?: (fileId: string, text: string) => void;
	frame?: PreviewFrame;
	context?: PreviewContext;
	onGoToMessage?: (messageId: string) => void;
	/** The id the header's title carries; the dialog is labelled by it. */
	titleId: string;
	/** The canvas region focus enters. */
	stageRef: RefObject<HTMLDivElement>;
}

const IDLE_ASSET: InspectAsset = {
	id: "",
	name: "",
	ext: "",
	mimeType: "",
	category: "Other",
	categoryLabel: "",
	kind: "file",
	viewer: "unsupported",
	language: null,
	modelFormat: null,
	delimiter: null,
	sizeBytes: 0,
	sizeLabel: "",
	width: null,
	height: null,
	durationMs: null,
	durationLabel: null,
	pageCount: null,
	peaks: null,
	blurhash: null,
	createdAt: "",
	dateLabel: "",
	owner: null,
	ownerType: "user",
	visibility: "private",
	access: "member",
	canManage: false,
	src: "",
	previewSrc: null,
	downloadHref: "",
	share: null,
	shareUrl: null,
	downloadCount: null,
	contentHash: null,
};

const FOCUS_SETTLE_MS = 160;

function readAsidePreference(): boolean {
	return readStored("local", LocalKeys.PREVIEW_ASIDE_OPEN) !== "0";
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

async function downloadStored(
	assetId: string,
	href: string,
	share: string | null,
	signedIn: boolean,
): Promise<void> {
	if (signedIn) {
		await FilesService.recordDownload({
			assetId,
			via: share ? "share" : "preview",
			shareSlug: share,
		});
	}
	globalThis.location.assign(href);
}

/**
 * One opening of the preview: the file being shown, the group it pages through, and the state a
 * modal-stack frame keeps across a replacement (page, side panel, sheet, notes draft, aside scroll).
 * The inspector canvas is mounted for the active file only.
 */
export function PreviewSession(props: PreviewSessionProps): JSX.Element {
	const {
		files,
		startIndex,
		viewerId,
		projectId,
		notesMode,
		onClose,
		onRename,
		onToggleStar,
		onSaveNote,
		frame,
		context,
		onGoToMessage,
		titleId,
		stageRef,
	} = props;
	const ids = useId(undefined, "fx-preview");
	const asideId = `${ids}-aside`;
	const mobile = useIsMobile();
	const signedIn = viewerId !== "";

	// #region Frame state
	const local = useMemo(() => createModalStack<string, unknown>(), []);
	const stack = frame?.stack ?? local;
	const uid = frame?.uid ?? 0;
	const asideDefault = useMemo(readAsidePreference, []);
	const page = useFrameState(stack, uid, "page", clampPage(startIndex, files.length));
	const asideOpen = useFrameState(stack, uid, "asideOpen", asideDefault);
	const sheetOpen = useFrameState(stack, uid, "sheetOpen", false);
	const shortcutsOpen = useFrameState(stack, uid, "shortcutsOpen", false);
	const noteDraft = useFrameState(stack, uid, "noteDraft", "");
	const notesByFile = useFrameState<Record<string, string[]>>(stack, uid, "notes", {});
	const asideRef = useRef<HTMLDivElement>(null);
	const desktopAside = !mobile && asideOpen.value;
	useFrameScroll(stack, uid, desktopAside ? "asideScroll" : "asideScroll:hidden", asideRef);
	// #endregion

	// #region The file
	const index = clampPage(page.value, files.length);
	const file = files[index];
	const assetId = previewAssetId(file);
	const share = previewShareOf(file);
	const inspect = useInspectAsset(assetId, share);
	const dto = inspect.load?.status === "ready" ? inspect.load.asset : null;
	const host = useInspectorHost(dto ?? IDLE_ASSET, { signedIn, embedded: true });
	const liveHost = dto ? host : null;
	// #endregion

	// #region Panel requests
	useEffect(() => {
		const target = mobile ? sheetOpen : asideOpen;
		const { panelOpen } = host.shell;
		panelOpen.value = target.peek();
		const toTarget = effect(() => {
			const open = panelOpen.value;
			if (target.peek() !== open) target.value = open;
		});
		const toShell = effect(() => {
			const open = target.value;
			if (panelOpen.peek() !== open) panelOpen.value = open;
		});
		return () => {
			toTarget();
			toShell();
		};
	}, [host.shell, mobile]);
	// #endregion

	// #region Focus onto the canvas
	const touched = useRef(false);
	const legacy = !liveHost && inspect.load === null;
	useEffect(() => {
		if ((!liveHost && !legacy) || touched.current) return;
		let done = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const move = () => {
			if (done || touched.current) return;
			done = true;
			const stage = stageRef.current;
			const target = liveHost ? stage?.querySelector<HTMLElement>(".ins-stage") : stage;
			if (!stage || !target) return;
			const active = document.activeElement;
			if (stage.contains(active)) return;
			const dialog = stage.closest("[role='dialog']");
			if (active && active !== document.body && !dialog?.contains(active)) return;
			target.focus({ preventScroll: true });
		};
		const raf = requestAnimationFrame(() => {
			timer = setTimeout(move, 0);
		});
		const watchdog = setTimeout(move, FOCUS_SETTLE_MS);
		return () => {
			done = true;
			cancelAnimationFrame(raf);
			clearTimeout(timer);
			clearTimeout(watchdog);
		};
	}, [liveHost, legacy]);
	// #endregion

	// #region Source message
	const ctx = resolvePreviewContext(context, file, projectId);
	const fetched = useAttachmentSources(sourceLookup(file, ctx), signedIn);
	const source = pickSource(fetched, sourceFromFile(file, ctx), file.messageId);
	const mode = source ? goToMessageMode(source, file.messageId, onGoToMessage !== undefined) : null;
	const goToMessage = (target: SourcePaint, how: GoToMessageMode) => {
		if (frame) frame.stack.close();
		else onClose();
		setTimeout(() => {
			if (how === "jump") onGoToMessage?.(target.messageId);
			else if (target.href) globalThis.location.assign(target.href);
		}, 0);
	};
	// #endregion

	// #region Actions
	const select = (next: number) => {
		page.value = clampPage(next, files.length);
	};
	const onPagingKey = (e: JSX.TargetedKeyboardEvent<HTMLElement>) => {
		if (files.length < 2 || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
		if (isTypingTarget(e.target)) return;
		const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
		if (delta === 0) return;
		e.preventDefault();
		page.value = stepPage(index, delta, files.length);
	};
	const toggleAside = () => {
		const next = !asideOpen.peek();
		asideOpen.value = next;
		writeStored("local", LocalKeys.PREVIEW_ASIDE_OPEN, next ? "1" : "0");
	};
	const downloadHref = previewDownloadHref(file);
	const onDownload = assetId && downloadHref
		? () => void downloadStored(assetId, downloadHref, share, signedIn)
		: undefined;
	const notes: PreviewNotesState | null = notesMode
		? {
			draft: noteDraft,
			saved: notesByFile.value[file.id] ?? [],
			onSave: () => {
				const text = noteDraft.value.trim();
				if (!text) return;
				notesByFile.value = {
					...notesByFile.value,
					[file.id]: [...(notesByFile.value[file.id] ?? []), text],
				};
				noteDraft.value = "";
				onSaveNote?.(file.id, text);
			},
		}
		: null;
	const canvasShortcuts = liveHost && liveHost.shell.status.value !== "error"
		? liveHost.viewer.shortcuts
		: [];
	// #endregion

	const aside = (
		<PreviewAside
			file={file}
			host={liveHost}
			source={source}
			onGoToMessage={source && mode ? () => goToMessage(source, mode) : undefined}
			notes={notes}
			shortcuts={previewShortcuts(canvasShortcuts, files.length > 1)}
			shortcutsOpen={shortcutsOpen}
		/>
	);
	const main = (
		<div class="fx-modal__main">
			<PreviewStage
				file={file}
				host={liveHost}
				load={inspect.load}
				onRetry={inspect.retry}
				stageRef={stageRef}
				info={mobile
					? { open: sheetOpen.value, controls: asideId, onOpen: () => (sheetOpen.value = true) }
					: null}
			/>
			<PreviewTray files={files} index={index} onSelect={select} onKeyDown={onPagingKey} />
		</div>
	);

	return (
		<div
			class="fx-modal__session"
			onPointerDownCapture={() => (touched.current = true)}
			onKeyDownCapture={() => (touched.current = true)}
		>
			<PreviewHeader
				file={file}
				titleId={titleId}
				icon={previewIconName(file.kind, dto?.viewer)}
				meta={previewMetaLine(file, dto, liveHost?.shell.facts.value)}
				canRename={canRenameFile(file, viewerId)}
				onRename={(name) => onRename(file.id, name)}
				onToggleStar={() => onToggleStar(file.id)}
				downloadHref={downloadHref}
				onDownload={onDownload}
				inspectHref={previewInspectHref(file)}
				aside={mobile ? null : { open: asideOpen.value, controls: asideId, onToggle: toggleAside }}
				onClose={onClose}
				onKeyDown={onPagingKey}
			/>
			<div class="fx-modal__body">
				{mobile
					? main
					: (
						<Splitter layout="horizontal" stateKey="fx-preview" class="fx-modal__split">
							<SplitterPanel
								size={desktopAside ? 70 : 100}
								minSize={55}
								maxSize={desktopAside ? 82 : 100}
							>
								{main}
							</SplitterPanel>
							{desktopAside
								? (
									<SplitterPanel size={30} minSize={18} maxSize={45}>
										<div ref={asideRef} id={asideId} class="fx-modal__aside">
											{aside}
										</div>
									</SplitterPanel>
								)
								: null}
						</Splitter>
					)}
			</div>
			{mobile
				? (
					<InspectorSheet open={sheetOpen} label="File details" id={asideId}>
						{aside}
					</InspectorSheet>
				)
				: null}
		</div>
	);
}

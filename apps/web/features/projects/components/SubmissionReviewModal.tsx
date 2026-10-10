import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import {
	Backdrop,
	BodyPortal,
	createModalStack,
	type ModalStack,
	useFrameState,
	usePresence,
} from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import { ProgressiveImage } from "@projective/ui/display/image";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { assetMediaSrc, assetPlaceholder } from "@features/files/core/asset-media.ts";
import type { FileItem, SubmissionReview, SubmissionTreeNode } from "../types/projects-types.ts";
import { fileTabHref, openFileInTab, useFileTriggerFocus } from "../hooks/useFileTiles.ts";
import { kindLabel } from "../core/file-model.ts";
import { statusLabel, statusTone } from "../core/submission-model.ts";
import { profileHref } from "../core/routing.ts";
import { FilePreview } from "./FilePreview.tsx";
import { SubmissionTree } from "./SubmissionTree.tsx";
import { CloseIcon, FileKindIcon } from "./file-glyphs.tsx";
import {
	CollapseGlyph,
	ExpandGlyph,
	ExternalGlyph,
	NoteGlyph,
	StageTabGlyph,
	SubmissionStatusIcon,
	TicketGlyph,
} from "./submission-glyphs.tsx";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * SubmissionReviewModal — the full-screen client review workspace (Part 4). A `.ui-splitter` divides a
 * small LEFT context sidebar (freelancer card · Stage/Ticket/Notes tabs with a notes badge · the
 * full-height navigation tree) from the large RIGHT interactive workspace (a top-right expand-to-
 * fullscreen toggle + open-in-new-tab, over a media preview + asset metadata / client-feedback panel).
 * Hard min/max % on both panes preserve the large-workspace ⁄ small-context ratio. The modal footer
 * enforces the review controls: **Accept Submission** is always available; **Request Revision** is
 * blocked until at least one text annotation OR global guideline has been provided.
 *
 * Mounted through {@link BodyPortal} (NOT the in-tree Portal) so its `position: fixed` never re-bases
 * onto the transformed/blurred shell chrome (the glass-blur trap). Rendered by the SubmissionExplorer
 * island; the tree navigation is shared with the explorer (selecting a node re-scopes `files`).
 */
export interface SubmissionReviewModalProps {
	open: boolean;
	/** The active unit's review projection (stage/ticket/notes); null closes the modal. */
	review: SubmissionReview | null;
	/** The files under the current scope — the right pane's selectable rail + preview. */
	files: FileItem[];
	/** The full navigation tree (the left full-height tree navigator). */
	tree: SubmissionTreeNode[];
	rootLabel: string;
	rootCount: number;
	currentPath: string[];
	expanded: Signal<Set<string>>;
	viewerId: string;
	onClose: () => void;
	onNavigate: (path: string[]) => void;
	/**
	 * Commit a revision request with the accumulated feedback. `notes` is the text the freelancer
	 * receives: the overall guidelines followed by each file annotation, one per line, prefixed with
	 * the file it is about.
	 */
	onRequestRevision: (payload: { guidelines: string; annotations: number; notes: string }) => void;
	/** Accept the submission (escrow release). */
	onAccept: () => void;
	/** A verdict is in flight — both decision controls are disabled so one press cannot become two. */
	busy?: boolean;
	/** Why the last verdict did not land, rendered in the footer as an alert; null when there is none. */
	error?: string | null;
	/**
	 * When rendered as a frame of a modal stack: the workspace (selected file, mode, fullscreen,
	 * guidelines, annotations, draft note) lives in the frame cache, so a preview opened over it and
	 * dismissed again restores it as it was left.
	 */
	frame?: { stack: ModalStack<string, unknown>; uid: number };
	/**
	 * Open a file of this selection in the full preview, as a frame that replaces this one. Returns
	 * `false` when the host cannot, and the file opens in a new tab instead. Absent: no control.
	 */
	onOpenFile?: (fileId: string) => boolean;
}

/** The frame-cache keys the review workspace keeps its state under. */
export const REVIEW_FRAME_KEYS = [
	"rightMode",
	"selectedFileId",
	"fullscreen",
	"guidelines",
	"annotations",
	"draftNote",
] as const;

type RightMode = "file" | "stage" | "ticket" | "notes";
interface Annotation {
	id: string;
	fileId: string;
	fileName: string;
	text: string;
}

export function SubmissionReviewModal(props: SubmissionReviewModalProps): JSX.Element | null {
	const {
		open,
		review,
		files,
		tree,
		rootLabel,
		rootCount,
		currentPath,
		expanded,
		onClose,
		onNavigate,
		onRequestRevision,
		onAccept,
		busy = false,
		error = null,
		frame,
		onOpenFile,
	} = props;

	const { mounted, state } = usePresence(open);
	const stack = useOverlayStack({ active: mounted, lockScroll: true, layer: "modal" });
	const panelRef = useRef<HTMLDivElement>(null);
	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({
		open: mounted,
		enabled: stack.isTop,
		onDismiss: onClose,
		panelRef,
		closeOnOutside: false,
	});

	// #region Review state
	const local = useMemo(() => createModalStack<string, unknown>(), []);
	const cache = frame?.stack ?? local;
	const uid = frame?.uid ?? 0;
	const rightMode = useFrameState<RightMode>(cache, uid, "rightMode", "file");
	const selectedFileId = useFrameState<string | null>(cache, uid, "selectedFileId", null);
	const fullscreen = useFrameState(cache, uid, "fullscreen", false);
	const guidelines = useFrameState(cache, uid, "guidelines", "");
	const annotations = useFrameState<Annotation[]>(cache, uid, "annotations", []);
	const draftNote = useFrameState(cache, uid, "draftNote", "");
	const restored = useRef(frame ? cache.has(uid, "rightMode") : false);
	const expandRef = useRef<HTMLButtonElement>(null);
	useFileTriggerFocus(frame ?? null, () => expandRef.current);

	// Reset the workspace whenever a new unit / file set opens — but not when a frame is restored
	// from the cache, whose workspace is exactly what the reviewer left.
	const groupKey = `${review?.unit.path.join("/") ?? ""}#${files.map((f) => f.id).join("|")}`;
	useEffect(() => {
		if (restored.current) {
			restored.current = false;
			return;
		}
		rightMode.value = "file";
		selectedFileId.value = files[0]?.id ?? null;
		fullscreen.value = false;
		draftNote.value = "";
		// Keep guidelines + annotations across in-unit navigation but clear when the unit itself changes.
		annotations.value = [];
		guidelines.value = "";
	}, [review?.unit.path.join("/")]);
	// Keep the selected file valid as `files` changes (tree navigation).
	useEffect(() => {
		if (!files.some((f) => f.id === selectedFileId.value)) {
			selectedFileId.value = files[0]?.id ?? null;
		}
	}, [groupKey]);
	// #endregion

	if (!mounted || !review) return null;

	const unit = review.unit;
	const selected = files.find((f) => f.id === selectedFileId.value) ?? files[0] ?? null;
	const selectedTabHref = selected ? fileTabHref(selected) : null;
	const openPreview = () => {
		if (!selected) return;
		if (onOpenFile?.(selected.id)) return;
		openFileInTab(selected);
	};

	// A verdict is only owed on a unit awaiting review; after one, the workspace is read-only.
	const decidable = unit.status === "pending_review";
	const canRequestRevision = decidable &&
		(annotations.value.length > 0 || guidelines.value.trim().length > 0);

	const addAnnotation = () => {
		const text = draftNote.value.trim();
		if (!text || !selected) return;
		annotations.value = [
			...annotations.value,
			{ id: `a-${annotations.value.length}`, fileId: selected.id, fileName: selected.name, text },
		];
		draftNote.value = "";
	};

	const requestRevision = () => {
		if (!canRequestRevision || busy) return;
		const overall = guidelines.value.trim();
		const notes = [
			overall,
			...annotations.value.map((a) => `${a.fileName}: ${a.text}`),
		].filter(Boolean).join("\n");
		onRequestRevision({ guidelines: overall, annotations: annotations.value.length, notes });
	};

	// #region Tabs
	const tabs: { key: RightMode; label: string; icon: JSX.Element; badge?: number }[] = [
		{ key: "stage", label: "Stage", icon: <StageTabGlyph size={16} /> },
		{ key: "ticket", label: "Ticket", icon: <TicketGlyph size={16} /> },
		{
			key: "notes",
			label: "Notes",
			icon: <NoteGlyph size={16} />,
			badge: review.notes.length + annotations.value.length,
		},
	];
	// #endregion

	return (
		<BodyPortal>
			<div class="subm-review" data-state={state} style={`z-index:${stack.zIndex}`}>
				<Backdrop visible={state === "open"} onClick={onClose} />
				<div
					ref={panelRef}
					class="subm-review__panel"
					data-state={state}
					role="dialog"
					aria-modal="true"
					aria-label={`Review: ${unit.name}`}
					tabIndex={-1}
				>
					{/* Top bar — unit identity + close */}
					<header class="subm-review__top">
						<div class="subm-review__ident">
							<span class="subm-review__unitname">{unit.name}</span>
							<span
								class="subm-review__statuschip"
								data-tone={statusTone(unit.status)}
							>
								<SubmissionStatusIcon status={unit.status} size={14} />
								{statusLabel(unit.status)}
							</span>
						</div>
						<button
							type="button"
							class="subm-review__close"
							aria-label="Close review"
							onClick={onClose}
						>
							<CloseIcon size={18} />
						</button>
					</header>

					<div class="subm-review__split">
						<Splitter layout="horizontal" stateKey="submission-review">
							{/* LEFT — context sidebar */}
							<SplitterPanel size={30} minSize={22} maxSize={42} class="subm-review__aside">
								<div class="subm-ctx">
									<div class="subm-ctx__card">
										{unit.submitter.handle
											? (
												<a class="subm-ctx__who" href={profileHref(unit.submitter.handle)}>
													<UserAvatar
														image={unit.submitter.avatar ?? undefined}
														label={unit.submitter.name}
														size={40}
														alt=""
													/>
													<span class="subm-ctx__id">
														<span class="subm-ctx__name">{unit.submitter.name}</span>
														<span class="subm-ctx__role">
															Freelancer{unit.stageName ? ` · ${unit.stageName}` : ""}
														</span>
													</span>
												</a>
											)
											: (
												<div class="subm-ctx__who">
													<UserAvatar
														image={unit.submitter.avatar ?? undefined}
														label={unit.submitter.name}
														size={40}
														alt=""
													/>
													<span class="subm-ctx__id">
														<span class="subm-ctx__name">{unit.submitter.name}</span>
														<span class="subm-ctx__role">Freelancer</span>
													</span>
												</div>
											)}
										<p class="subm-ctx__meta">
											{unit.fileCount} {unit.fileCount === 1 ? "file" : "files"} · {unit.dateLabel}
										</p>
									</div>

									{
										/* A group of toggle buttons, NOT an ARIA tablist: the default "file" mode has no tab,
									    so no tab is ever "selected" — `aria-pressed` models the toggle state correctly. */
									}
									<div class="subm-ctx__tabs" role="group" aria-label="Submission context">
										{tabs.map((tab) => (
											<button
												key={tab.key}
												type="button"
												class="subm-ctx__tab"
												data-active={rightMode.value === tab.key ? "true" : undefined}
												aria-pressed={rightMode.value === tab.key}
												onClick={() => (rightMode.value = tab.key)}
											>
												<span class="subm-ctx__tabicon" aria-hidden="true">{tab.icon}</span>
												<span class="subm-ctx__tablabel">{tab.label}</span>
												{tab.badge ? <span class="subm-ctx__tabbadge">{tab.badge}</span> : null}
											</button>
										))}
									</div>

									<div class="subm-ctx__tree">
										<SubmissionTree
											tree={tree}
											rootLabel={rootLabel}
											rootCount={rootCount}
											currentPath={currentPath}
											expanded={expanded}
											onNavigate={onNavigate}
										/>
									</div>
								</div>
							</SplitterPanel>

							{/* RIGHT — interactive workspace */}
							<SplitterPanel size={70} minSize={58} maxSize={78} class="subm-review__work">
								<div class="subm-work" data-fullscreen={fullscreen.value ? "true" : undefined}>
									<div class="subm-work__bar">
										<span class="subm-work__crumb">
											{rightMode.value === "file"
												? (selected?.name ?? "No file selected")
												: rightMode.value === "stage"
												? "Stage details"
												: rightMode.value === "ticket"
												? "Ticket details"
												: "Notes"}
										</span>
										<div class="subm-work__tools">
											<button
												type="button"
												class="subm-work__tool"
												aria-pressed={fullscreen.value}
												aria-label={fullscreen.value ? "Exit fullscreen" : "Fullscreen preview"}
												onClick={() => (fullscreen.value = !fullscreen.value)}
											>
												{fullscreen.value ? <CollapseGlyph size={17} /> : <ExpandGlyph size={17} />}
											</button>
											{selected && onOpenFile
												? (
													<Tooltip content="Open preview" placement="bottom">
														<button
															ref={expandRef}
															type="button"
															class="subm-work__tool"
															aria-label={`Open preview of ${selected.name}`}
															onClick={openPreview}
														>
															<Icon name="eye" size="sm" />
														</button>
													</Tooltip>
												)
												: null}
											{selectedTabHref
												? (
													<Tooltip content="Open in new tab" placement="bottom">
														<a
															class="subm-work__tool"
															href={selectedTabHref}
															target="_blank"
															rel="noopener noreferrer"
															aria-label="Open in new tab"
														>
															<ExternalGlyph size={17} />
														</a>
													</Tooltip>
												)
												: null}
										</div>
									</div>

									{rightMode.value === "file"
										? (
											<div class="subm-work__file">
												{!fullscreen.value && files.length > 1
													? (
														<div class="subm-work__rail" aria-label="Files in this selection">
															{files.map((f) => {
																const thumb = f.kind === "image" || f.kind === "video"
																	? assetMediaSrc(f, "sm")
																	: null;
																return (
																	<button
																		key={f.id}
																		type="button"
																		class="subm-work__railitem"
																		data-file-id={f.id}
																		data-active={f.id === selected?.id ? "true" : undefined}
																		aria-label={f.name}
																		aria-current={f.id === selected?.id ? "true" : undefined}
																		onClick={() => (selectedFileId.value = f.id)}
																	>
																		{thumb
																			? (
																				<ProgressiveImage
																					src={thumb}
																					placeholder={assetPlaceholder(f)}
																					loading="lazy"
																					draggable={false}
																					fallback={<FileKindIcon kind={f.kind} size={16} />}
																				/>
																			)
																			: (
																				<span class="subm-work__railglyph" aria-hidden="true">
																					<FileKindIcon kind={f.kind} size={16} />
																				</span>
																			)}
																	</button>
																);
															})}
														</div>
													)
													: null}

												<div class="subm-work__stage">
													{selected
														? <FilePreview file={selected} active />
														: <div class="subm-work__empty">No files in this selection.</div>}
												</div>

												{!fullscreen.value && selected
													? (
														<div class="subm-work__feedback">
															<dl class="subm-work__facts">
																<div class="subm-work__fact">
																	<dt>Type</dt>
																	<dd>{kindLabel(selected.kind)} · {selected.ext.toUpperCase()}</dd>
																</div>
																<div class="subm-work__fact">
																	<dt>Size</dt>
																	<dd>{selected.sizeLabel}</dd>
																</div>
																{selected.width && selected.height
																	? (
																		<div class="subm-work__fact">
																			<dt>Dimensions</dt>
																			<dd>{selected.width} × {selected.height}</dd>
																		</div>
																	)
																	: null}
																<div class="subm-work__fact">
																	<dt>Sent</dt>
																	<dd>{selected.dateLabel}</dd>
																</div>
															</dl>
															<div class="subm-work__note">
																<label class="subm-work__notelabel" for="subm-note">
																	Client feedback on this file
																</label>
																<textarea
																	id="subm-note"
																	class="subm-work__notefield"
																	rows={2}
																	placeholder="Add a note or annotation for the freelancer…"
																	value={draftNote.value}
																	onInput={(
																		e,
																	) => (draftNote.value = (e.target as HTMLTextAreaElement).value)}
																/>
																<div class="subm-work__noteactions">
																	<button
																		type="button"
																		class="subm-btn subm-btn--soft"
																		disabled={!draftNote.value.trim()}
																		onClick={addAnnotation}
																	>
																		Add annotation
																	</button>
																</div>
																{annotations.value.filter((a) => a.fileId === selected.id).length >
																		0
																	? (
																		<ul class="subm-work__annos">
																			{annotations.value
																				.filter((a) => a.fileId === selected.id)
																				.map((a) => <li key={a.id}>{a.text}</li>)}
																		</ul>
																	)
																	: null}
															</div>
														</div>
													)
													: null}
											</div>
										)
										: (
											<div class="subm-work__detail">
												{rightMode.value === "stage"
													? (
														<>
															<h3 class="subm-detail__h">
																{review.stageName ?? "Stage"}
																{review.stageStatus
																	? <span class="subm-detail__tag">{review.stageStatus}</span>
																	: null}
															</h3>
															<p class="subm-detail__body">{review.stageSummary}</p>
														</>
													)
													: rightMode.value === "ticket"
													? (
														review.ticketTitle
															? (
																<>
																	<h3 class="subm-detail__h">{review.ticketTitle}</h3>
																	<p class="subm-detail__body">{review.ticketSummary}</p>
																</>
															)
															: (
																<p class="subm-detail__body subm-detail__body--empty">
																	This submission is not linked to a ticket.
																</p>
															)
													)
													: (
														<div class="subm-notes">
															<div class="subm-notes__guides">
																<label class="subm-work__notelabel" for="subm-guides">
																	Overall revision guidelines
																</label>
																<textarea
																	id="subm-guides"
																	class="subm-work__notefield"
																	rows={3}
																	placeholder="Global guidance for this revision (required unless you annotate files)…"
																	value={guidelines.value}
																	onInput={(
																		e,
																	) => (guidelines.value = (e.target as HTMLTextAreaElement).value)}
																/>
															</div>
															<ul class="subm-notes__list">
																{review.notes.map((n) => (
																	<li key={n.id} class="subm-note">
																		<UserAvatar
																			image={n.author.avatar ?? undefined}
																			label={n.author.name}
																			size={24}
																			alt=""
																		/>
																		<div class="subm-note__body">
																			<span class="subm-note__meta">
																				{n.author.name} · {n.dateLabel}
																			</span>
																			<span class="subm-note__text">{n.text}</span>
																		</div>
																	</li>
																))}
																{annotations.value.map((a) => (
																	<li key={a.id} class="subm-note subm-note--draft">
																		<div class="subm-note__body">
																			<span class="subm-note__meta">
																				You · draft · {a.fileName}
																			</span>
																			<span class="subm-note__text">{a.text}</span>
																		</div>
																	</li>
																))}
																{review.notes.length === 0 && annotations.value.length === 0
																	? (
																		<li class="subm-notes__empty">
																			No notes yet — annotate files or add guidelines above.
																		</li>
																	)
																	: null}
															</ul>
														</div>
													)}
											</div>
										)}
								</div>
							</SplitterPanel>
						</Splitter>
					</div>

					{/* Footer — review enforcement controls */}
					<footer class="subm-review__foot">
						{error
							? <p class="subm-review__error" role="alert">{error}</p>
							: (
								<p class="subm-review__hint" role="status">
									{busy
										? "Recording your decision…"
										: !decidable
										? "This submission has already been reviewed."
										: canRequestRevision
										? "Ready — your feedback will be sent with the revision request."
										: "Add a file annotation or overall guidelines to request a revision."}
								</p>
							)}
						<div class="subm-review__actions" aria-busy={busy}>
							<button
								type="button"
								class="subm-btn subm-btn--danger"
								disabled={!canRequestRevision || busy}
								onClick={requestRevision}
							>
								Request Revision
							</button>
							<button
								type="button"
								class="subm-btn subm-btn--primary"
								disabled={busy || !decidable}
								onClick={() => {
									if (!busy && decidable) onAccept();
								}}
							>
								Accept Submission
							</button>
						</div>
					</footer>
				</div>
			</div>
		</BodyPortal>
	);
}

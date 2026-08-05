import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { Avatar, Carousel } from "@projective/ui/display";
import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { Popover } from "@projective/ui/feedback";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import { type AssetItem, sourceLabel, visibilityLabel } from "../types/projects-types.ts";
import { kindLabel } from "../core/file-model.ts";
import { profileHref } from "../core/routing.ts";
import { channelMessageHref } from "../core/chat-context.ts";
import { FilePreview } from "./FilePreview.tsx";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	CloseIcon,
	DmBubbleIcon,
	DownloadIcon,
	EditIcon,
	FileKindIcon,
	KebabIcon,
	StarGlyph,
} from "./file-glyphs.tsx";

/**
 * AttachmentPreviewModal — the universal, footer-less preview. A `.ui-splitter` divides a large LEFT
 * media panel from a small RIGHT metadata panel (hard min/max % so the ratio can never collapse). The
 * media panel renders a rich per-type preview inside a swipe carousel; when the asset belongs to a
 * multi-file post, a companion tray sits at the bottom-centre bounded by prev/next chevrons, and the
 * user can click-drag directly on the media to slide between siblings. The header shows the filename
 * (inline-editable when the viewer is the original sender), Download, Star, a kebab menu, and Close —
 * no global footer. The metadata panel links the sender's profile and shows the accompanying message.
 *
 * Mounted through {@link BodyPortal} (NOT the in-tree Portal) so its `position: fixed` never re-bases
 * onto the transformed/blurred shell chrome (the glass-blur trap). Rendered by the FileExplorer island.
 */
export interface AttachmentPreviewModalProps {
	open: boolean;
	/** The message group (siblings sharing a post) — the carousel + tray walk this set. */
	files: AssetItem[];
	/** The index within `files` the modal opens on. */
	startIndex: number;
	/** The acting viewer's sender id — the filename is editable only on the viewer's own files. */
	viewerId: string;
	/** The engagement route slug — powers the "Go to Message" deep link. */
	projectId: string;
	/**
	 * Submissions context — renders a client Notes area in the right metadata panel (alongside the
	 * sender/facts) so the reviewer can jot notes for the upcoming review. Omitted/false for the plain
	 * File Explorer.
	 */
	notesMode?: boolean;
	onClose: () => void;
	onRename: (fileId: string, name: string) => void;
	onToggleStar: (fileId: string) => void;
	/** Persist a review note (stub-friendly; the modal also keeps them locally for the session). */
	onSaveNote?: (fileId: string, text: string) => void;
}

export function AttachmentPreviewModal(props: AttachmentPreviewModalProps): JSX.Element | null {
	const {
		open,
		files,
		startIndex,
		viewerId,
		projectId,
		notesMode = false,
		onClose,
		onRename,
		onToggleStar,
		onSaveNote,
	} = props;

	const { mounted, state } = usePresence(open);
	// `layer: "modal"` explicitly: the default is `"popover"` (z 1100), and a modal left on the
	// popover layer is outranked by any correctly-declared sibling — including `PreSubmitModal`,
	// which can open over this one from the same surface.
	const stack = useOverlayStack({ active: mounted, lockScroll: true, layer: "modal" });
	const panelRef = useRef<HTMLDivElement>(null);
	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({ open: mounted, onDismiss: onClose, panelRef, closeOnOutside: false });

	const page = useSignal(startIndex);
	const editing = useSignal(false);
	const nameDraft = useSignal("");
	// Client-side review notes, keyed by file id (session-local stub; `onSaveNote` wires persistence).
	const noteDraft = useSignal("");
	const notesByFile = useSignal<Record<string, string[]>>({});
	const menuOpen = useSignal(false);
	const menuBtnRef = useRef<HTMLButtonElement>(null);

	// Reset the page (and any in-flight rename) whenever a new group is opened.
	const groupKey = files.map((f) => f.id).join("|");
	useEffect(() => {
		page.value = Math.min(Math.max(0, startIndex), Math.max(0, files.length - 1));
		editing.value = false;
		menuOpen.value = false;
		noteDraft.value = "";
	}, [groupKey]);

	if (!mounted || files.length === 0) return null;

	const idx = Math.min(Math.max(0, page.value), files.length - 1);
	const file = files[idx];
	// A posted file keeps the original rule (own files only); an asset with no sender — a hub
	// upload, a drive mount — defers to the server-derived capability instead of guessing.
	const canRename = file.sender ? file.sender.id === viewerId : file.canManage;
	const multi = files.length > 1;

	const startEdit = () => {
		if (!canRename) return;
		nameDraft.value = file.name;
		editing.value = true;
	};
	const commitEdit = () => {
		const next = nameDraft.value.trim();
		if (next && next !== file.name) onRename(file.id, next);
		editing.value = false;
	};

	const fileNotes = notesByFile.value[file.id] ?? [];
	const saveNote = () => {
		const text = noteDraft.value.trim();
		if (!text) return;
		notesByFile.value = {
			...notesByFile.value,
			[file.id]: [...(notesByFile.value[file.id] ?? []), text],
		};
		noteDraft.value = "";
		onSaveNote?.(file.id, text);
	};

	return (
		<BodyPortal>
			<div class="fx-modal" data-state={state} style={`z-index:${stack.zIndex}`}>
				<Backdrop visible={state === "open"} onClick={onClose} />
				<div
					ref={panelRef}
					class="fx-modal__panel"
					data-state={state}
					role="dialog"
					aria-modal="true"
					aria-label={`Preview: ${file.name}`}
					tabIndex={-1}
				>
					{/* Header — filename + actions, no footer anywhere */}
					<header class="fx-modal__head">
						<div class="fx-modal__title">
							{editing.value
								? (
									<input
										class="fx-modal__rename"
										type="text"
										value={nameDraft.value}
										autoFocus
										aria-label="Rename file"
										onInput={(e) => (nameDraft.value = (e.target as HTMLInputElement).value)}
										onBlur={commitEdit}
										onKeyDown={(e) => {
											if (e.key === "Enter") commitEdit();
											else if (e.key === "Escape") editing.value = false;
										}}
									/>
								)
								: (
									<button
										type="button"
										class="fx-modal__name"
										data-editable={canRename ? "true" : undefined}
										onClick={startEdit}
										title={canRename ? "Click to rename" : file.name}
									>
										<span class="fx-modal__nametext">{file.name}</span>
										{canRename
											? (
												<span class="fx-modal__nameedit" aria-hidden="true">
													<EditIcon size={14} />
												</span>
											)
											: null}
									</button>
								)}
						</div>
						<div class="fx-modal__actions">
							<a class="fx-modal__act" href={file.url} download aria-label="Download">
								<DownloadIcon size={17} />
							</a>
							<button
								type="button"
								class="fx-modal__act"
								data-on={file.starred ? "true" : undefined}
								aria-pressed={file.starred}
								aria-label={file.starred ? "Unstar" : "Star"}
								onClick={() => onToggleStar(file.id)}
							>
								<StarGlyph size={17} filled={file.starred} />
							</button>
							{
								/*
								 * The kebab menu goes through the shared Popover — i.e. through BodyPortal and the
								 * managed z-stack — rather than an absolutely-positioned child. As a child it lived
								 * inside the panel's `overflow: hidden`, so it was the one overlay in the system that
								 * could be clipped by its own container.
								 */
							}
							<button
								ref={menuBtnRef}
								type="button"
								class="fx-modal__act"
								aria-label="More actions"
							>
								<KebabIcon size={17} />
							</button>
							<Popover open={menuOpen} targetRef={menuBtnRef} placement="bottom-end">
								<div class="fx-modal__menu" role="menu">
									<button
										type="button"
										class="fx-modal__menuitem"
										role="menuitem"
										onClick={() => (menuOpen.value = false)}
									>
										Copy link
									</button>
									<button
										type="button"
										class="fx-modal__menuitem"
										role="menuitem"
										onClick={() => (menuOpen.value = false)}
									>
										Report
									</button>
								</div>
							</Popover>
							<button
								type="button"
								class="fx-modal__act fx-modal__act--close"
								aria-label="Close preview"
								onClick={onClose}
							>
								<CloseIcon size={18} />
							</button>
						</div>
					</header>

					<div class="fx-modal__split">
						<Splitter layout="horizontal" stateKey="attachment-preview">
							<SplitterPanel size={68} minSize={50} maxSize={82} class="fx-modal__media">
								<div class="fx-modal__stage">
									<Carousel
										value={files}
										page={page}
										numVisible={1}
										showIndicators={false}
										showNavigators={false}
										circular={false}
										aria-label="Attachment preview"
										itemTemplate={(f: AssetItem, i: number) => (
											<FilePreview file={f} active={i === idx} />
										)}
									/>
								</div>
								{multi
									? (
										<div class="fx-tray">
											<button
												type="button"
												class="fx-tray__nav"
												aria-label="Previous attachment"
												disabled={idx === 0}
												onClick={() => (page.value = Math.max(0, idx - 1))}
											>
												<ChevronLeftIcon size={20} />
											</button>
											<div class="fx-tray__strip">
												{files.map((f, i) => (
													<button
														key={f.id}
														type="button"
														class="fx-tray__thumb"
														data-active={i === idx ? "true" : undefined}
														aria-label={`View ${f.name}`}
														aria-current={i === idx ? "true" : undefined}
														onClick={() => (page.value = i)}
													>
														{f.thumbnailUrl && (f.kind === "image" || f.kind === "video")
															? <img src={f.thumbnailUrl} alt="" loading="lazy" draggable={false} />
															: (
																<span class="fx-tray__glyph" aria-hidden="true">
																	<FileKindIcon kind={f.kind} size={18} />
																</span>
															)}
													</button>
												))}
											</div>
											<button
												type="button"
												class="fx-tray__nav"
												aria-label="Next attachment"
												disabled={idx === files.length - 1}
												onClick={() => (page.value = Math.min(files.length - 1, idx + 1))}
											>
												<ChevronRightIcon size={20} />
											</button>
										</div>
									)
									: null}
							</SplitterPanel>

							<SplitterPanel size={32} minSize={18} maxSize={50} class="fx-modal__aside">
								<div class="fx-aside">
									<div class="fx-aside__sender">
										{file.sender
											? (
												<>
													{file.sender.handle
														? (
															<a
																class="fx-aside__senderlink"
																href={profileHref(file.sender.handle)}
															>
																<Avatar
																	image={file.sender.avatar ?? undefined}
																	label={file.sender.name}
																	size={40}
																	alt=""
																/>
																<span class="fx-aside__id">
																	<span class="fx-aside__name">{file.sender.name}</span>
																	<span class="fx-aside__handle">@{file.sender.handle}</span>
																</span>
															</a>
														)
														: (
															<div class="fx-aside__senderlink">
																<Avatar
																	image={file.sender.avatar ?? undefined}
																	label={file.sender.name}
																	size={40}
																	alt=""
																/>
																<span class="fx-aside__id">
																	<span class="fx-aside__name">{file.sender.name}</span>
																</span>
															</div>
														)}
													{file.channelName
														? (
															<p class="fx-aside__context">
																Shared in <span class="fx-aside__chan">{file.channelName}</span> ·
																{" "}
																{file.dayLabel} {file.timeLabel}
															</p>
														)
														: null}
													{file.channelId && file.messageId
														? (
															<a
																class="fx-aside__gotomsg"
																href={channelMessageHref(projectId, file.channelId, file.messageId)}
																aria-label={`Go to this message in ${
																	file.channelName ?? "the channel"
																}`}
															>
																<DmBubbleIcon size={16} />
																<span>Go to Message</span>
															</a>
														)
														: null}
												</>
											)
											: (
												/* No sender: the asset was uploaded or mounted, not posted. Say where it lives
												   and who can see it — the two facts that replace "who shared this". */
												<>
													<div class="fx-aside__senderlink">
														<span class="fx-aside__srcmark" aria-hidden="true">
															<FileKindIcon kind={file.kind} size={20} />
														</span>
														<span class="fx-aside__id">
															<span class="fx-aside__name">{sourceLabel(file.source)}</span>
															<span class="fx-aside__handle">
																{visibilityLabel(file.visibility)}
															</span>
														</span>
													</div>
													<p class="fx-aside__context">
														{file.folderPath.length > 0
															? file.folderPath.join(" / ")
															: "Library root"} · {file.dayLabel} {file.timeLabel}
													</p>
												</>
											)}
									</div>

									{file.messageText
										? <blockquote class="fx-aside__msg">{file.messageText}</blockquote>
										: null}
									{file.messageAudioUrl
										? (
											<div class="fx-aside__voice" aria-label="Voice note">
												<span class="fx-aside__voice-icon" aria-hidden="true">
													<FileKindIcon kind="audio" size={16} />
												</span>
												<span>Voice note</span>
											</div>
										)
										: null}

									<dl class="fx-aside__facts">
										<div class="fx-fact">
											<dt>Type</dt>
											<dd>{kindLabel(file.kind)} · {file.ext.toUpperCase()}</dd>
										</div>
										<div class="fx-fact">
											<dt>Size</dt>
											<dd>{file.sizeLabel}</dd>
										</div>
										{file.width && file.height
											? (
												<div class="fx-fact">
													<dt>Dimensions</dt>
													<dd>{file.width} × {file.height}</dd>
												</div>
											)
											: null}
										{file.durationLabel
											? (
												<div class="fx-fact">
													<dt>Duration</dt>
													<dd>{file.durationLabel}</dd>
												</div>
											)
											: null}
										<div class="fx-fact">
											<dt>Date</dt>
											<dd>{file.dateLabel}</dd>
										</div>
									</dl>

									{notesMode
										? (
											<div class="fx-modal__notes">
												<label class="fx-modal__noteslabel" for="fx-review-note">
													Notes for review
												</label>
												{fileNotes.length
													? (
														<ul class="fx-modal__noteslist">
															{fileNotes.map((n, i) => <li key={i} class="fx-modal__note">{n}</li>)}
														</ul>
													)
													: null}
												<div class="fx-modal__noterow">
													<textarea
														id="fx-review-note"
														class="fx-modal__noteinput"
														rows={2}
														placeholder="Leave a note for the upcoming review…"
														value={noteDraft.value}
														onInput={(
															e,
														) => (noteDraft.value = (e.target as HTMLTextAreaElement).value)}
														onKeyDown={(e) => {
															if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveNote();
														}}
													/>
													<button
														type="button"
														class="fx-modal__notesave"
														disabled={!noteDraft.value.trim()}
														onClick={saveNote}
													>
														Save note
													</button>
												</div>
											</div>
										)
										: null}
								</div>
							</SplitterPanel>
						</Splitter>
					</div>
				</div>
			</div>
		</BodyPortal>
	);
}

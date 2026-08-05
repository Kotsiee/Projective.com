import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import type { TaskChecklist } from "../core/submission-tasks.ts";
import { checklistProgress } from "../core/submission-tasks.ts";
import { kindLabel } from "../core/file-model.ts";
import { FilePreview } from "./FilePreview.tsx";
import { TaskChecklistView } from "./TaskChecklistView.tsx";
import { CloseIcon, FileKindIcon } from "./file-glyphs.tsx";
import { SendGlyph } from "./submission-glyphs.tsx";

/**
 * PreSubmitModal — the freelancer's self-review before submitting to the client (root task §5). It
 * mirrors the client's {@link SubmissionReviewModal} layout — a `.ui-splitter` with a small LEFT context
 * (a file summary + the interactive stage/ticket **Task Checklist** the freelancer ticks off) and a large
 * RIGHT preview (the selectable file rail + `FilePreview`) — but is tailored for self-review: the footer's
 * single primary CTA **Confirm & Submit to Client** transitions the submission from draft to published.
 *
 * The checklist is the SAME state the Tasks panel binds (owned by the explorer island), so ticks agree
 * across both. Mounted through {@link BodyPortal} to beat the glass-blur `position: fixed` trap.
 */

/** The Asset Picker routing key — one pre-submit review is open at a time. */
const PICKER_ID = "presubmit-library";

export interface PreSubmitModalProps {
	open: boolean;
	/** The submission being sent (its name / title). */
	submissionName: string;
	/**
	 * The files that will be submitted — the right pane's rail + preview.
	 *
	 * Typed as the WIDE {@link AssetItem} rather than the channel-attachment `FileItem` so a deliverable
	 * picked from the freelancer's own library sits in the same list as one uploaded into the
	 * submission. `FileItem` is a narrowing of this shape, so every existing caller still passes.
	 */
	files: AssetItem[];
	checklist: TaskChecklist;
	onToggle: (id: string) => void;
	onClose: () => void;
	onConfirm: () => void;
	/**
	 * Add deliverables the freelancer already has, from the Asset Picker.
	 *
	 * Optional, and the control only appears when it is supplied: the HOST owns what will be submitted,
	 * so a modal that staged picks in its own state would show a file the submission does not contain.
	 * Absent, the modal behaves exactly as it did before this seam existed.
	 */
	onAddFromLibrary?: (assets: AssetItem[]) => void;
}

export function PreSubmitModal(props: PreSubmitModalProps): JSX.Element | null {
	const {
		open,
		submissionName,
		files,
		checklist,
		onToggle,
		onClose,
		onConfirm,
		onAddFromLibrary,
	} = props;

	const { mounted, state } = usePresence(open);
	// `layer: "modal"` explicitly: the default is `"popover"` (z 1100), and a modal sitting on the
	// popover layer is one Tooltip away from being drawn over.
	const stack = useOverlayStack({ active: mounted, lockScroll: true, layer: "modal" });
	const panelRef = useRef<HTMLDivElement>(null);
	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({ open: mounted, onDismiss: onClose, panelRef, closeOnOutside: false });

	const selectedFileId = useSignal<string | null>(null);
	useEffect(() => {
		if (open) selectedFileId.value = files[0]?.id ?? null;
	}, [open, files.length]);

	if (!mounted) return null;

	const selected = files.find((f) => f.id === selectedFileId.value) ?? files[0] ?? null;
	const { total, done } = checklistProgress(checklist);
	const allDone = total > 0 && done === total;

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
					aria-label={`Submit for review: ${submissionName}`}
					tabIndex={-1}
				>
					{/* Top bar */}
					<header class="subm-review__top">
						<div class="subm-review__ident">
							<span class="subm-review__unitname">{submissionName}</span>
							<span class="subm-review__statuschip" data-tone="muted">Pre-submit review</span>
						</div>
						<button
							type="button"
							class="subm-review__close"
							aria-label="Close"
							onClick={onClose}
						>
							<CloseIcon size={18} />
						</button>
					</header>

					<div class="subm-review__split">
						<Splitter layout="horizontal" stateKey="submission-presubmit">
							{/* LEFT — summary + task checklist */}
							<SplitterPanel size={34} minSize={26} maxSize={46} class="subm-review__aside">
								<div class="subm-ctx">
									<div class="subm-ctx__card">
										<p class="subm-ctx__meta">
											{files.length} {files.length === 1 ? "file" : "files"} ready to submit
										</p>
										{onAddFromLibrary
											? (
												<button
													type="button"
													class="subm-ctx__add"
													onClick={() =>
														openPicker({
															requesterId: PICKER_ID,
															title: "Add from your files",
															multiple: true,
														})}
												>
													Add from your files
												</button>
											)
											: null}
									</div>
									<div class="subm-presubmit__checklist">
										<h3 class="subm-presubmit__h">Before you submit</h3>
										<TaskChecklistView checklist={checklist} onToggle={onToggle} compact />
									</div>
								</div>
							</SplitterPanel>

							{/* RIGHT — file preview */}
							<SplitterPanel size={66} minSize={54} maxSize={74} class="subm-review__work">
								<div class="subm-work">
									<div class="subm-work__bar">
										<span class="subm-work__crumb">{selected?.name ?? "No files yet"}</span>
									</div>
									<div class="subm-work__file">
										{files.length > 1
											? (
												<div class="subm-work__rail" aria-label="Files in this submission">
													{files.map((f) => (
														<button
															key={f.id}
															type="button"
															class="subm-work__railitem"
															data-active={f.id === selected?.id ? "true" : undefined}
															aria-label={f.name}
															onClick={() => (selectedFileId.value = f.id)}
														>
															{f.thumbnailUrl && (f.kind === "image" || f.kind === "video")
																? (
																	<img
																		src={f.thumbnailUrl}
																		alt=""
																		loading="lazy"
																		draggable={false}
																	/>
																)
																: (
																	<span class="subm-work__railglyph" aria-hidden="true">
																		<FileKindIcon kind={f.kind} size={16} />
																	</span>
																)}
														</button>
													))}
												</div>
											)
											: null}
										<div class="subm-work__stage">
											{selected
												? <FilePreview file={selected} active />
												: (
													<div class="subm-work__empty">
														No files attached yet — add files, then submit.
													</div>
												)}
										</div>
										{selected
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
													</dl>
												</div>
											)
											: null}
									</div>
								</div>
							</SplitterPanel>
						</Splitter>
					</div>

					{/* Footer — confirm & submit */}
					<footer class="subm-review__foot">
						<p class="subm-review__hint" role="status">
							{total === 0
								? "Review your files, then submit them to the client."
								: allDone
								? "All tasks checked — ready to submit."
								: `${done} of ${total} tasks checked — you can still submit.`}
						</p>
						<div class="subm-review__actions">
							<button type="button" class="subm-btn subm-btn--soft" onClick={onClose}>
								Keep editing
							</button>
							<button
								type="button"
								class="subm-btn subm-btn--primary"
								disabled={files.length === 0}
								onClick={onConfirm}
							>
								<span class="subm-btn__icon" aria-hidden="true">
									<SendGlyph size={16} />
								</span>
								Confirm &amp; Submit to Client
							</button>
						</div>
					</footer>
				</div>

				{
					/* Inside the portal layer, so the picker's own fixed panel is not re-based by the
				    review panel's chrome. Mounted whenever the modal is, not only when the seam is
				    supplied — a conditionally-rendered island is absent from the page's island graph, and
				    that graph is what carries its stylesheet. */
				}
				<AssetPicker
					requesterId={PICKER_ID}
					onPick={(assets) => onAddFromLibrary?.(assets)}
				/>
			</div>
		</BodyPortal>
	);
}

import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { MAX_PROJECT_ATTACHMENTS } from "../../types/projects-types.ts";
import type { ProjectAttachment, ProjectSetup } from "../../types/projects-types.ts";
import { patchSetup } from "../../core/setup-state.ts";
import { formatBytes } from "../../core/composer-model.ts";
import { fileDragActive, filesFrom } from "../../core/file-drag.ts";
import { type PendingAttachment, useAttachmentUpload } from "../../hooks/useAttachmentUpload.ts";
import { Field, Note, Section } from "./setup-primitives.tsx";

/**
 * SetupAttachmentsSection — the engagement's reference files, and the file drop zones that accept a
 * dragged file anywhere on the form (shared with the NDA document field in Terms & visibility).
 */

// #region File drop zones
const ATTACHMENT_PICKER = "psu-attachments";
/** The asset picker requester id the NDA document field opens the library under. */
export const NDA_PICKER = "psu-nda";

/**
 * A region that accepts a dropped file, and says so before the pointer reaches it.
 *
 * Two states, and the difference between them is the point. **Armed** is set from the WINDOW the
 * moment a file drag enters the page ({@link fileDragActive}), so every place a file may go
 * announces itself at once and the reader can see they have a choice; **over** is this zone
 * specifically, and is what says which one a release would land in. A zone that only lit on hover
 * could express neither — it would answer one move too late, and could never show the second option
 * at all.
 *
 * The zone is a plain region rather than a `<button>`: the click affordances are the real controls
 * inside it, and wrapping them in another activatable element would put a control inside a control.
 * Dropping is a pointer gesture with no keyboard equivalent, which is exactly why the file input and
 * the library picker beside it are not optional garnish — they are the whole keyboard path, and the
 * drop is the shortcut.
 */
export function DropZone(props: {
	/** Names the zone in the drop prompt: "Drop <label> here". */
	label: string;
	/** Refuses drops — at the attachment cap, or while the field is not editable. */
	disabled?: boolean;
	onFiles: (files: File[]) => void;
	children: ComponentChildren;
}): JSX.Element {
	const over = useSignal(false);
	const armed = fileDragActive.value && !props.disabled;

	return (
		<div
			class="psu-drop"
			data-armed={armed || undefined}
			data-over={(armed && over.value) || undefined}
			/*
			 * `preventDefault` on dragover is what makes this a drop target at all — without it the
			 * browser's default is to refuse the drop and navigate to the file instead, which discards
			 * the whole form. It is deliberately NOT done at the window (see `core/file-drag.ts`), so a
			 * file released over the prose still gets the browser's own handling rather than being
			 * silently swallowed by a page-wide target that does nothing with it.
			 */
			onDragOver={(event: JSX.TargetedDragEvent<HTMLDivElement>) => {
				if (props.disabled) return;
				event.preventDefault();
				over.value = true;
			}}
			onDragEnter={() => {
				if (!props.disabled) over.value = true;
			}}
			onDragLeave={(event: JSX.TargetedDragEvent<HTMLDivElement>) => {
				// `dragleave` also fires when the pointer crosses into a CHILD of this zone, which would
				// flicker the highlight off over every control inside it. `relatedTarget` is where the
				// pointer went; if it is still within this element, the drag has not left.
				const next = event.relatedTarget;
				if (next instanceof Node && event.currentTarget.contains(next)) return;
				over.value = false;
			}}
			onDrop={(event: JSX.TargetedDragEvent<HTMLDivElement>) => {
				over.value = false;
				if (props.disabled) return;
				event.preventDefault();
				const files = filesFrom(event as unknown as DragEvent);
				if (files.length > 0) props.onFiles(files);
			}}
		>
			{props.children}
			{
				/*
				 * The prompt is rendered only while a drag is live. A permanent "or drop files here" line
				 * is a sentence the reader has to skip on every visit to learn nothing, and this form is
				 * long enough already.
				 */
			}
			{armed && (
				<p class="psu-drop__prompt" aria-hidden="true">
					<Icon name="upload" size="sm" />
					Drop {props.label} here
				</p>
			)}
		</div>
	);
}

/**
 * One file that has been dropped but is not yet an asset.
 *
 * The thumbnail is a local object URL, so it is on screen before anything has been uploaded. The
 * failure state lives on the row rather than in a notification: a drop of six files where one fails
 * has to say WHICH, and a message naming a file the reader then has to find in a list is asking them
 * to do the matching the interface exists to do.
 */
export function PendingFileRow(
	{ row, onDismiss }: { row: PendingAttachment; onDismiss: () => void },
): JSX.Element {
	const failed = row.status === "failed";
	return (
		<li class="psu-file psu-file--pending" data-status={row.status}>
			<span class="psu-file__thumb">
				{row.previewUrl
					? <img src={row.previewUrl} alt="" loading="lazy" />
					: <Icon name="attachment" size="sm" />}
				{
					/*
					 * The spinner sits OVER the thumbnail, which is the thing whose state is in question.
					 * `aria-hidden` because the row already announces itself through `aria-busy` below —
					 * a spinner announced as well would say the same thing twice.
					 */
				}
				{!failed && <span class="psu-file__spinner" aria-hidden="true" />}
			</span>
			<span class="psu-file__body">
				<span class="psu-file__name">{row.name}</span>
				{failed
					? <span class="psu-file__error">{row.error}</span>
					: <span class="psu-file__meta">{formatBytes(row.sizeBytes)} · Uploading…</span>}
			</span>
			<button
				type="button"
				class="psu-stage__remove"
				aria-label={failed ? `Dismiss ${row.name}` : `Cancel ${row.name}`}
				onClick={onDismiss}
			>
				<Icon name="trash" />
			</button>
		</li>
	);
}
// #endregion

// #region Attachments
/**
 * The engagement's reference files.
 *
 * An attachment is carried by `files.items` REFERENCE, never by URL, so the same asset can be a
 * project brief here and a submission deliverable elsewhere without the bytes having two lifetimes.
 * That is why all three paths — picking from the library, choosing from the device, and dropping —
 * end in an asset id: an upload is a way of getting a file INTO the library, not a second kind of
 * attachment.
 *
 * **The NDA is no longer here.** It shares a shape with an attachment (a file reference) and nothing
 * else: a reference file is material the freelancer reads to decide whether to apply, and the NDA is
 * a legal instrument they sign before they are allowed to. Filed together, the section had to be
 * called "Attachments & NDA" — a title that names two subjects is the surest sign a section has two.
 * It now lives with the other terms of the engagement, in Rules → Advanced options.
 */
export function AttachmentsSection({ setup }: { setup: ProjectSetup }): JSX.Element {
	const room = MAX_PROJECT_ATTACHMENTS - setup.attachments.length;

	const addAttachments = (items: ProjectAttachment[]) => {
		if (items.length === 0) return;
		const held = new Set(setup.attachments.map((a) => a.id));
		const fresh = items.filter((a) => !held.has(a.id));
		if (fresh.length === 0) return;
		patchSetup({
			attachments: [...setup.attachments, ...fresh].slice(0, MAX_PROJECT_ATTACHMENTS),
		});
	};

	/**
	 * The room is read through a FUNCTION, not captured.
	 *
	 * A drop of three files onto a project with one slot left must take one, and the number of slots
	 * moves as earlier rows land. A value closed over when this render ran would be the answer from
	 * before the previous drop finished.
	 */
	const uploads = useAttachmentUpload({
		room: () => MAX_PROJECT_ATTACHMENTS - setup.attachments.length,
		onLanded: (assets) => addAttachments(assets),
	});

	const pending = uploads.pending.value;
	const previews = uploads.previews.value;
	const full = room <= 0;
	// The empty state is about what the reader can SEE, so an in-flight card counts: a zone that
	// shrank to its compact form the moment a file was dropped would move the controls out from under
	// the pointer that had just used them.
	const empty = setup.attachments.length === 0 && pending.length === 0;

	const onFileInput = (event: JSX.TargetedEvent<HTMLInputElement>) => {
		const picked = event.currentTarget.files;
		if (picked) uploads.send(Array.from(picked));
		event.currentTarget.value = "";
	};

	return (
		<Section sectionKey="attachments" title="Attachments">
			<Field
				label="Reference files"
				hint={`Briefs, brand sheets, specs. Up to ${MAX_PROJECT_ATTACHMENTS}.`}
			>
				<DropZone label="reference files" disabled={full} onFiles={uploads.send}>
					<ul class="psu-rows" role="list" aria-busy={uploads.busy.value || undefined}>
						{setup.attachments.map((file) => (
							<li key={file.id} class="psu-file">
								<span class="psu-file__thumb">
									{previews[file.id]
										? <img src={previews[file.id]} alt="" loading="lazy" />
										: <Icon name="attachment" size="sm" />}
								</span>
								<span class="psu-file__body">
									<span class="psu-file__name">{file.name}</span>
									{file.sizeBytes !== null && (
										<span class="psu-file__meta">{formatBytes(file.sizeBytes)}</span>
									)}
								</span>
								<button
									type="button"
									class="psu-stage__remove"
									aria-label={`Remove ${file.name}`}
									onClick={() =>
										patchSetup({
											attachments: setup.attachments.filter((a) => a.id !== file.id),
										})}
								>
									<Icon name="trash" />
								</button>
							</li>
						))}
						{pending.map((row) => (
							<PendingFileRow
								key={row.key}
								row={row}
								onDismiss={() => uploads.dismiss(row.key)}
							/>
						))}
					</ul>

					{
						/*
						 * The action row grows when there is nothing to act on.
						 *
						 * An empty list makes these controls the only content in the region, so they carry the
						 * section on their own and are sized to be found. Once a file is attached they are a
						 * way of adding another to a list that is already the subject, and step down. The two
						 * buttons stretch to a common height in both tiers — a row of controls at two
						 * different heights reads as two different KINDS of control, which these are not.
						 */
					}
					<div class="psu-actions" data-scale={empty ? "lead" : "compact"}>
						<button
							type="button"
							class="psu-add"
							disabled={full}
							onClick={() =>
								openPicker({
									requesterId: ATTACHMENT_PICKER,
									title: "Attach from your files",
									multiple: true,
									max: Math.max(1, room),
								})}
						>
							<Icon name="attachment" />
							Add from your files
						</button>

						<label class="psu-add" data-disabled={full || undefined}>
							<Icon name="upload" />
							Upload
							<input
								type="file"
								class="psu-visually-hidden"
								multiple
								disabled={full}
								onChange={onFileInput}
							/>
						</label>
					</div>
				</DropZone>

				{full && <Note>That is the limit — remove one to attach another.</Note>}
			</Field>

			<AssetPicker
				requesterId={ATTACHMENT_PICKER}
				onPick={(assets: AssetItem[]) =>
					addAttachments(
						assets.map((a) => ({ id: a.id, name: a.name, sizeBytes: a.sizeBytes ?? null })),
					)}
			/>
		</Section>
	);
}
// #endregion

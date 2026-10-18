import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Button, FileUpload, type UploadControls, type UploadFile } from "@projective/ui/fields";
import { ProgressBar, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	CONTACT_ATTACHMENT_ACCEPT,
	CONTACT_ATTACHMENT_MAX_BYTES,
	CONTACT_ATTACHMENT_MAX_FILES,
	CONTACT_ATTACHMENT_PHASE_LABEL,
	contactAttachmentLimitsText,
	type ContactAttachmentPhase,
	contactAttachmentProblem,
	formatBytes,
	mimeFromName,
} from "@projective/types/contact";
import { putToTicket } from "@features/files/core/MediaService.ts";
import { ContactService } from "../core/ContactService.ts";
import type { AttachmentEntry } from "../core/contact-model.ts";

/**
 * AttachmentDropzone — a `/contact` request's files (Decision #276), on the package `FileUpload`'s
 * drag-and-drop zone with this surface's own rows.
 *
 * Each file walks the files pipeline's states and the row shows exactly the state the server is in:
 * **Uploading** with a determinate progress bar (the browser's PUT to the signed URL, byte by byte),
 * **Checking the file** while the server's complete step sniffs and promotes it (`scanning`), then
 * **Ready** — or **Not attached** with the reason (a program, a web page, a type the bucket does not
 * take, too large). A file is checked against the bucket's limits before a byte moves; the limits are
 * printed above the zone. Remove takes a file off the request (an icon-only button with its name in
 * the label and a tooltip). The parent reads {@link AttachmentEntry} phases to know when the request
 * can be sent and which ids to send.
 */

export type { AttachmentEntry };

/** Props for {@link AttachmentDropzone}. */
export interface AttachmentDropzoneProps {
	/** The entries, owned by the intake so a submit can read them. */
	entries: Signal<Record<string, AttachmentEntry>>;
	/** The id of the visible label above the zone. */
	labelId: string;
	/** Disable the zone (while the request is being sent). */
	disabled?: boolean;
}

const PHASE_ICON: Partial<
	Record<ContactAttachmentPhase, "success" | "error" | "hourglass" | "upload">
> = {
	ready: "success",
	refused: "error",
	scanning: "hourglass",
	uploading: "upload",
};

export function AttachmentDropzone(props: AttachmentDropzoneProps): JSX.Element {
	const { entries, labelId, disabled } = props;

	const setEntry = (key: string, entry: AttachmentEntry | null) => {
		const next = { ...entries.value };
		if (entry) next[key] = entry;
		else delete next[key];
		entries.value = next;
	};

	async function upload(file: UploadFile, controls: UploadControls): Promise<void> {
		const live = Object.entries(entries.value).filter(([key, e]) =>
			key !== file.id && e.phase !== "refused"
		);
		if (live.length >= CONTACT_ATTACHMENT_MAX_FILES) {
			const message = `Attach at most ${CONTACT_ATTACHMENT_MAX_FILES} files to one request.`;
			setEntry(file.id, { phase: "refused", message });
			throw new Error(message);
		}
		const type = file.file.type || mimeFromName(file.file.name) || "";
		const problem = contactAttachmentProblem({ name: file.file.name, type, size: file.file.size });
		if (problem) {
			setEntry(file.id, { phase: "refused", message: problem });
			throw new Error(problem);
		}

		setEntry(file.id, { phase: "uploading" });
		controls.setProgress(0);
		const ticket = await ContactService.initAttachment({
			name: file.file.name,
			mimeType: type,
			sizeBytes: file.file.size,
		});
		if (!ticket.ok || !ticket.data) {
			const message = ticket.message ?? "This file couldn't be attached. Try again.";
			setEntry(file.id, { phase: "refused", message });
			throw new Error(message);
		}
		if (ticket.data.signedUrl) {
			const sent = await putToTicket(
				{
					assetId: ticket.data.attachmentId,
					signedUrl: ticket.data.signedUrl,
					headers: ticket.data.headers,
					expiresAt: ticket.data.expiresAt,
				},
				file.file,
				(fraction) => controls.setProgress(Math.round(fraction * 100)),
			);
			if (!sent) {
				const message = "The upload didn't finish. Try again.";
				setEntry(file.id, { phase: "refused", message });
				throw new Error(message);
			}
		}
		controls.setProgress(100);

		setEntry(file.id, { phase: "scanning" });
		const done = await ContactService.completeAttachment(ticket.data.attachmentId);
		if (!done.ok || !done.data) {
			const message = done.message ?? "This file couldn't be attached.";
			setEntry(file.id, { phase: "refused", message });
			throw new Error(message);
		}
		setEntry(file.id, { phase: "ready", attachmentId: done.data.id });
	}

	return (
		<div class="ctc-drop">
			<p class="ctc-drop__label" id={labelId}>Attachments (optional)</p>
			<p class="ctc-drop__limits" id={`${labelId}-limits`}>{contactAttachmentLimitsText()}</p>
			<FileUpload
				mode="advanced"
				multiple
				auto
				accept={CONTACT_ATTACHMENT_ACCEPT}
				maxFileSize={CONTACT_ATTACHMENT_MAX_BYTES}
				disabled={disabled}
				aria-label="Attach files"
				customUpload={upload}
				onRemove={(file) => setEntry(file.id, null)}
				headerTemplate={() => <span hidden />}
				emptyTemplate={() => (
					<span class="ui-file-upload__zone-hint">
						<Icon name="upload" class="ui-file-upload__zone-icon" />
						Drag files here, or choose them
					</span>
				)}
				itemTemplate={(file, ctx) => {
					const entry = entries.value[file.id];
					const phase: ContactAttachmentPhase = entry?.phase ??
						(file.status === "error" ? "refused" : "queued");
					const glyph = PHASE_ICON[phase];
					const why = entry?.message ?? file.error;
					return (
						<li key={file.id} class="ctc-drop__item">
							<span class="ctc-drop__name">{file.file.name}</span>
							<span class="ctc-drop__meta">
								<span>{formatBytes(file.file.size)}</span>
								<span class="ctc-drop__sep" aria-hidden="true">·</span>
								<span class="ctc-drop__state" data-phase={phase}>
									{glyph && <Icon name={glyph} />}
									{CONTACT_ATTACHMENT_PHASE_LABEL[phase]}
								</span>
							</span>
							<span class="ctc-drop__remove">
								<Tooltip content={`Remove ${file.file.name}`}>
									<Button
										type="button"
										variant="text"
										severity="secondary"
										size="sm"
										iconOnly
										icon={<Icon name="close" />}
										aria-label={`Remove ${file.file.name}`}
										disabled={disabled || phase === "uploading" || phase === "scanning"}
										onClick={() => ctx.remove(file.id)}
									/>
								</Tooltip>
							</span>
							{phase === "uploading" && (
								<ProgressBar
									class="ctc-drop__bar"
									value={file.progress}
									aria-label={`${file.file.name} upload progress`}
								/>
							)}
							{phase === "refused" && why && <p class="ctc-drop__why">{why}</p>}
						</li>
					);
				}}
			/>
		</div>
	);
}

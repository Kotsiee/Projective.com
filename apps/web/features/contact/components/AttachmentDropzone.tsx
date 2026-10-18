import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
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
 * printed above the zone and are the zone's accessible description.
 *
 * **Remove** takes a file off the request at any point but one: while it uploads, it cancels the PUT;
 * once the server knows the file, it takes it back there too (`discardAttachment` — the row and the
 * bytes go, so a file removed because it was the wrong document is not kept). Only during the brief
 * check is it unavailable, because the pipeline is promoting the file at that moment; the control
 * stays focusable and says why. The parent reads {@link AttachmentEntry} phases to know when the
 * request can be sent and which ids to send.
 */

export type { AttachmentEntry };

/** Props for {@link AttachmentDropzone}. */
export interface AttachmentDropzoneProps {
	/** The entries, owned by the intake so a submit can read them. */
	entries: Signal<Record<string, AttachmentEntry>>;
	/** The id of the visible label above the zone; `${labelId}-limits` is the limits line. */
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
	const limitsId = `${labelId}-limits`;
	/** Files the sender removed — an upload still running for one stops at its next step. */
	const removed = useMemo(() => new Set<string>(), []);
	/** The running PUT of each uploading file, so Remove can cancel it. */
	const puts = useMemo(() => new Map<string, AbortController>(), []);

	const setEntry = (key: string, entry: AttachmentEntry | null) => {
		const next = { ...entries.value };
		if (entry) next[key] = entry;
		else delete next[key];
		entries.value = next;
	};

	/** Remove: stop the upload, forget the row, and take the file back from the server if it has it. */
	function discard(file: UploadFile): void {
		removed.add(file.id);
		puts.get(file.id)?.abort();
		puts.delete(file.id);
		const entry = entries.value[file.id];
		setEntry(file.id, null);
		if (entry?.attachmentId) void ContactService.discardAttachment(entry.attachmentId);
	}

	async function upload(file: UploadFile, controls: UploadControls): Promise<void> {
		const gone = () => removed.has(file.id);
		if (gone()) return;
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
		if (gone()) {
			// Removed while the server was minting its ticket: take the declaration straight back.
			if (ticket.ok && ticket.data) void ContactService.discardAttachment(ticket.data.attachmentId);
			return;
		}
		if (!ticket.ok || !ticket.data) {
			const message = ticket.message ?? "This file couldn't be attached. Try again.";
			setEntry(file.id, { phase: "refused", message });
			throw new Error(message);
		}
		const attachmentId = ticket.data.attachmentId;
		setEntry(file.id, { phase: "uploading", attachmentId });
		if (ticket.data.signedUrl) {
			const abort = new AbortController();
			puts.set(file.id, abort);
			const sent = await putToTicket(
				{
					assetId: attachmentId,
					signedUrl: ticket.data.signedUrl,
					headers: ticket.data.headers,
					expiresAt: ticket.data.expiresAt,
				},
				file.file,
				(fraction) => controls.setProgress(Math.round(fraction * 100)),
				abort.signal,
			);
			puts.delete(file.id);
			if (gone()) return;
			if (!sent) {
				const message = "The upload didn't finish. Try again.";
				setEntry(file.id, { phase: "refused", attachmentId, message });
				throw new Error(message);
			}
		}
		if (gone()) return;
		controls.setProgress(100);

		setEntry(file.id, { phase: "scanning", attachmentId });
		const done = await ContactService.completeAttachment(attachmentId);
		if (gone()) {
			// Removed during the check (only possible by a race): take the finished file back too.
			void ContactService.discardAttachment(attachmentId);
			return;
		}
		if (!done.ok || !done.data) {
			const message = done.message ?? "This file couldn't be attached.";
			setEntry(file.id, { phase: "refused", attachmentId, message });
			throw new Error(message);
		}
		setEntry(file.id, { phase: "ready", attachmentId: done.data.id });
	}

	return (
		<div class="ctc-drop">
			<p class="ctc-drop__label" id={labelId}>Attachments (optional)</p>
			<p class="ctc-drop__limits" id={limitsId}>{contactAttachmentLimitsText()}</p>
			<FileUpload
				mode="advanced"
				multiple
				auto
				accept={CONTACT_ATTACHMENT_ACCEPT}
				maxFileSize={CONTACT_ATTACHMENT_MAX_BYTES}
				disabled={disabled}
				aria-label="Attach files (optional)"
				aria-describedby={limitsId}
				customUpload={upload}
				onRemove={discard}
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
					// The one moment Remove can't act: the pipeline is promoting the file right now.
					const checking = phase === "scanning";
					const tip = checking
						? `Checking ${file.file.name} — you can remove it in a moment`
						: `Remove ${file.file.name}`;
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
								<Tooltip content={tip}>
									<Button
										type="button"
										variant="text"
										severity="secondary"
										size="sm"
										iconOnly
										icon={<Icon name="close" />}
										aria-label={tip}
										aria-disabled={checking ? "true" : undefined}
										disabled={disabled}
										onClick={() => {
											if (!checking) ctx.remove(file.id);
										}}
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

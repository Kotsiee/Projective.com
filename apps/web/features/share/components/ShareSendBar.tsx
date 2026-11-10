import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import type { MessageAttachmentMode } from "@projective/types/projects";
import { Button, InputText, SelectButton } from "@projective/ui/fields";
import { HintPopover } from "@projective/ui/feedback";
import type { ShareFile } from "../core/share-mode.ts";
import { sendLabel } from "../core/share-select.ts";

/**
 * ShareSendBar — the "Send to…" footer (Decision #406), rendered only while somebody is chosen: an
 * optional note and **Send to {n}**, the surface's one fill (tier 3). A stored file adds Send a link ·
 * Send a copy above them (Decision #401). It slides in on `--ease-standard` (none under reduced
 * motion) and is drawn at rest, so a frame that never comes cannot hide it. The note goes out inside
 * each message, where the DM insert's own PII mask reads it like any other message.
 */

// #region Props
export interface ShareSendBarProps {
	count: number;
	note: Signal<string>;
	sending: boolean;
	error: string | null;
	onSend: () => void;
	file?: ShareFile;
	mode: Signal<MessageAttachmentMode>;
}
// #endregion

const NOTE_MAX = 1000;

const MODE_OPTIONS = [
	{ value: "link", label: "Send a link" },
	{ value: "copy", label: "Send a copy" },
];

const MODE_HINT = "A link opens your file, and setting it to Only you takes their access away. " +
	"A copy is theirs to keep and download.";

export function ShareSendBar(props: ShareSendBarProps): JSX.Element {
	return (
		<form
			class="share-send"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				if (!props.sending) props.onSend();
			}}
		>
			{props.file && (props.file.canLink
				? (
					<div class="share-send__mode">
						<SelectButton
							size="sm"
							options={MODE_OPTIONS}
							value={props.mode.value}
							aria-label="How to send this file"
							aria-describedby="share-mode-hint"
							onValueChange={(next) => (props.mode.value = next === "copy" ? "copy" : "link")}
						/>
						<HintPopover label="About sending a file">{MODE_HINT}</HintPopover>
						<span id="share-mode-hint" class="ui-visually-hidden">{MODE_HINT}</span>
					</div>
				)
				: (
					<p class="share-send__mode-note">Sent as a copy — this file isn't in your own library.</p>
				))}
			<div class="share-send__row">
				<InputText
					size="sm"
					class="share-send__note"
					value={props.note}
					placeholder="Add a note…"
					aria-label="Note with the link"
					maxLength={NOTE_MAX}
					disabled={props.sending}
					autoComplete="off"
					enterKeyHint="send"
				/>
				<Button
					type="submit"
					severity="primary"
					variant="filled"
					size="sm"
					label={sendLabel(props.count)}
					loading={props.sending}
					disabled={props.sending}
				/>
			</div>
			{props.error && <p class="share-send__error" role="alert">{props.error}</p>}
		</form>
	);
}

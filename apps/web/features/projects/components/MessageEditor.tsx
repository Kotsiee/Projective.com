import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/message-edit.css";
import { Button } from "@projective/ui/fields";
import {
	type MessageDelta,
	messageDeltaText,
	normalizeMessageDelta,
} from "@projective/types/projects";
import type { ChatMessage } from "../types/projects-types.ts";
import { useComposerEditor } from "../hooks/useComposerEditor.ts";
import { FormatBubble } from "./FormatBubble.tsx";

/**
 * MessageEditor — a sent message's words, edited where they stand (PROJECTS CH1). The bubble's body
 * becomes the same four-mark field the composer writes in ({@link useComposerEditor}, with the
 * {@link FormatBubble} over a selection), opened on the message's own words and formatting. Enter
 * saves and Shift+Enter breaks a line, as in the composer; Escape or Cancel leaves the message as it
 * was. Saving words that are all blank does nothing: an empty message is a delete, which has its own
 * confirmation.
 *
 * What is saved is normalised exactly as a send is (`normalizeMessageDelta`), so the door receives a
 * body and a Delta that agree; a draft with no marks saves plain (`delta: null`).
 */
export interface MessageEditorProps {
	message: ChatMessage;
	/** A save is in flight: the field stays, its Save shows the spinner. */
	saving: boolean;
	onSave: (text: string, delta: MessageDelta | null) => void;
	onCancel: () => void;
}

export function MessageEditor(props: MessageEditorProps): JSX.Element {
	const { message } = props;
	const editor = useComposerEditor({
		placeholder: "Edit your message",
		label: "Edit your message",
		onSubmit: () => save(),
		onEscape: () => {
			props.onCancel();
			return true;
		},
		onPaste: () => {},
		initialOps: message.delta?.ops ?? [{ insert: message.text }],
	});

	// Focus is a browser API: the field takes the caret at the end of the words once it mounts.
	useEffect(() => editor.focusEnd(), []);

	function save(): void {
		if (props.saving) return;
		const delta = normalizeMessageDelta(editor.ops());
		const text = delta ? messageDeltaText(delta) : "";
		if (text.trim().length === 0) return;
		const formatted = delta && delta.ops.some((op) => op.attributes) ? delta : null;
		props.onSave(text, formatted);
	}

	void editor.layoutTick.value;
	const formatRect = editor.range.value ? editor.selectionRect() : null;
	const blank = editor.ready.value && editor.text.value.trim().length === 0;

	return (
		<div class="msg-editor" data-msg-ui="true">
			<div
				ref={editor.hostRef}
				class="msg-editor__input"
				data-placeholder="Edit your message"
				data-ready="false"
			/>
			<div class="msg-editor__bar">
				<span class="msg-editor__hint">
					{blank ? "To take it back, delete the message instead." : "Enter to save · Esc to cancel"}
				</span>
				<span class="msg-editor__actions">
					<Button
						label="Cancel"
						severity="secondary"
						variant="text"
						size="sm"
						onClick={props.onCancel}
					/>
					<Button
						label="Save"
						size="sm"
						loading={props.saving}
						disabled={blank}
						onClick={save}
					/>
				</span>
			</div>
			{formatRect && (
				<FormatBubble
					rect={formatRect}
					marks={editor.marks.value}
					onToggle={(mark) => editor.toggleMark(mark)}
					onDismiss={() => (editor.range.value = null)}
				/>
			)}
		</div>
	);
}

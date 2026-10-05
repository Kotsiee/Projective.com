import type { JSX, RefObject } from "preact";
import type { ReadonlySignal, Signal } from "@preact/signals";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { PlusIcon, TrashIcon } from "../glyphs.tsx";
import {
	LibraryIcon,
	MicIcon,
	MicOffIcon,
	PauseIcon,
	ResumeIcon,
	SendIcon,
	StopIcon,
	UploadIcon,
} from "../composer-glyphs.tsx";
import type { AudioRecorderApi } from "../../hooks/useAudioRecorder.ts";
import type { VoiceGestureHandlers } from "./ComposerAudioRecorder.tsx";

/** The primary site sidebar the Plus popover must never slide under (edge-detection). */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

// #region Leading action
/** Props for {@link ComposerLeadingAction}. */
export interface ComposerLeadingActionProps {
	/** A voice memo holds the field — the control becomes Discard. */
	hasVoice: boolean;
	/** The Plus popover's open state. */
	plusOpen: Signal<boolean>;
	/** The tray is full — the Plus control is disabled. */
	atCapacity: boolean;
	/** Discard the voice memo (or the take in progress). */
	onDiscard: () => void;
	/** Open the hidden device file picker. */
	onUploadFromDevice: () => void;
	/** Open the Asset Picker over the viewer's library. */
	onAttachFromLibrary: () => void;
}

/** Left control — the Plus popover (Upload from Device · Attach from Library), or Discard while a voice memo is active. */
export function ComposerLeadingAction(
	{ hasVoice, plusOpen, atCapacity, onDiscard, onUploadFromDevice, onAttachFromLibrary }:
		ComposerLeadingActionProps,
): JSX.Element {
	return hasVoice
		? (
			<Tooltip content="Discard recording" placement="top">
				<button
					type="button"
					class="chat-composer__btn chat-composer__btn--ghost"
					aria-label="Discard recording"
					onClick={onDiscard}
				>
					{TrashIcon}
				</button>
			</Tooltip>
		)
		: (
			<Popover
				open={plusOpen}
				placement="top-start"
				avoid={SHELL_AVOID}
				allowOverflow={["top"]}
				class="chat-composer-pop"
				trigger={(api) => (
					<Tooltip content="Add attachment" placement="top">
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class="chat-composer__btn chat-composer__btn--ghost"
							aria-label="Add attachment"
							aria-haspopup="menu"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							disabled={atCapacity}
							onClick={api.toggle}
						>
							{PlusIcon}
						</button>
					</Tooltip>
				)}
			>
				<div class="chat-composer__menu" role="menu" aria-label="Add attachment">
					<button
						type="button"
						role="menuitem"
						class="chat-composer__menu-item"
						onClick={onUploadFromDevice}
					>
						<span class="chat-composer__menu-icon" aria-hidden="true">{UploadIcon}</span>
						<span>Upload from Device</span>
					</button>
					<button
						type="button"
						role="menuitem"
						class="chat-composer__menu-item"
						onClick={onAttachFromLibrary}
					>
						<span class="chat-composer__menu-icon" aria-hidden="true">{LibraryIcon}</span>
						<span>Attach from Library</span>
					</button>
				</div>
			</Popover>
		);
}
// #endregion

// #region Trailing action
/** Props for {@link ComposerTrailingAction}. */
export interface ComposerTrailingActionProps {
	/** The composer's recorder (phase + transport controls). */
	rec: AudioRecorderApi;
	/** The draft may be sent now. */
	canSend: boolean;
	/** The finished memo exceeds the upload ceiling. */
	oversize: boolean;
	/** The microphone is denied or unsupported. */
	micBlocked: boolean;
	/** A send is in flight. */
	sending: ReadonlySignal<boolean>;
	/** Send the draft. */
	onSend: () => void;
	/** The mic control's click-to-toggle / hold-to-talk handlers. */
	gestures: VoiceGestureHandlers;
}

/**
 * Right controls — Pause/Resume + Stop while capturing, Send when there's a draft, else Mic. Pause
 * sits between Cancel and the primary control, so the three recording actions read left-to-right in
 * the order they are reached.
 */
export function ComposerTrailingAction(
	{ rec, canSend, oversize, micBlocked, sending, onSend, gestures }: ComposerTrailingActionProps,
): JSX.Element {
	const phase = rec.phase.value;
	const capturing = phase === "recording" || phase === "paused";
	return phase === "requesting"
		? (
			<Tooltip content="Cancel" placement="top">
				<button
					type="button"
					class="chat-composer__btn chat-composer__btn--stop"
					data-paused="true"
					aria-label="Cancel recording"
					onClick={() => rec.discard()}
				>
					{StopIcon}
				</button>
			</Tooltip>
		)
		: capturing
		? (
			<>
				<Tooltip
					content={phase === "paused" ? "Resume recording" : "Pause recording"}
					placement="top"
				>
					<button
						type="button"
						class="chat-composer__btn chat-composer__btn--pause"
						aria-label={phase === "paused" ? "Resume recording" : "Pause recording"}
						onClick={() => (phase === "paused" ? rec.resume() : rec.pause())}
					>
						{phase === "paused" ? ResumeIcon : PauseIcon}
					</button>
				</Tooltip>
				<Tooltip content="Stop recording" placement="top">
					<button
						type="button"
						class="chat-composer__btn chat-composer__btn--stop"
						data-paused={phase === "paused" ? "true" : undefined}
						aria-label="Stop recording"
						onClick={() => rec.stop()}
					>
						{StopIcon}
					</button>
				</Tooltip>
			</>
		)
		: phase === "recorded" || canSend
		? (
			// A finished memo always shows Send, disabled when it is too large to upload.
			// Falling back to the Mic here would leave an enabled control that does nothing —
			// the press guard rejects a `recorded` phase — and hide the only correct action.
			<Tooltip
				content={sending.value ? "Sending…" : oversize ? "Too large to send" : "Send"}
				placement="top"
			>
				<button
					type="button"
					class="chat-composer__btn chat-composer__btn--send"
					aria-label={oversize ? "Send message — recording too large" : "Send message"}
					disabled={!canSend || sending.value}
					aria-busy={sending.value ? "true" : undefined}
					onClick={onSend}
				>
					{SendIcon}
				</button>
			</Tooltip>
		)
		: (
			<Tooltip
				content={micBlocked
					? "Microphone unavailable"
					: "Hold to talk · click to record · Ctrl+Space"}
				placement="top"
			>
				<button
					type="button"
					class="chat-composer__btn chat-composer__btn--mic"
					data-blocked={micBlocked ? "true" : undefined}
					aria-label={micBlocked ? "Microphone unavailable — why?" : "Record a voice message"}
					onPointerDown={gestures.onMicPointerDown}
					onPointerUp={gestures.onMicPointerUp}
					onPointerCancel={gestures.onMicPointerCancel}
					onPointerLeave={gestures.onMicPointerUp}
				>
					{micBlocked ? MicOffIcon : MicIcon}
				</button>
			</Tooltip>
		);
}
// #endregion

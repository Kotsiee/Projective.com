import { cloneElement, type JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Message, useToast } from "@projective/ui/feedback";
import { MicOffIcon } from "../composer-glyphs.tsx";
import type { AudioRecorderApi } from "../../hooks/useAudioRecorder.ts";
import type { RecorderError } from "../../types/composer-types.ts";
import type { SendFailure } from "./composer-send.ts";

/** Failures about microphone *access* rather than the take itself — these carry the struck-mic mark. */
const PERMISSION_KINDS: ReadonlySet<RecorderError["kind"]> = new Set([
	"blocked",
	"denied",
	"unsupported",
	"no_device",
	"in_use",
	"device_lost",
]);

// #region Inline notices
/** Props for {@link ComposerCaptureNotice}. */
export interface ComposerCaptureNoticeProps {
	/** The composer's recorder; its structured `error` is what renders. */
	rec: AudioRecorderApi;
}

/**
 * Capture failures, inline beside the control that produced them. Recovery steps appear only for a
 * persisted block, where pressing the mic again would do nothing at all.
 */
export function ComposerCaptureNotice({ rec }: ComposerCaptureNoticeProps): JSX.Element | null {
	const err = rec.error.value;
	if (!err) return null;
	return (
		<div class="chat-composer__notice">
			<Message
				severity={err.kind === "too_large" || err.kind === "failed" ? "danger" : "warning"}
				variant="subtle"
				size="sm"
				icon={PERMISSION_KINDS.has(err.kind) ? MicOffIcon : undefined}
				closable
				onClose={() => rec.clearError()}
			>
				<span class="chat-composer__notice-body">
					<span class="chat-composer__notice-title">{err.title}</span>
					{err.detail && <span class="chat-composer__notice-detail">{err.detail}</span>}
					{err.help && <span class="chat-composer__notice-help">{err.help}</span>}
				</span>
			</Message>
		</div>
	);
}

/** Props for {@link ComposerSendNotice}. */
export interface ComposerSendNoticeProps {
	/** Why the last send did not land; the notice renders nothing while it is null. */
	sendError: Signal<SendFailure | null>;
}

/**
 * A send that did not land, stated where the Send button is rather than in a corner toast — and
 * never a silent drop, because the message still looks written.
 */
export function ComposerSendNotice({ sendError }: ComposerSendNoticeProps): JSX.Element | null {
	const failure = sendError.value;
	if (!failure) return null;
	return (
		<div class="chat-composer__notice">
			<Message
				severity="danger"
				variant="subtle"
				size="sm"
				closable
				onClose={() => (sendError.value = null)}
			>
				<span class="chat-composer__notice-body">
					<span class="chat-composer__notice-title">{failure.title}</span>
					{failure.detail && <span class="chat-composer__notice-detail">{failure.detail}</span>}
				</span>
			</Message>
		</div>
	);
}
// #endregion

// #region Toast-mode notices
/**
 * In `toast` mode every failure is handed to the shared stack and then cleared here, so the
 * inline notice never renders for it. The recorder's structured error is passed on whole — title,
 * cause and the browser-specific recovery steps — and a permission-class failure carries the same
 * struck-mic mark the inline notice would. Cleared AFTER it is shown, not instead: the hook keeps
 * the mic control's `data-blocked` state from `permission`, which this does not touch.
 */
export function useComposerToasts(
	notices: "inline" | "toast",
	rec: AudioRecorderApi,
	sendError: Signal<SendFailure | null>,
): void {
	const toast = useToast();

	const capture = rec.error.value;
	useEffect(() => {
		if (notices !== "toast" || !capture) return;
		toast.show({
			severity: capture.kind === "too_large" || capture.kind === "failed" ? "danger" : "warning",
			summary: capture.title,
			detail: [capture.detail, capture.help].filter(Boolean).join(" "),
			// A CLONE, never the module constant: the mic button may be drawing the same struck-mic
			// VNode at this moment, and one VNode mounted in two trees is the Preact reuse hazard.
			icon: PERMISSION_KINDS.has(capture.kind) ? cloneElement(MicOffIcon) : undefined,
			life: capture.help ? 9000 : 5000,
		});
		rec.clearError();
	}, [capture]);

	const failed = sendError.value;
	useEffect(() => {
		if (notices !== "toast" || !failed) return;
		toast.show({
			severity: "danger",
			summary: failed.title,
			detail: failed.detail,
			life: 6000,
		});
		sendError.value = null;
	}, [failed]);
}
// #endregion

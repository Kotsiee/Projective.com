/// <reference lib="dom" />
import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { EmojiPicker } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { ChatSurface } from "@web/utils/lane-events.ts";
import { ownsKeys } from "../../core/chat-keyboard.ts";
import type { ComposerEditor } from "../../hooks/useComposerEditor.ts";

/** The primary site sidebar the picker must never slide under (edge-detection). */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

/** Props for {@link ComposerEmojiAction}. */
export interface ComposerEmojiActionProps {
	/** The composer's message field — the picker inserts at its saved caret. */
	editor: ComposerEditor;
	/** Which chat surface owns the shortcut when focus is outside the composer. */
	surface: ChatSurface;
	/** The composer root: the shortcut always works while focus is inside it. */
	composerRef: RefObject<HTMLElement>;
}

function isApplePlatform(): boolean {
	const nav = globalThis.navigator;
	return !!nav && /Mac|iPhone|iPad|iPod/.test(nav.platform || nav.userAgent);
}

/**
 * The composer's emoji control: an icon-only ghost button beside the Mic/Send control that opens the
 * {@link EmojiPicker}, plus ⌘E / Ctrl+E to toggle it. The field's caret is saved as the picker
 * opens, every pick lands there (replacing a highlighted range) and advances it, and Escape or
 * Backspace on an empty search returns focus to the field at that caret.
 *
 * The shortcut is taken while focus is in the composer or the picker, or anywhere the composer's
 * surface owns typing (`ownsKeys`). On Apple platforms it is ⌘E only: Ctrl+E is "end of line" in
 * every macOS text field.
 */
export function ComposerEmojiAction(
	{ editor, surface, composerRef }: ComposerEmojiActionProps,
): JSX.Element {
	const open = useSignal(false);
	const panelRef = useRef<HTMLDivElement>(null);
	const appleSignal = useSignal(false);
	const apple = appleSignal.value;
	const shortcut = apple ? "⌘E" : "Ctrl+E";

	useEffect(() => {
		appleSignal.value = isApplePlatform();
	}, []);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (event.defaultPrevented || event.altKey || event.shiftKey) return;
			const mac = appleSignal.value;
			const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
			if (!modifier || event.key.toLowerCase() !== "e") return;
			const active = event.target instanceof Element ? event.target : document.activeElement;
			const inside = !!active &&
				(!!composerRef.current?.contains(active) || !!panelRef.current?.contains(active));
			if (!inside && !ownsKeys(surface, active)) return;
			event.preventDefault();
			if (open.value) {
				open.value = false;
				editor.focusAtCaret();
			} else {
				editor.saveCaret();
				open.value = true;
			}
		}
		globalThis.addEventListener("keydown", onKeyDown);
		return () => globalThis.removeEventListener("keydown", onKeyDown);
	}, [surface]);

	return (
		<EmojiPicker
			open={open}
			placement="top-end"
			avoid={SHELL_AVOID}
			allowOverflow={["top"]}
			panelRef={panelRef}
			onOpenChange={(next) => {
				if (next) editor.saveCaret();
			}}
			onSelect={(entry) => editor.insertAtCaret(entry.emoji)}
			onReturnFocus={() => editor.focusAtCaret()}
			trigger={(api) => (
				<Tooltip content={`Emoji · ${shortcut}`} placement="top">
					<button
						type="button"
						ref={api.ref as RefObject<HTMLButtonElement>}
						class="chat-composer__btn chat-composer__btn--ghost"
						aria-label="Insert emoji"
						aria-haspopup="dialog"
						aria-expanded={api.expanded}
						aria-controls={api.panelId}
						aria-keyshortcuts={apple ? "Meta+E" : "Control+E"}
						onClick={api.toggle}
					>
						<Icon name="smile" />
					</button>
				</Tooltip>
			)}
		/>
	);
}

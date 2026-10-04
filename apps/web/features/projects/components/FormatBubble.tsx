import type { JSX } from "preact";
import "../styles/message-interactions.css";
import { BodyPortal } from "@projective/ui/overlay";
import type { MessageMark } from "@projective/types/projects";

/**
 * FormatBubble — the glass bubble that floats directly above highlighted text in the composer:
 * Bold · Italic · Strikethrough · Underline, each a toggle reflecting the marks already on the
 * selection.
 *
 * Glass by the product owner's direction (Decision #131, a scoped extension of DESIGN_SYSTEM.md
 * §B.4.3): the bubble hangs over the conversation, and the words being formatted stay legible through
 * it. The blur sits on a `::before` underlay and falls back to an opaque fill. Portalled to
 * `document.body` and fixed to the selection's on-screen box, so the composer's sticky band and the
 * frame around it can neither clip nor re-base it.
 *
 * Pointer-first by design: a press is taken on `pointerdown` with the default prevented, so the
 * editor keeps its focus and its selection while the mark is applied. Keyboard users have the same
 * four marks on Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+Shift+X without leaving the field — which is why the
 * buttons stay out of the tab order rather than becoming a stop that pulls focus off the text.
 */

export interface FormatBubbleProps {
	/** The selection's box in viewport pixels. */
	rect: { left: number; top: number; width: number };
	marks: Record<MessageMark, boolean>;
	onToggle: (mark: MessageMark) => void;
}

interface MarkButton {
	mark: MessageMark;
	label: string;
	shortcut: string;
	keys: string;
	glyph: string;
}

/** In the order the request lists them: Bold, Italic, Strikethrough, Underline. */
const BUTTONS: readonly MarkButton[] = [
	{ mark: "bold", label: "Bold", shortcut: "Ctrl+B", keys: "Control+B", glyph: "B" },
	{ mark: "italic", label: "Italic", shortcut: "Ctrl+I", keys: "Control+I", glyph: "I" },
	{
		mark: "strike",
		label: "Strikethrough",
		shortcut: "Ctrl+Shift+X",
		keys: "Control+Shift+X",
		glyph: "S",
	},
	{ mark: "underline", label: "Underline", shortcut: "Ctrl+U", keys: "Control+U", glyph: "U" },
];

export function FormatBubble({ rect, marks, onToggle }: FormatBubbleProps): JSX.Element {
	const x = rect.left + rect.width / 2;
	return (
		<BodyPortal>
			<div
				class="msg-glass msg-format"
				role="toolbar"
				aria-label="Text formatting"
				data-msg-ui="true"
				style={{ "--glass-x": `${x}px`, "--glass-y": `${rect.top}px` }}
			>
				{BUTTONS.map((b) => (
					<button
						key={b.mark}
						type="button"
						class="msg-format__btn"
						data-mark={b.mark}
						aria-label={b.label}
						aria-pressed={marks[b.mark]}
						aria-keyshortcuts={b.keys}
						title={`${b.label} (${b.shortcut})`}
						tabIndex={-1}
						onPointerDown={(e) => {
							e.preventDefault();
							onToggle(b.mark);
						}}
						onClick={(e) => {
							// A pointer press already toggled on `pointerdown`; a synthetic or
							// assistive-tech activation arrives as a click with no pointer before it.
							if (e.detail === 0) onToggle(b.mark);
						}}
					>
						<span class="msg-format__glyph" aria-hidden="true">{b.glyph}</span>
					</button>
				))}
			</div>
		</BodyPortal>
	);
}

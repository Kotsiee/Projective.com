import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useLayoutEffect, useRef } from "preact/hooks";
import "../styles/message-interactions.css";
import { BodyPortal } from "@projective/ui/overlay";
import { QUICK_EMOJI } from "./MessageActions.tsx";

/**
 * ReactionBubble — the reaction row a long press on a message raises on touch.
 *
 * Glass, like the composer's formatting bubble: both float over the conversation itself, and the
 * reader is meant to see the message they are acting on through it (Decision #131 — the product
 * owner's scoped extension of DESIGN_SYSTEM.md §B.4.3; the blur sits on a `::before` underlay and
 * falls back to an opaque fill). Centred above the held message's bubble, or below it when the
 * message is too close to the top of the screen; portalled so the blurred rows around it cannot blur
 * it too.
 */

export interface ReactionBubbleProps {
	/** The held message's id. */
	messageId: string;
	/** The surface root the message row is in. */
	rootRef: RefObject<HTMLElement>;
	onReact: (emoji: string) => void;
}

/** Room kept between the bubble, the message and the viewport edge (px). */
const GAP = 8;

export function ReactionBubble({ messageId, rootRef, onReact }: ReactionBubbleProps): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	const pos = useSignal<{ x: number; y: number } | null>(null);

	useLayoutEffect(() => {
		function place(): void {
			const row = rootRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
			const anchor = row?.querySelector(".msg-bubble")?.getBoundingClientRect();
			// Clear the whole message block (the sender line above the bubble included), not just the
			// bubble, so the name of whoever is being reacted to stays readable.
			const block = row?.querySelector(".msg-row__main")?.getBoundingClientRect() ?? anchor;
			const el = ref.current;
			if (!anchor || !block || !el) return;
			const w = el.offsetWidth;
			const h = el.offsetHeight;
			const vw = globalThis.innerWidth;
			const x = Math.max(GAP, Math.min(anchor.left + anchor.width / 2 - w / 2, vw - w - GAP));
			const above = block.top - GAP - h;
			pos.value = { x, y: above >= GAP ? above : block.bottom + GAP };
		}
		place();
		globalThis.addEventListener("scroll", place, true);
		globalThis.addEventListener("resize", place);
		return () => {
			globalThis.removeEventListener("scroll", place, true);
			globalThis.removeEventListener("resize", place);
		};
	}, [messageId]);

	const p = pos.value;
	return (
		<BodyPortal>
			<div
				ref={ref}
				class="msg-glass msg-reactbubble"
				role="menu"
				aria-label="React to message"
				data-msg-ui="true"
				data-placed={p ? "true" : undefined}
				style={p ? { "--glass-x": `${p.x}px`, "--glass-y": `${p.y}px` } : undefined}
			>
				{QUICK_EMOJI.map((emoji) => (
					<button
						key={emoji}
						type="button"
						role="menuitem"
						class="msg-reactbubble__emoji"
						aria-label={`React with ${emoji}`}
						onClick={() => onReact(emoji)}
					>
						{emoji}
					</button>
				))}
			</div>
		</BodyPortal>
	);
}

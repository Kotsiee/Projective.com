import type { JSX } from "preact";
import { cloneElement } from "preact";
import { useSignal } from "@preact/signals";
import type { ChatMessage } from "../types/projects-types.ts";
import { PinIcon } from "./channel-glyphs.tsx";
import { ChevronLeftIcon, ChevronRightIcon, CollapseIcon, ExpandIcon } from "./chat-glyphs.tsx";

/**
 * PinnedBanner — the sticky pinned-messages header (task §5). Up to 3 pins are shown ONE AT A TIME as a
 * collapsed single line, ordered by recency (the backend delivers them most-recent-first). Chevron
 * `‹` / `›` controls loop through them manually; an Expand toggle reveals a pin that exceeds one line;
 * clicking the pin text smoothly scrolls the feed to that message (`onJump`) AND cycles the banner to
 * the next pin. Sticks just beneath the channel header band under the native window scroll.
 */

export interface PinnedBannerProps {
	pinned: ChatMessage[];
	/** Smoothly scroll the feed to a pinned message by id. */
	onJump: (id: string) => void;
}

/** A one-line preview of a pinned message — its text, or a media/audio stand-in, prefixed by author. */
function previewOf(m: ChatMessage): string {
	const who = m.isOwn ? "You" : m.sender?.name ?? "";
	let body = m.text.trim();
	if (!body) {
		if (m.audio) body = "Voice message";
		else if (m.attachments.length > 0) {
			body = `${m.attachments.length} attachment${m.attachments.length > 1 ? "s" : ""}`;
		} else body = "Message";
	}
	return who ? `${who}: ${body}` : body;
}

export function PinnedBanner({ pinned, onJump }: PinnedBannerProps): JSX.Element | null {
	const index = useSignal(0);
	const expanded = useSignal(false);
	if (pinned.length === 0) return null;

	const count = pinned.length;
	const i = index.value % count;
	const current = pinned[i];

	function cycle(delta: number): void {
		index.value = (index.value + delta + count) % count;
		expanded.value = false;
	}

	function jump(): void {
		onJump(current.id);
		if (count > 1) cycle(1); // clicking a pin also advances the banner to the next
	}

	return (
		<div class="chat-pinned" data-expanded={expanded.value ? "true" : undefined}>
			<span class="chat-pinned__icon" aria-hidden="true">{cloneElement(PinIcon)}</span>

			<button
				type="button"
				class="chat-pinned__body"
				onClick={jump}
				aria-label="Jump to pinned message"
			>
				<span class="chat-pinned__label">
					Pinned{count > 1 ? ` ${i + 1}/${count}` : ""}
				</span>
				<span class="chat-pinned__text" data-expanded={expanded.value ? "true" : undefined}>
					{previewOf(current)}
				</span>
			</button>

			<div class="chat-pinned__controls">
				{count > 1 && (
					<>
						<button
							type="button"
							class="chat-pinned__nav"
							aria-label="Previous pinned message"
							onClick={() => cycle(-1)}
						>
							{cloneElement(ChevronLeftIcon)}
						</button>
						<button
							type="button"
							class="chat-pinned__nav"
							aria-label="Next pinned message"
							onClick={() => cycle(1)}
						>
							{cloneElement(ChevronRightIcon)}
						</button>
					</>
				)}
				<button
					type="button"
					class="chat-pinned__nav"
					aria-label={expanded.value ? "Collapse pinned message" : "Expand pinned message"}
					aria-pressed={expanded.value}
					onClick={() => (expanded.value = !expanded.value)}
				>
					{expanded.value ? cloneElement(CollapseIcon) : cloneElement(ExpandIcon)}
				</button>
			</div>
		</div>
	);
}

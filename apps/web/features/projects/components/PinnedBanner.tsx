import type { JSX } from "preact";
import { cloneElement } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import type { ChatMessage } from "../types/projects-types.ts";
import { PinIcon } from "./channel-glyphs.tsx";
import { CloseIcon } from "./glyphs.tsx";
import { ChevronLeftIcon, ChevronRightIcon, LocateIcon, UnpinIcon } from "./chat-glyphs.tsx";

/**
 * PinnedBanner — the sticky pinned-messages header (task §5). Up to 3 pins are shown ONE AT A TIME,
 * ordered by recency (the backend delivers them most-recent-first): a title line ("Pinned message",
 * with "2 of 3" when there are several) over a one-line preview. Clicking the preview — or the
 * Go to message control — smoothly scrolls the feed to that message (`onJump`) AND cycles the banner
 * to the next pin; `‹` / `›` loop through them by hand. Unpin (for members who may pin) and Close sit
 * at the end. Close hides the banner until the set of pins changes. Sticks just beneath the channel
 * header band under the native window scroll.
 */

export interface PinnedBannerProps {
	pinned: ChatMessage[];
	/** Whether the viewer may pin — gates the Unpin control. */
	canPin: boolean;
	/** Smoothly scroll the feed to a pinned message by id. */
	onJump: (id: string) => void;
	/** Unpin a message for the whole room. */
	onUnpin: (id: string) => void;
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

/** One of the banner's icon controls — the design-system text Button, with its label as a tooltip. */
function Control(
	{ label, icon, onClick }: { label: string; icon: JSX.Element; onClick: () => void },
): JSX.Element {
	return (
		<Tooltip content={label} placement="bottom">
			<Button
				variant="text"
				severity="secondary"
				size="sm"
				iconOnly
				icon={cloneElement(icon)}
				aria-label={label}
				onClick={onClick}
			/>
		</Tooltip>
	);
}

export function PinnedBanner(
	{ pinned, canPin, onJump, onUnpin }: PinnedBannerProps,
): JSX.Element | null {
	const index = useSignal(0);
	/** The pin set the reader closed the banner on; a new or removed pin brings it back. */
	const closedFor = useSignal<string | null>(null);
	const pinKey = pinned.map((m) => m.id).join(",");
	if (pinned.length === 0 || closedFor.value === pinKey) return null;

	const count = pinned.length;
	const i = index.value % count;
	const current = pinned[i];

	function cycle(delta: number): void {
		index.value = (index.value + delta + count) % count;
	}

	function jump(): void {
		onJump(current.id);
		if (count > 1) cycle(1); // going to a pin also advances the banner to the next
	}

	return (
		<div class="chat-pinned" role="region" aria-label="Pinned messages">
			<span class="chat-pinned__icon" aria-hidden="true">{cloneElement(PinIcon)}</span>

			<button type="button" class="chat-pinned__body" onClick={jump}>
				<span class="chat-pinned__title">
					Pinned message
					{count > 1 && <span class="chat-pinned__count">{` · ${i + 1} of ${count}`}</span>}
				</span>
				<span class="chat-pinned__text">{previewOf(current)}</span>
			</button>

			<div class="chat-pinned__controls">
				{count > 1 && (
					<>
						<Control
							label="Previous pinned message"
							icon={ChevronLeftIcon}
							onClick={() => cycle(-1)}
						/>
						<Control label="Next pinned message" icon={ChevronRightIcon} onClick={() => cycle(1)} />
					</>
				)}
				<Control label="Go to message" icon={LocateIcon} onClick={jump} />
				{canPin && (
					<Control
						label="Unpin message"
						icon={UnpinIcon}
						onClick={() => onUnpin(current.id)}
					/>
				)}
				<Control
					label="Close pinned messages"
					icon={CloseIcon}
					onClick={() => (closedFor.value = pinKey)}
				/>
			</div>
		</div>
	);
}

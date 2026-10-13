import type { JSX } from "preact";
import { type Signal, useComputed, useSignal } from "@preact/signals";
import { type LightboxMedia, MediaLightbox } from "@features/view/components/MediaLightbox.tsx";
import type { ChatPreviewRequest } from "./ChatAttachmentPreview.tsx";

/** Props for {@link ChatImageLightbox}. */
export interface ChatImageLightboxProps {
	/** The feed's open request; cleared on close. */
	request: Signal<ChatPreviewRequest | null>;
	/** The requested message's pictures. */
	gallery: readonly LightboxMedia[];
	/** The picture it opens on. */
	startIndex: number;
	/** The sender's name, the gallery's accessible name. */
	title: string;
}

/**
 * A chat message's pictures in the shared lightbox. Keyed by its request, so each open starts on
 * the tile that was pressed.
 */
export function ChatImageLightbox(
	{ request, gallery, startIndex, title }: ChatImageLightboxProps,
): JSX.Element | null {
	const open = useComputed(() => request.value !== null);
	const active = useSignal(startIndex);
	return (
		<MediaLightbox
			open={open}
			active={active}
			gallery={gallery}
			title={title}
			onClose={() => (request.value = null)}
		/>
	);
}

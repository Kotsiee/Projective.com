import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { ConfirmDialog } from "@projective/ui/feedback";
import { reorderedPositions, type ShowcaseGridSlot } from "@projective/ui/display";
import { ShowcaseSlots } from "@features/files/components/showcase/ShowcaseSlots.tsx";
import type { MediaCropChoice } from "@features/files/core/media/media-pick.ts";
import type { ListingDetail, ListingMediaSlot, MediaChoice } from "../../types/catalogue-types.ts";
import {
	applyMedia,
	draft,
	removeMedia,
	reorderMedia,
	setMediaAlt,
} from "../../core/workspace-store.ts";
import { EditSectionFrame } from "./EditSectionFrame.tsx";
import { AltTextDialog } from "./AltTextDialog.tsx";

function gridSlot(slot: ListingMediaSlot): ShowcaseGridSlot {
	return {
		position: slot.position,
		kind: slot.kind,
		thumb: slot.thumb,
		alt: slot.alt,
		placeholder: slot.placeholder
			? { blurhash: slot.placeholder.blurhash, color: slot.placeholder.color ?? null }
			: null,
		pending: slot.pending,
	};
}

function mediaChoices(choices: MediaCropChoice[]): MediaChoice[] {
	return choices.flatMap((c) =>
		c.position
			? [{ sourceAssetId: c.sourceAssetId, position: c.position, alt: c.alt ?? "", crop: c.crop }]
			: []
	);
}

/**
 * MediaShowcaseSection — the listing's six-slot showcase, the same grid the profile uses: slot 1 is
 * the cover every card and search result leads with (always a still), slots 2–6 may hold video.
 * Every item comes from the seller's library through the media picker (no URL input). A slot's alt
 * text is edited in a small dialog; emptying a slot asks first, and emptying the cover promotes the
 * next still. A rendition still being cut shows as pending until the response says it is ready.
 */
export function MediaShowcaseSection(props: { listing: ListingDetail }): JSX.Element {
	const { listing } = props;
	const removing = useSignal<number | null>(null);
	const confirmOpen = useSignal(false);
	const describing = useSignal<number | null>(null);
	const slots = listing.media.map(gridSlot);

	return (
		<EditSectionFrame
			section="media"
			intro="Up to six pictures or videos. The first is the cover on cards and in search, so it is always a picture."
		>
			<ShowcaseSlots
				requesterId="catalogue-media"
				slots={slots}
				coverLabel="1 · Cover"
				coverName="cover"
				hero
				onSave={(choices) => applyMedia(mediaChoices(choices))}
				onRemove={(position) => {
					removing.value = position;
					confirmOpen.value = true;
				}}
				onReorder={(from, to) => void reorderMedia(reorderedPositions(slots, from, to))}
				onEditAlt={(position) => {
					describing.value = position;
				}}
			/>
			<AltTextDialog
				position={describing}
				altOf={(position) =>
					(draft.peek()?.media ?? listing.media).find((s) => s.position === position)?.alt ?? ""}
				onSave={setMediaAlt}
			/>
			<ConfirmDialog
				visible={confirmOpen}
				header="Empty this slot?"
				message={removing.value === 1
					? "The cover leaves this listing and the next picture takes its place. It stays in your library."
					: "It leaves this listing. It stays in your library, so you can put it back."}
				acceptLabel="Remove"
				rejectLabel="Keep"
				acceptSeverity="danger"
				onAccept={() => {
					const position = removing.peek();
					removing.value = null;
					if (position !== null) void removeMedia(position);
				}}
				onReject={() => (removing.value = null)}
			/>
		</EditSectionFrame>
	);
}

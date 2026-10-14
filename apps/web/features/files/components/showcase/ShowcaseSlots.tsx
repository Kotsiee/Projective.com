import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { ShowcaseGrid, type ShowcaseGridSlot } from "@projective/ui/display";
import { MediaCropPicker } from "@web/features/files/components/media-crop/MediaCropPicker.tsx";
import type { MediaCropChoice } from "@web/features/files/core/media/media-pick.ts";

/** Props for {@link ShowcaseSlots}. */
export interface ShowcaseSlotsProps {
	/** Unique per host on the page; keys the File Picker instance. */
	requesterId: string;
	slots: readonly ShowcaseGridSlot[];
	/** Apply the picked sources; resolve `null` to close the picker, or a sentence to keep it open. */
	onSave: (choices: MediaCropChoice[]) => Promise<string | null>;
	onRemove: (position: number) => void;
	/** A legal move — the grid has already refused a video onto slot 1. */
	onReorder: (from: number, to: number) => void;
	/** Edit a slot's alt text in the host's own UI; absent, the picker reopens seeded with it. */
	onEditAlt?: (position: number) => void;
	/** Slot 1's label, e.g. "1 · Thumbnail". */
	coverLabel?: string;
	/** What slot 1 is called in sentences, e.g. "thumbnail". */
	coverName?: string;
	/** The cover spans 2×2 from `--bp-lg` up. */
	hero?: boolean;
	disabled?: boolean;
}

/**
 * ShowcaseSlots — the six-slot showcase wired to the File Picker in media mode.
 *
 * `ShowcaseGrid` reports intent and this opens {@link MediaCropPicker} for it. Replacing a filled slot
 * picks one source, seeded with its alt text. Pressing an empty slot opens the picker for every empty
 * slot, the pressed one first, so filling a showcase is one pick. A video is allowed only when some
 * slot being filled is not slot 1. There is no URL input: every source comes from the library.
 */
export function ShowcaseSlots(props: ShowcaseSlotsProps): JSX.Element {
	const open = useSignal(false);
	const target = useSignal<{ positions: number[]; alt?: string }>({ positions: [] });

	const pick = (positions: number[], alt?: string) => {
		if (positions.length === 0) return;
		target.value = { positions, alt };
		open.value = true;
	};

	return (
		<>
			<ShowcaseGrid
				slots={props.slots}
				coverLabel={props.coverLabel}
				coverName={props.coverName}
				hero={props.hero}
				disabled={props.disabled}
				onAdd={(positions) => pick(positions)}
				onReplace={(position) =>
					pick([position], props.slots.find((s) => s.position === position)?.alt)}
				onEditAlt={props.onEditAlt ??
					((position) => pick([position], props.slots.find((s) => s.position === position)?.alt))}
				onRemove={props.onRemove}
				onReorder={props.onReorder}
			/>
			<MediaCropPicker
				open={open}
				requesterId={props.requesterId}
				target="showcase"
				positions={target.value.positions}
				initialAlt={target.value.alt}
				onSave={props.onSave}
			/>
		</>
	);
}

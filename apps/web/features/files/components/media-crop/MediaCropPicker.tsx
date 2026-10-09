import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import type { RenditionPurpose } from "@projective/types/files";
import AssetPicker from "../../islands/AssetPicker.island.tsx";
import type { MediaCropChoice, MediaPickConfig } from "../../core/media/media-pick.ts";

/**
 * MediaCropPicker — the File Picker opened in media mode for one rendition target: the profile
 * photo, the showcase, or a group conversation's photo. Mount it unconditionally beside the control
 * that opens it (the picker's stylesheet travels with it) and flip `open`.
 */
export interface MediaCropPickerProps {
	open: Signal<boolean>;
	/** Unique per host on the page. */
	requesterId: string;
	target: RenditionPurpose;
	/**
	 * The showcase slots to fill, in order of preference — one per choice allowed, so the empty slots
	 * when adding, or just the slot being replaced. Ignored for the other targets (one choice).
	 */
	positions?: number[];
	initialAlt?: string;
	/** Offer the sign-in account's picture (a person's own photo). */
	offerSignInPicture?: boolean;
	/** Default: "Profile photo" / "Showcase slot N" / "Add to your showcase". */
	title?: string;
	/** Default: "Save & apply". */
	saveLabel?: string;
	/** Apply the choices; resolve `null` to close, or a sentence to stay open and show it. */
	onSave: (choices: MediaCropChoice[]) => Promise<string | null>;
}

const IGNORE_ATTACH = (): void => {};

export function MediaCropPicker(props: MediaCropPickerProps): JSX.Element {
	const { target } = props;
	const positions = target === "showcase" ? props.positions ?? [1] : [];
	const config: MediaPickConfig = {
		target,
		allowVideo: positions.some((p) => p !== 1),
		max: Math.max(1, positions.length),
		positions,
		initialAlt: props.initialAlt,
		offerSignInPicture: props.offerSignInPicture ?? false,
		title: props.title ?? defaultTitle(target, positions),
		saveLabel: props.saveLabel ?? "Save & apply",
		onSave: props.onSave,
	};

	return (
		<AssetPicker
			requesterId={props.requesterId}
			open={props.open.value}
			onClose={() => (props.open.value = false)}
			onPick={IGNORE_ATTACH}
			media={config}
		/>
	);
}

function defaultTitle(target: RenditionPurpose, positions: number[]): string {
	if (target === "avatar") return "Profile photo";
	return positions.length > 1 ? "Add to your showcase" : `Showcase slot ${positions[0] ?? 1}`;
}

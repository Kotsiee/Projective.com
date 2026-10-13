import "../styles/lightbox.css";
import type { JSX } from "preact";
import type { ReadonlySignal, Signal } from "@preact/signals";
import { usePresence } from "@projective/ui/overlay";
import type { LightboxMedia } from "../types/lightbox-types.ts";
import { LightboxDialog } from "./lightbox/LightboxDialog.tsx";

export type { LightboxMedia } from "../types/lightbox-types.ts";

/**
 * MediaLightbox — the app's one full-screen media modal, shared by the Entity View media column, the
 * profile showcase and chat image attachments.
 *
 * The picture fits, zooms and pans against the whole viewport above a bottom thumbnail carousel; the
 * panel leaves the page through `BodyPortal`. It ships its own sheet (`lightbox.css`), so any island
 * that renders it carries the styles. `open` and `active` are Signals owned by the caller, so the
 * trigger and the modal address the same slot.
 */
export interface MediaLightboxProps {
	/** Whether the dialog is mounted. Owned by the caller so any trigger can open it. */
	open: ReadonlySignal<boolean> | Signal<boolean>;
	/** The active gallery index, shared with the caller's strip so the two never disagree. */
	active: Signal<number>;
	gallery: readonly LightboxMedia[];
	title: string;
	onClose: () => void;
}

export function MediaLightbox(
	{ open, active, gallery, title, onClose }: MediaLightboxProps,
): JSX.Element | null {
	const { mounted, state } = usePresence(open.value);
	if (!mounted || gallery.length === 0) return null;
	return (
		<LightboxDialog
			state={state}
			active={active}
			gallery={gallery}
			title={title}
			onClose={onClose}
		/>
	);
}

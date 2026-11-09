import type { ComponentChildren, JSX } from "preact";
import { usePictureFallback } from "../hooks/use-picture-fallback.ts";

/** Props for {@link FallbackPicture}. */
export interface FallbackPictureProps {
	src: string | null | undefined;
	/** Drawn in the picture's place when there is none, or once it fails. */
	fallback: ComponentChildren;
	class?: string;
	alt?: string;
	loading?: "lazy" | "eager";
	decoding?: "async" | "auto" | "sync";
	draggable?: boolean;
}

/**
 * FallbackPicture — an `<img>` that becomes `fallback` when it cannot load, and stays that way for
 * the rest of the page ({@link usePictureFallback}). For a small picture inside a list or a tray,
 * where a broken frame would otherwise stand in for the file's tile.
 */
export function FallbackPicture(props: FallbackPictureProps): JSX.Element {
	const picture = usePictureFallback(props.src);
	if (!picture.src) return <>{props.fallback}</>;
	return (
		<img
			ref={picture.ref}
			class={props.class}
			src={picture.src}
			alt={props.alt ?? ""}
			loading={props.loading}
			decoding={props.decoding}
			draggable={props.draggable}
			onError={picture.onError}
		/>
	);
}

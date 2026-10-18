/**
 * One item the shared media lightbox pages through. `EntityMedia` satisfies it as-is; the profile
 * showcase and chat attachments map onto it.
 */
export interface LightboxMedia {
	/**
	 * The full-resolution address the stage draws. One address, never a srcset: zoom is measured in
	 * the decoded picture's natural pixels, which a width-described candidate would rescale.
	 */
	src: string;
	/** The tray's thumbnail; the stage's `src` when absent. */
	thumb?: string;
	alt: string;
	/** A video plays in place and is never zoomed. */
	kind?: "image" | "video";
	/** A video's poster frame. */
	poster?: string;
	/**
	 * A caption shown under the stage and read as the dialog's description (the changelog's release
	 * pictures carry one); nothing renders without it.
	 */
	caption?: string;
}

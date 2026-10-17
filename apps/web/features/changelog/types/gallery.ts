/**
 * One release's pictures, as the changelog lightbox pages through them — the serialisable shape the
 * route hands the `ChangelogLightbox` island (built by `core/galleries.ts`).
 */
export interface ChangelogGallery {
	/** The release's anchor id — the `?image=` entry id (`v0-12-0`). */
	entry: string;
	/** The gallery's name, read as the dialog's label (`v0.12.0 — Funding before work`). */
	title: string;
	images: Array<{ src: string; alt: string; caption?: string }>;
}

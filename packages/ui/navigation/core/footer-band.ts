/** The custom property carrying the footer band's live height, published on `.ui-middle-nav`. */
export const FOOTER_BAND_HEIGHT_VAR = "--shell-midnav-footer-cur-h";

/**
 * Publishes the middle-nav footer band's live border-box height onto its frame as
 * {@link FOOTER_BAND_HEIGHT_VAR}, and keeps it current as the band's content resizes.
 *
 * The canvas surface is a viewport-fixed `::before` outside the band's subtree, so it can only end at
 * the band's top edge (and round its bottom corners there) by reading the band height from an
 * ancestor. The `--shell-midnav-footer-h` token is the band's floor, not its height: a chat composer
 * stands 90px tall and grows with its draft, which buried the canvas's bottom corners under the band.
 *
 * Returns a cleanup that disconnects the observer and removes the property. A no-op without a band.
 */
export function publishFooterBandHeight(root: ParentNode = document): () => void {
	const band = root.querySelector<HTMLElement>(".ui-middle-nav > .ui-middle-nav__footer");
	const frame = band?.parentElement;
	if (!band || !frame || typeof ResizeObserver === "undefined") return () => {};

	const publish = () => {
		frame.style.setProperty(FOOTER_BAND_HEIGHT_VAR, `${band.getBoundingClientRect().height}px`);
	};
	publish();
	const observer = new ResizeObserver(publish);
	observer.observe(band);
	return () => {
		observer.disconnect();
		frame.style.removeProperty(FOOTER_BAND_HEIGHT_VAR);
	};
}

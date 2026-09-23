import type { JSX } from "preact";
import "../styles/catalogue.css";
import { RetryIcon } from "../components/catalogue-glyphs.tsx";

/**
 * CatalogueUnavailable — the manage page's body when the listing could not be READ (as opposed to a
 * listing that is not the caller's, which redirects to the console). Saying "we couldn't reach it" and
 * offering the reload is the honest answer; bouncing the seller to the console would read as though
 * the listing had gone.
 *
 * An island only so the catalogue stylesheet reaches the page: on a failed read no other catalogue
 * island mounts to carry it.
 */
export default function CatalogueUnavailable(props: { message: string }): JSX.Element {
	return (
		<div class="cat-console">
			<div class="cat-state cat-state--error" role="alert">
				<span class="cat-state__glyph" aria-hidden="true">
					<RetryIcon size={28} />
				</span>
				<p class="cat-state__title">{props.message}</p>
				<p class="cat-state__note">Nothing was lost — this page just couldn't reach the listing.</p>
				<button type="button" class="cat-state__cta" onClick={() => globalThis.location?.reload()}>
					<RetryIcon size={16} /> Try again
				</button>
			</div>
		</div>
	);
}

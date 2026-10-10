import type { JSX } from "preact";
import { Logo } from "@web/components/Logo.tsx";

/** Props for {@link InspectorUnavailable}. */
export interface InspectorUnavailableProps {
	signedIn: boolean;
}

/**
 * The inspector's one answer for a file the viewer cannot open. It never says whether the file
 * exists: removed, private and mistyped all read the same.
 */
export function InspectorUnavailable({ signedIn }: InspectorUnavailableProps): JSX.Element {
	return (
		<main class="ins-missing">
			<a class="ins-missing__home" href="/" aria-label="Projective — home">
				<Logo class="ins-missing__mark" />
			</a>
			<h1 class="ins-missing__title">This file isn't available</h1>
			<p class="ins-missing__lede">
				It may have been removed, or you may not have access to it.
			</p>
			<div class="ins-missing__actions">
				<a class="ins-missing__link ins-missing__link--primary" href="/">Go to Projective</a>
				{signedIn ? <a class="ins-missing__link" href="/files">Open your files</a> : null}
			</div>
		</main>
	);
}

import type { JSX } from "preact";
import "../styles/workspace.css";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";

/**
 * CatalogueUnavailable — the workspace's body when the listing could not be READ (as opposed to a
 * listing that is not the caller's, which redirects to the console). Saying "we couldn't reach it"
 * and offering the reload is the honest answer; bouncing the seller to the console would read as
 * though the listing had gone.
 *
 * An island only so the workspace stylesheet reaches the page: on a failed read no other workspace
 * island mounts to carry it.
 */
export default function CatalogueUnavailable(props: { message: string }): JSX.Element {
	return (
		<div class="cat-ws__unavailable" role="alert">
			<h1 class="cat-ws__unavailable-title">{props.message}</h1>
			<p class="cat-ws__unavailable-text">
				Nothing was lost. This page just couldn't reach the listing.
			</p>
			<Button
				label="Try again"
				severity="neutral"
				variant="outlined"
				icon={<Icon name="refresh" />}
				onClick={() => globalThis.location?.reload()}
			/>
		</div>
	);
}

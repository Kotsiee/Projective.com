import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import type { ClientKey } from "../../types/catalogue-types.ts";
import { setWorkspaceUrl } from "../../core/workspace-store.ts";

/**
 * ClientPending — the panel for `?client=` until the client drawer exists: who the buyer is, the
 * way to their profile, and Close, which clears the buyer from the URL.
 */
export function ClientPending(props: { client: ClientKey }): JSX.Element {
	return (
		<div class="cat-ws-client">
			<h2 class="cat-ws-client__handle">{props.client}</h2>
			<p class="cat-ws-client__text">This buyer's engagements and conversation will show here.</p>
			<a class="cat-ws-client__link" href={`/${props.client}`}>View profile</a>
			<Button
				label="Close"
				size="sm"
				severity="neutral"
				variant="outlined"
				onClick={() => setWorkspaceUrl({ client: undefined }, "replace")}
			/>
		</div>
	);
}

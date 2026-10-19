import type { ComponentChildren, JSX } from "preact";
import { HELP_ROOT } from "@server/services/editorial/help-library.ts";
import { HelpStillStuck } from "./HelpStillStuck.tsx";
import { HELP_HUB_TITLE } from "../core/help-seo.ts";

/** Props for {@link HelpNotFound}. */
export interface HelpNotFoundProps {
	/** The search hero — the `HelpSearch` island, which also carries the help centre's stylesheet. */
	search: ComponentChildren;
	signedIn: boolean;
}

/**
 * HelpNotFound — a help address that names no category or article (`/help/<unknown>`,
 * `/help/<category>/<unknown>`), answered with a 404 INSIDE the help centre's frame and the public
 * shell: the eyebrow, one `<h1>`, one sentence, the search, the way back to every topic, and the
 * "Still stuck?" band — never the bare root error page. The route marks it `noindex`.
 */
export function HelpNotFound({ search, signedIn }: HelpNotFoundProps): JSX.Element {
	return (
		<div class="hc hc--missing">
			<p class="hc-eyebrow">{HELP_HUB_TITLE}</p>
			<h1 class="hc-title">That help page doesn't exist</h1>
			<p class="hc-lead">
				It may have moved, or the link may be mistyped. Search for what you need, or{" "}
				<a class="hc-link" href={HELP_ROOT}>browse every topic</a>.
			</p>
			{search}
			<HelpStillStuck signedIn={signedIn} />
		</div>
	);
}

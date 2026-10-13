import type { JSX } from "preact";
import { RESTRICTED_REFUSAL } from "@projective/types/auth";
import { InlineNotice } from "@projective/ui/feedback";

/**
 * The conversion lane's answer to a restricted (13–17) viewer (Decision #192): the buy, book and apply
 * controls are left out and one line says why. `lane` sits in the wide frame's lane column; `body` is
 * the below-breakpoint block, which shows and hides with `.evp-buybar` — the same duty moved, never
 * duplicated (§D.7.4).
 */
export function RestrictedLaneNotice({ placement }: { placement: "lane" | "body" }): JSX.Element {
	return (
		<div class={placement === "lane" ? "evp-restricted" : "evp-buybar evp-restricted"}>
			<InlineNotice align="start" text={RESTRICTED_REFUSAL} />
		</div>
	);
}

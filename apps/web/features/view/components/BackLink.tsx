import type { JSX } from "preact";
import type { HrefContext } from "@features/explore/core/routing.ts";
import { MigratingBack } from "@features/shell/components/MigratingBack.tsx";
import { backHrefFor, backLabelFor } from "../core/view-model.ts";

export interface BackLinkProps {
	/** Where the page was opened from — Explore, or the seller's profile-scoped namespace. */
	ctx: HrefContext;
	/**
	 * `page` — the static control at the top of the frame, above the fold.
	 * `band` — the same control inside the migrated sticky header, revealed once the hero scrolls away.
	 */
	placement: "page" | "band";
}

/**
 * BackLink — the entity view's way out, resolved from its {@link HrefContext}: the shell's shared
 * `MigratingBack` pointed at `backHrefFor(ctx)` — Explore, or the profile a listing sits under.
 *
 * The page and the migrated sticky header both render it, so the two homes cannot drift (same
 * destination, same label, same glyph), and the hand-over between them — the page copy withdrawing
 * as the band copy enters, focus following — is the shell's (`migrating-back.css`,
 * `core/migrating-header.ts`), identical to the profile's. This component adds only the page's
 * own grid placement (`evp__back`) to the page copy.
 */
export function BackLink({ ctx, placement }: BackLinkProps): JSX.Element {
	return (
		<MigratingBack
			placement={placement}
			fallback={backHrefFor(ctx)}
			fallbackLabel={backLabelFor(ctx)}
			class={placement === "page" ? "evp__back" : undefined}
		/>
	);
}

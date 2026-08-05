import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import FilesFooterRig from "../islands/FilesFooterRig.island.tsx";
import { filesLocationOf } from "./files-lane-slot.tsx";

/**
 * files-footer-slot — the middle-nav FOOTER band on EVERY `/files*` route.
 *
 * The region contract puts every ACTION in the footer and nothing but data in the body, so — like
 * `walletFooterFor` and unlike the page-scoped channel/board rigs — this resolver is not narrowed to
 * one page: a library without its action bar has no way to take a file in at all.
 *
 * The rig is also where the ACTION LAYER mounts. That is not incidental: `/wallet` shipped its layer
 * inside one body screen while the rig that opens it renders on eight routes, so every footer action on
 * the other seven opened nothing. The layer belongs to whatever triggers it, and the trigger is the
 * rig — one mount, one owner, the same dialogs wherever the band appears.
 *
 * ## Naming
 *
 * Exported as `filesFooterFor`, symmetric with {@link filesLaneFor} and {@link filesHeaderFor}. That
 * name is ALREADY taken in `(dashboard)/_layout.tsx` by the projects File Explorer's rig
 * (`features/projects/core/files-footer-slot.tsx`, the `/projects/…/files` view-control rig), so the
 * import site aliases the projects one to `channelFilesFooterFor` — which is the more accurate name for
 * it anyway, since it is scoped to an engagement's channel rather than to the hub.
 *
 * Server-only — never imported by an island.
 */
export function filesFooterFor(url: URL, context: UserContext): ComponentChildren {
	const loc = filesLocationOf(url, context);
	if (!loc) return null;
	return (
		<FilesFooterRig
			base={loc.base}
			scope={loc.scope}
			subjectId={loc.subjectId}
			segments={loc.segments}
			ownerType={loc.ownerType}
			ownerId={loc.ownerId}
		/>
	);
}

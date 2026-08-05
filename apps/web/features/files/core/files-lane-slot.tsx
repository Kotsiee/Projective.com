import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import FilesLane from "../islands/FilesLane.island.tsx";
import { filesHref } from "./asset-model.ts";
import type { AssetOwnerType, FileScope } from "../types/file-types.ts";

/**
 * files-lane-slot — the SSR-idiomatic resolver for the middle-nav LANE on any `/files*` route, and the
 * home of the small pure location model its two sibling slots share.
 *
 * It mirrors `walletLaneFor` / `catalogueLaneFor` / `messagesLaneFor`: a pure function of the URL and
 * the hydrated {@link UserContext}, evaluated by `(dashboard)/_layout.tsx` and returning the lane's
 * island already carrying everything it needs to paint. Server-only by convention — never imported by
 * an island (the island receives flat props instead, which is also why nothing here is re-exported as
 * an island-facing type).
 *
 * ## Why this slot resolves NO data
 *
 * Every other lane slot on this shell calls its feature's `*-ssr` resolver synchronously. This one
 * cannot: `FilesBackendService.list` / `.tree` / `.quota` are `async`, `files-ssr.ts` therefore returns
 * promises, and `laneFor` — like every slot resolver in `(dashboard)/_layout.tsx` — is a SYNCHRONOUS
 * function whose return value goes straight into the render tree. Preact cannot render a promise, so
 * the only way to await here is to make the shared dashboard layout an async component, which changes
 * how EVERY dashboard route renders. That is not a change to make blind, so the lane is instead seeded
 * with the location (derivable synchronously from the URL and the context) and fetches its own tree and
 * allowance on mount through the thin `FilesService`.
 *
 * The cost is bounded and deliberate: the lane's tree is navigation, not content, and the body — which
 * IS server-rendered by its own route — publishes the same tree into `files-state` when it seeds, so
 * whichever lands first wins and the two cannot disagree. **Flagged for reconciliation** (see the report
 * accompanying this change): the fix is either an async dashboard layout or a `/files` middleware that
 * stashes the bootstrap on `ctx.state` for the layout to read synchronously.
 */

// #region Location model
/** The `/files` location a URL addresses, resolved against the acting context. */
export interface FilesLocation {
	/** The space being read. */
	scope: FileScope;
	/** The scope's subject — a connection id for `drive`; `null` for the hub. */
	subjectId: string | null;
	/** The folder path WITHIN the scope, as decoded segments. `[]` is the scope root. */
	segments: string[];
	/** The owning principal's kind, derived from the acting context. */
	ownerType: AssetOwnerType;
	/** The owning principal's id. */
	ownerId: string;
	/** What to call this library in the chrome ("My files", or the workspace's handle). */
	ownerLabel: string;
	/** The route base every deep link in this scope hangs off. */
	base: string;
}

/**
 * The owner a `/files` read is scoped to.
 *
 * `personal` maps to `user` because the two vocabularies differ by exactly that one member —
 * `ContextType` names the acting SEAT, `AssetOwnerType` names the owning PRINCIPAL, and every other
 * member is spelled identically.
 */
function ownerOf(context: UserContext): { ownerType: AssetOwnerType; ownerId: string } {
	if (context.contextType === "personal") {
		return { ownerType: "user", ownerId: context.userId ?? "" };
	}
	return { ownerType: context.contextType, ownerId: context.contextId };
}

/** Percent-decode a URL segment, returning it unchanged when it is not valid encoding. */
function safeDecode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/**
 * Resolve the location a `/files` URL addresses.
 *
 * The `drives/{connectionId}` prefix is recognised here rather than guessed at, because the shared
 * pure model already fixes it: `asset-model.filesHref("drive", …)` builds exactly that URL, so the
 * parser and the builder are two halves of one encoding and must not be written from different
 * assumptions. Everything after the connection id is an ordinary folder path inside that drive.
 *
 * Returns `null` when the URL is not a `/files` route, so each slot has a single early exit.
 */
export function filesLocationOf(url: URL, context: UserContext): FilesLocation | null {
	const segs = url.pathname.split("/").filter(Boolean);
	if (segs[0] !== "files") return null;

	const { ownerType, ownerId } = ownerOf(context);
	const ownerLabel = context.contextType === "personal"
		? "My files"
		: context.handle
		? `@${context.handle.replace(/^@/, "")}`
		: "Shared library";

	// `/files/drives/{connectionId}[/folder…]` — a mounted connector, read-only by construction.
	if (segs[1] === "drives" && segs[2]) {
		const subjectId = safeDecode(segs[2]);
		return {
			scope: "drive",
			subjectId,
			segments: segs.slice(3).map(safeDecode),
			ownerType,
			ownerId,
			ownerLabel,
			base: filesHref("drive", { subjectId }),
		};
	}

	return {
		scope: "hub",
		subjectId: null,
		segments: segs.slice(1).map(safeDecode),
		ownerType,
		ownerId,
		ownerLabel,
		base: filesHref("hub"),
	};
}
// #endregion

// #region Slot
/**
 * The `/files` middle-nav lane: the directory tree, the scope map that separates the writable library
 * from the read-only mounts, and the storage allowance pinned at its foot.
 *
 * Composed FIRST in `laneFor`, before the `/projects` fall-through — `/files` is its own top-level
 * surface and must not inherit the projects feed.
 */
export function filesLaneFor(url: URL, context: UserContext): ComponentChildren {
	const loc = filesLocationOf(url, context);
	if (!loc) return null;
	return (
		<FilesLane
			path={url.pathname}
			base={loc.base}
			scope={loc.scope}
			subjectId={loc.subjectId}
			segments={loc.segments}
			ownerType={loc.ownerType}
			ownerId={loc.ownerId}
			ownerLabel={loc.ownerLabel}
		/>
	);
}
// #endregion

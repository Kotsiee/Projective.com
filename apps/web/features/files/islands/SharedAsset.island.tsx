import type { JSX } from "preact";
import { useSignal } from "@preact/signals";

// #region Stylesheet carriers
/**
 * A stylesheet reaches a page ONLY through a client/island bundle. This island mounts the shared
 * {@link FilePreview}, whose rules live in `attachment-modal.css`, so that sheet is imported HERE at
 * the hydration root rather than relying on the component's own import being collected from a graph
 * it is not in.
 */
import "@web/features/projects/styles/attachment-modal.css";
import "../styles/share-view.css";
// #endregion

import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { FilePreview } from "@web/features/projects/components/FilePreview.tsx";
import { FilesService } from "../core/FilesService.ts";
import { type AssetItem, sourceLabel } from "../types/file-types.ts";

/**
 * SharedAsset — the whole body of the public `/share/[slug]` page: a live link's file, or the ONE
 * answer every dead link produces.
 *
 * ## Both outcomes render from here, and that is the point
 *
 * The obvious shape is a live island and a server-rendered not-found. It is wrong twice. A stylesheet
 * reaches a page only through the island graph, so a not-found rendered outside the island would ship
 * unstyled — and worse, the two outcomes would then differ in which assets the page requests, which
 * is exactly the kind of side channel the route spends its whole design closing. One component, one
 * sheet, one bundle, whichever way the resolution went.
 *
 * ## Everything it does NOT show is deliberate
 *
 * A share link is handed to someone who has no account and, usually, no relationship with the person
 * who sent it. So this page shows the FILE and nothing about the library it came from: no folder
 * path, no owner handle, no sibling files, no navigation into the hub, and no visibility control. A
 * capability URL grants read on one object; a page that draws the object's surroundings has quietly
 * widened the grant to include the shape of somebody's private library.
 *
 * The `?u=` recipient reference is consumed SERVER-side and never reaches this component — there is
 * nothing here that could echo it into the DOM, a link, or an analytics call.
 *
 * ## The download is recorded before the bytes move
 *
 * `recordDownload` is awaited rather than fired and forgotten: on the live path it counts the
 * download against the link's `downloadLimit` **before** serving, so a link with one download left
 * cannot serve two to a pair of concurrent clicks. Recording after the fact would make the limit
 * advisory.
 *
 * The record is best-effort in the sense that a *failed* record still lets the download proceed — the
 * ledger exists for the owner's audit, and refusing a legitimate recipient because a log write
 * failed would be the wrong trade — but it is never skipped.
 *
 * Dumb: no Supabase, no fixtures. Everything goes through the thin {@link FilesService}.
 */

export interface SharedAssetProps {
	/**
	 * The resolved asset, or `null` for every dead outcome.
	 *
	 * `null` is ONE value covering not-found, expired, revoked, exhausted and a service failure alike —
	 * the route collapses them before they reach here, so this component has no way to tell them apart
	 * and therefore no way to leak which one it was.
	 */
	asset: AssetItem | null;
	/** The slug the visitor arrived on — recorded against the download, never displayed. */
	slug: string;
}

export default function SharedAsset({ asset, slug }: SharedAssetProps): JSX.Element {
	// The two outcomes are separate components rather than a branch inside one, so the live body's
	// hooks never sit above a conditional return — and so the narrowed asset survives into the download
	// closure (a destructured PARAMETER is not a `const` to the type checker, and its narrowing is
	// dropped the moment a closure captures it).
	return asset === null ? <DeadLink /> : <LiveLink asset={asset} slug={slug} />;
}

/**
 * The ONE answer every dead outcome produces.
 *
 * It takes no props on purpose: there is nothing about the failure it could be handed that it would
 * be safe to render.
 */
function DeadLink(): JSX.Element {
	return (
		<div class="shv-dead">
			<span class="shv-dead__mark" aria-hidden="true">
				<Icon name="link" size="md" />
			</span>
			<h1 class="shv-dead__title">That link is not available</h1>
			<p class="shv-dead__note">
				The link may have been mistyped, or the person who shared it may have turned it off. Ask
				them for a new one.
			</p>
		</div>
	);
}

/** The shared file itself. */
function LiveLink({ asset, slug }: { asset: AssetItem; slug: string }): JSX.Element {
	const working = useSignal(false);
	const failed = useSignal<string | null>(null);

	/** The bytes, or the link's target. `"#"` is the stub marker and is never navigated to. */
	const target = asset.link?.url ?? asset.url;
	const downloadable = Boolean(target) && target !== "#";

	async function download(): Promise<void> {
		if (!downloadable || working.value) return;
		working.value = true;
		failed.value = null;
		const res = await FilesService.recordDownload({
			assetId: asset.id,
			via: "share",
			shareSlug: slug,
		});
		working.value = false;
		if (!res.ok) {
			// The refusal is shown rather than swallowed, and the download is NOT attempted: on the live
			// path a non-ok answer here is the link's own limit being reached, and handing the bytes over
			// anyway would make the limit a decoration.
			failed.value = res.message ?? "That file is no longer available.";
			return;
		}
		// `noopener,noreferrer` — the opened page must not reach back into this one, and must not learn
		// the slug from a Referer header.
		globalThis.open(target, "_blank", "noopener,noreferrer");
	}

	return (
		<div class="shv">
			<div class="shv__stage">
				<FilePreview file={asset} active />
			</div>

			<div class="shv__meta">
				<h1 class="shv__name">{asset.name}</h1>
				<p class="shv__facts">
					<span>{asset.sizeLabel}</span>
					{asset.ext ? <span>{asset.ext.toUpperCase()}</span> : null}
					<span>{sourceLabel(asset.source)}</span>
				</p>

				{downloadable
					? (
						<Button
							variant="filled"
							label={working.value ? "Preparing…" : "Download"}
							disabled={working.value}
							onClick={() => void download()}
						/>
					)
					: (
						<p class="shv__note">
							This file is not available to download.
						</p>
					)}

				{failed.value
					? (
						<p class="shv__error" role="alert">
							<Icon name="warning" size="2xs" aria-hidden="true" />
							<span>{failed.value}</span>
						</p>
					)
					: null}

				<p class="shv__note">
					<Icon name="lock" size="2xs" aria-hidden="true" />
					<span>Shared with you as a read-only link. It can be revoked at any time.</span>
				</p>
			</div>
		</div>
	);
}

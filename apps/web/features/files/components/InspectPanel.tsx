import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { Button, SelectButton } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "../styles/files-hub.css";
import {
	type AssetItem,
	type AssetVisibility,
	CATEGORY_META,
	sourceLabel,
	visibilityLabel,
} from "../types/file-types.ts";
import { profileHref } from "@web/features/projects/core/routing.ts";
import { FileKindIcon } from "@web/features/projects/components/file-glyphs.tsx";
import { ScanMark, SourceMark, StatusMark, VisibilityMark } from "./file-hub-glyphs.tsx";

/**
 * InspectPanel — the right-hand detail pane, revealed only when an asset is selected.
 *
 * ## Why it is hidden by default
 *
 * The hub's body is for viewing and selecting (the region contract): a permanently-open pane would
 * spend a fifth of the workspace describing nothing, and an empty state that says "select a file to
 * see its details" teaches a person a rule the interface could simply follow. So it is absent until a
 * selection makes it about something, and it closes when the selection is cleared.
 *
 * ## Facts, then actions — in that order and never merged
 *
 * The panel lists what the asset IS (type · size · when · who · where · privacy · digest) before what
 * can be done to it. Every figure is the SERVER's — `sizeLabel`, `dateLabel` and the digest are all
 * pre-formatted on the row — so nothing here divides bytes, parses a timestamp or re-derives a state
 * the server already resolved.
 *
 * ## Two gates behave differently, on purpose
 *
 * **Capability → absence.** `canManage` is a server decision; when it is false the privacy control
 * and Delete are NOT RENDERED. A disabled control advertises a capability and then refuses it, which
 * is worse than never offering it — the `/wallet` rule (Decision #60), applied here.
 *
 * **A read-only LOCATION is a different fact from a read-only ASSET**, and the hub deliberately keeps
 * them apart: a mounted drive's file cannot be renamed here even though you own it, so when the asset
 * is not stored by the platform the panel says where its system of record is and offers the provider's
 * own link rather than a control that would half-work.
 *
 * Delete is a two-step in place rather than a modal: nothing is hard-deleted (root CLAUDE.md §5), the
 * pane is already the focused context, and pushing an overlay in front of a panel that is itself a
 * detail view adds a layer without adding a decision.
 *
 * Dumb: no data access, no fetching. Every action is the host's callback.
 */

// #region Props
export interface InspectPanelProps {
	/** The asset being described. `null` renders nothing — the host collapses the pane. */
	asset: AssetItem | null;
	/** Dismiss the pane (clears `inspectId`). */
	onClose: () => void;
	/** Download the asset (the host runs the guard + ledger write). */
	onDownload: (asset: AssetItem) => void;
	/** Open the raw asset in a new tab. */
	onOpenRaw: (asset: AssetItem) => void;
	/** Change the privacy scope. Only reachable when `asset.canManage`. */
	onSetVisibility: (asset: AssetItem, visibility: AssetVisibility) => void;
	/** Soft-delete the asset. Only reachable when `asset.canManage`. */
	onDelete: (asset: AssetItem) => void;
	/** A mutation is in flight — the controls stay visible and report it rather than vanishing. */
	busy?: boolean;
}
// #endregion

// #region Vocabulary
/** The three privacy scopes, phrased from the reader's point of view (the SSOT's `visibilityLabel`). */
const VISIBILITY_OPTIONS = (["private", "link", "public"] as const).map((value) => ({
	value,
	label: visibilityLabel(value),
}));

/** The stored-bytes lifecycle, in words. Only shown when it is not the unremarkable `uploaded`. */
function statusLabel(status: AssetItem["status"]): string {
	switch (status) {
		case "pending_upload":
			return "Still uploading";
		case "scanning":
			return "Being checked";
		case "uploaded":
			return "Stored";
		case "quarantined":
			return "Quarantined";
		case "error":
			return "Upload failed";
	}
}

/**
 * A digest as a readable fragment.
 *
 * Truncated because the whole point of showing it is recognition, not transcription — and the full
 * value stays in the `title` for anyone who does need to compare it character by character.
 */
function shortHash(hash: string): string {
	return hash.length <= 20 ? hash : `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}
// #endregion

// #region Rows
interface FactProps {
	label: string;
	children: JSX.Element | string | null;
	/** A leading glyph for a fact whose state is iconographic (privacy, source, status). */
	mark?: JSX.Element | null;
}

/** One label/value pair. A `<dl>` row, so the pairing is structural rather than only visual. */
function Fact({ label, children, mark }: FactProps): JSX.Element | null {
	if (children === null) return null;
	return (
		<div class="fh-inspect__fact">
			<dt class="fh-inspect__factlabel">{label}</dt>
			<dd class="fh-inspect__factvalue">
				{mark ? <span class="fh-inspect__factmark" aria-hidden="true">{mark}</span> : null}
				<span class="fh-inspect__facttext">{children}</span>
			</dd>
		</div>
	);
}
// #endregion

export function InspectPanel(props: InspectPanelProps): JSX.Element | null {
	const { asset, onClose, onDownload, onOpenRaw, onSetVisibility, onDelete, busy = false } = props;

	// Local to the panel and reset by its own actions: a pending confirmation is a state of this pane,
	// not of the library, so it has no business in `files-state`.
	const confirmingDelete = useSignal(false);

	if (!asset) return null;

	const meta = CATEGORY_META[asset.category];
	const typeLabel = asset.ext ? `${meta.label} · ${asset.ext.toUpperCase()}` : meta.label;
	const stored = asset.source === "supabase";
	const isLink = asset.source === "link";
	const where = asset.folderPath.length > 0 ? asset.folderPath.join(" / ") : "Library root";
	const hasThumb = asset.thumbnailUrl !== null &&
		(asset.kind === "image" || asset.kind === "video");

	return (
		<aside class="fh-inspect" aria-label={`Details for ${asset.name}`}>
			<header class="fh-inspect__head">
				<h2 class="fh-inspect__title" title={asset.name}>{asset.name}</h2>
				<Tooltip content="Close details">
					<button
						type="button"
						class="fh-inspect__close"
						onClick={onClose}
						aria-label="Close details"
					>
						<Icon name="close" size="sm" />
					</button>
				</Tooltip>
			</header>

			<div class="fh-inspect__preview" data-kind={asset.kind}>
				{hasThumb
					? (
						<img
							class="fh-inspect__thumb"
							src={asset.thumbnailUrl ?? asset.url}
							alt=""
							loading="lazy"
							draggable={false}
						/>
					)
					: (
						<span class="fh-inspect__glyph" aria-hidden="true">
							<FileKindIcon kind={asset.kind} size={34} />
						</span>
					)}
			</div>

			<dl class="fh-inspect__facts">
				<Fact label="Type">{typeLabel}</Fact>
				<Fact label="Size">
					{isLink ? "A link — no stored bytes" : asset.sizeLabel}
				</Fact>
				<Fact label="Added">{asset.dateLabel}</Fact>

				<Fact
					label="Added by"
					mark={asset.sender ? null : <SourceMark source={asset.source} size={14} />}
				>
					{asset.sender
						? (
							<span class="fh-inspect__person">
								<Avatar
									image={asset.sender.avatar ?? undefined}
									label={asset.sender.name}
									size={20}
									alt=""
								/>
								{asset.sender.handle
									? (
										<a class="fh-inspect__personlink" href={profileHref(asset.sender.handle)}>
											{asset.sender.name}
										</a>
									)
									: <span>{asset.sender.name}</span>}
							</span>
						)
						: sourceLabel(asset.source)}
				</Fact>

				<Fact label="Where">{where}</Fact>

				<Fact
					label="Privacy"
					mark={<VisibilityMark visibility={asset.visibility} />}
				>
					{visibilityLabel(asset.visibility)}
				</Fact>

				{asset.status !== "uploaded"
					? (
						<Fact label="Status" mark={<StatusMark status={asset.status} />}>
							{statusLabel(asset.status)}
						</Fact>
					)
					: null}

				{isLink && asset.link
					? (
						<Fact label="Link safety" mark={<ScanMark status={asset.link.scanStatus} />}>
							{asset.link.domain}
						</Fact>
					)
					: null}

				{asset.downloadCount > 0
					? (
						<Fact label="Downloads">
							{`${asset.downloadCount} ${asset.downloadCount === 1 ? "copy" : "copies"} taken`}
						</Fact>
					)
					: null}

				{asset.contentHash
					? (
						<Fact label="Content hash">
							<code class="fh-inspect__hash" title={asset.contentHash}>
								{shortHash(asset.contentHash)}
								{asset.hashSampled ? <span class="fh-inspect__hashnote">sampled</span> : null}
							</code>
						</Fact>
					)
					: null}
			</dl>

			{!stored
				? (
					<p class="fh-inspect__note">
						{isLink
							? "This is a stored link. The page itself lives on its own site."
							: `This file lives in ${
								sourceLabel(asset.source)
							} — it is browsable here, and changed there.`}
					</p>
				)
				: null}

			<div class="fh-inspect__actions">
				<Button
					variant="outlined"
					size="sm"
					icon={<Icon name="download" />}
					label="Download"
					disabled={busy}
					onClick={() => onDownload(asset)}
				/>
				<Button
					variant="text"
					size="sm"
					icon={<Icon name="external-link" />}
					label="Open in new tab"
					onClick={() => onOpenRaw(asset)}
				/>
			</div>

			{asset.canManage
				? (
					<div class="fh-inspect__manage">
						{
							/* The accessible name repeats the visible heading VERBATIM rather than paraphrasing
							   it: `BaseFieldProps` carries no `aria-labelledby`, and a name that does not contain
							   the visible label breaks "label in name" (WCAG 2.5.3) for voice control. */
						}
						<p class="fh-inspect__managetitle">Who can see this</p>
						<SelectButton
							size="sm"
							options={VISIBILITY_OPTIONS}
							value={asset.visibility}
							disabled={busy}
							aria-label="Who can see this"
							onValueChange={(next) => onSetVisibility(asset, next as AssetVisibility)}
						/>

						{confirmingDelete.value
							? (
								<div class="fh-inspect__confirm" role="group" aria-label="Confirm delete">
									<p class="fh-inspect__confirmnote">
										Move this file to deleted? Anyone holding a share link loses access.
									</p>
									<div class="fh-inspect__confirmrow">
										<Button
											severity="danger"
											variant="text"
											size="sm"
											label="Delete"
											loading={busy}
											onClick={() => {
												confirmingDelete.value = false;
												onDelete(asset);
											}}
										/>
										<Button
											variant="text"
											size="sm"
											label="Keep"
											onClick={() => (confirmingDelete.value = false)}
										/>
									</div>
								</div>
							)
							: (
								<Button
									severity="danger"
									variant="text"
									size="sm"
									icon={<Icon name="trash" />}
									label="Delete"
									disabled={busy}
									onClick={() => (confirmingDelete.value = true)}
								/>
							)}
					</div>
				)
				: null}
		</aside>
	);
}

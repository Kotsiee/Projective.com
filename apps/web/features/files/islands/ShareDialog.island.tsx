import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

// #region Stylesheet carrier
/**
 * A stylesheet reaches a page ONLY through a client/island bundle — a sheet imported by a server
 * component ships nothing. This island renders `.fsh-*` and nothing borrowed, so one import is the
 * whole of its layer; the package components it mounts (`Button`, `Checkbox`, `InputNumber`,
 * `Message`, `Tooltip`) carry their own sheets into this same bundle through their module imports.
 */
import "../styles/share-drive.css";
// #endregion

import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useId, useOverlayStack } from "@projective/ui/hooks";
import { Button, Checkbox, InputNumber } from "@projective/ui/fields";
import { Message, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";

import { FilesService } from "../core/FilesService.ts";
import { simFromSeam } from "../core/files-seam.ts";
import {
	type AssetFolder,
	type AssetItem,
	type AssetVisibility,
	shareHref,
	type ShareLink,
	visibilityLabel,
} from "../types/file-types.ts";
import { VisibilityMark } from "../components/file-hub-glyphs.tsx";

/**
 * ShareDialog — the two questions a person actually has in front of a share control, in the order
 * they have them: **who can see this**, and **what does the link I am about to send do**.
 *
 * ## A share link is READ-ONLY, and there is deliberately no way to change that
 *
 * There is no "allow upload", no "let them replace this", no permission axis at all. A URL is a
 * bearer token that gets forwarded, screenshotted and indexed, so anything it can do, everyone
 * downstream of the person you sent it to can also do — and an anonymous write-capable link is a
 * materially different threat model from an anonymous read. The SSOT encodes the same position
 * (`files/sharing.ts`), and this surface offers no control that would contradict it.
 *
 * ## The link IS the credential, and the dialog says so in words
 *
 * Not in a tooltip, not in help text a reader has to go looking for: one sentence, next to the URL,
 * before anyone pastes it anywhere. It is the single fact a person needs in order to decide where
 * this link may safely go, and a surface that mints capability tokens silently is teaching people
 * that a URL is harmless.
 *
 * ## Two questions, two writes, kept apart
 *
 * Visibility (`setVisibility`) and the link (`createShare`) are separate calls against separate
 * rows, and this dialog does not fuse them. Choosing "Anyone with the link" does not silently mint
 * one, because the link's TERMS — how long it lasts, how many copies it will hand out — are chosen
 * before minting and are fixed afterwards: the contract has no update, only revoke-and-re-mint, so a
 * link minted by a side effect would be minted with defaults nobody chose.
 *
 * For the same reason revoking is presented as its own act rather than as a consequence of lowering
 * visibility. A person who sets a file back to "Only you" should revoke the link they already sent;
 * this dialog puts that control in front of them rather than assuming either way on their behalf.
 *
 * ## Two gates, told apart
 *
 * `canManage` is a server decision. Without it the privacy CONTROL is not rendered — the fact still
 * is, as plain text — because a disabled control advertises a capability and then refuses it (the
 * `/wallet` rule, Decision #60). Nothing here infers the right from ownership.
 *
 * Dumb island: everything goes through the thin {@link FilesService}; no database, no fixtures, and
 * no slug is ever minted client-side.
 */

// #region Subject
/**
 * What is being shared.
 *
 * A narrow shape rather than the whole `AssetItem`/`AssetFolder`, because a share link points at
 * exactly one of the two and the dialog needs the same five facts from either — modelling it as a
 * union of two rows would make every read in here a branch.
 */
export interface ShareSubject {
	kind: "asset" | "folder";
	id: string;
	name: string;
	visibility: AssetVisibility;
	/** The opaque token when a link already exists; `null` otherwise. Never minted here. */
	shareSlug: string | null;
	/** Whether the viewer may change any of this. Server-derived; never inferred client-side. */
	canManage: boolean;
}

/** Shape an asset row into a {@link ShareSubject}. */
export function shareSubjectOfAsset(asset: AssetItem): ShareSubject {
	return {
		kind: "asset",
		id: asset.id,
		name: asset.name,
		visibility: asset.visibility,
		shareSlug: asset.shareSlug,
		canManage: asset.canManage,
	};
}

/** Shape a folder row into a {@link ShareSubject}. */
export function shareSubjectOfFolder(folder: AssetFolder): ShareSubject {
	return {
		kind: "folder",
		id: folder.id,
		name: folder.name,
		visibility: folder.visibility,
		shareSlug: folder.shareSlug,
		canManage: folder.canManage,
	};
}
// #endregion

// #region Props
export interface ShareDialogProps {
	open: boolean;
	/** What is being shared; `null` renders nothing (the host has closed it). */
	subject: ShareSubject | null;
	onClose: () => void;
	/**
	 * A write landed — the host re-reads so the grid, the tree and the Inspect pane show the server's
	 * version rather than this dialog's optimistic one.
	 */
	onChanged?: (change: { visibility: AssetVisibility; shareSlug: string | null }) => void;
}
// #endregion

// #region Vocabulary
/** The three scopes in reading order — least to most reachable, so the ladder reads as one. */
const SCOPES: readonly AssetVisibility[] = ["private", "link", "public"];

/**
 * What each scope actually MEANS for the reader, phrased as a consequence rather than a definition.
 *
 * The labels themselves come from the SSOT's `visibilityLabel`, which is already written from the
 * reader's point of view ("Anyone with the link", not "link"); these are the sentence underneath.
 */
function scopeNote(visibility: AssetVisibility, kind: ShareSubject["kind"]): string {
	const noun = kind === "folder" ? "folder" : "file";
	switch (visibility) {
		case "private":
			return `Nobody else can open this ${noun} from a link.`;
		case "link":
			return `Anyone holding the link can open it, without signing in. It is not listed anywhere.`;
		case "public":
			return `Anyone can open it, and search engines may index it.`;
	}
}

/** The expiry presets. Whole units a person can hold in their head, not a date picker. */
type ExpiryChoice = "none" | "24h" | "7d" | "30d";

const EXPIRY_OPTIONS: readonly { value: ExpiryChoice; label: string; hours: number | null }[] = [
	{ value: "none", label: "No expiry", hours: null },
	{ value: "24h", label: "24 hours", hours: 24 },
	{ value: "7d", label: "7 days", hours: 24 * 7 },
	{ value: "30d", label: "30 days", hours: 24 * 30 },
];

/**
 * The ISO instant a preset resolves to, or `null` for no expiry.
 *
 * Reads the clock, so it is called from a handler and never during render: a value derived at render
 * time would differ between the server's paint and the browser's and put two different expiries on
 * screen a moment apart.
 */
function expiryIso(choice: ExpiryChoice): string | null {
	const option = EXPIRY_OPTIONS.find((o) => o.value === choice);
	if (!option || option.hours === null) return null;
	return new Date(Date.now() + option.hours * 3_600_000).toISOString();
}

/**
 * A stored expiry as a readable day.
 *
 * Fixed locale and an explicit UTC zone, so this renders identically wherever it is evaluated — the
 * same reason every sibling projection pre-formats its dates on the server rather than leaving the
 * client to guess a zone.
 */
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});

function formatDay(iso: string): string {
	const at = Date.parse(iso);
	return Number.isFinite(at) ? DAY_FORMAT.format(new Date(at)) : "an unreadable date";
}

/**
 * How long the "Copied" acknowledgement stays up.
 *
 * Long enough to be read by someone who was looking at the button they pressed, short enough that it
 * is gone before the next press — a permanent "Copied" stops answering the question it was asked.
 */
const COPY_NOTICE_MS = 2400;

/** The absolute URL a recipient would open. Client-only — `origin` does not exist on the server. */
function absoluteShareUrl(slug: string): string {
	const path = shareHref(slug);
	const origin = globalThis.location?.origin;
	return origin ? `${origin}${path}` : path;
}
// #endregion

export default function ShareDialog(props: ShareDialogProps): JSX.Element | null {
	const { open, subject, onClose, onChanged } = props;

	// #region State
	/** The scope on screen. Optimistic on a write, reverted by the server's refusal. */
	const visibility = useSignal<AssetVisibility>("private");
	/** The token a link exists under; `null` when there is none. */
	const slug = useSignal<string | null>(null);
	/** The row for a link minted in THIS session — the only case in which the terms are known. */
	const minted = useSignal<ShareLink | null>(null);
	/**
	 * Whether a pre-existing link opened when it was checked.
	 *
	 * `null` = not asked. Deliberately one boolean and not the resolution's four states: the route
	 * collapses not-found, expired, revoked and exhausted into one identical answer precisely so that a
	 * distinguishable failure cannot confirm a slug was real, and a client that rendered which one it
	 * was would undo that at the last step.
	 *
	 * The transport envelope also cannot tell that refusal apart from a network failure — both arrive
	 * as a soft `{ ok: false }` — which is why the notice this drives reports the OBSERVATION ("did not
	 * open when checked") rather than the verdict ("this link is dead"). A blip on the owner's wifi
	 * must not be shown to them as a revoked link.
	 */
	const linkLive = useSignal<boolean | null>(null);

	const expiry = useSignal<ExpiryChoice>("none");
	const limitOn = useSignal(false);
	const limitCount = useSignal<number | null>(10);

	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	/** Whether the URL reached the clipboard. Announced, then it stops mattering. */
	const copied = useSignal(false);

	const panelRef = useRef<HTMLDivElement>(null);
	const urlRef = useRef<HTMLInputElement>(null);
	const copyTimer = useRef<number | null>(null);

	const rootId = useId(undefined, "fsh");
	const titleId = `${rootId}-title`;
	// #endregion

	// #region Overlay
	const { mounted, state } = usePresence(open && subject !== null);
	/**
	 * `layer: "modal"` EXPLICITLY. The default is `"popover"` (z 1100), and a modal left on the popover
	 * layer is outranked by any correctly-declared sibling — including the preview modal, which can be
	 * open on the surface that opened this.
	 */
	const stack = useOverlayStack({ active: mounted, lockScroll: true, layer: "modal" });
	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({
		open: mounted,
		enabled: stack.isTop,
		onDismiss: onClose,
		panelRef,
		// The backdrop's own click handler dismisses; an outside-click listener as well would fire
		// twice for one gesture and, worse, treat a click inside a portalled Tooltip as "outside".
		closeOnOutside: false,
	});
	// #endregion

	// #region Seed
	const subjectId = subject?.id ?? null;

	/**
	 * Reset to the subject every time the dialog opens on something.
	 *
	 * `useEffect` keyed on the two values read during render — NOT `useSignalEffect`, which subscribes
	 * to every signal read synchronously inside it and would re-run this body (wiping the terms
	 * half-chosen) the moment one of them is written. The AssetPicker learned this the same way.
	 */
	useEffect(() => {
		if (!open || !subject) return;
		visibility.value = subject.visibility;
		slug.value = subject.shareSlug;
		minted.value = null;
		linkLive.value = null;
		expiry.value = "none";
		limitOn.value = false;
		limitCount.value = 10;
		error.value = null;
		copied.value = false;

		// Only an ASSET link can be probed. A folder link resolves through the listing path by design
		// (`ShareResolution.ok` carries exactly one asset), so `resolveShare` answers not-found for every
		// healthy folder link — probing one would report a working link as dead.
		if (subject.shareSlug && subject.kind === "asset") {
			const target = subject.shareSlug;
			void (async () => {
				const res = await FilesService.resolveShare(target, null, simFromSeam());
				// A later open supersedes this answer entirely.
				if (slug.value !== target) return;
				linkLive.value = res.ok && res.data?.state === "ok";
			})();
		}
	}, [open, subjectId]);

	useEffect(() => () => {
		if (copyTimer.current !== null) clearTimeout(copyTimer.current);
	}, []);
	// #endregion

	// #region Writes
	/**
	 * Change the privacy scope.
	 *
	 * Optimistic, and REVERTED on refusal. A radio that stayed where the person put it after the server
	 * said no is the worst of both: it reports a change that did not happen, and the next thing they do
	 * is act on a file they believe is shared.
	 */
	async function applyVisibility(next: AssetVisibility): Promise<void> {
		if (!subject || busy.value || next === visibility.value) return;
		const previous = visibility.value;
		visibility.value = next;
		busy.value = true;
		error.value = null;
		const res = await FilesService.setVisibility({
			assetIds: subject.kind === "asset" ? [subject.id] : [],
			folderIds: subject.kind === "folder" ? [subject.id] : [],
			visibility: next,
		});
		busy.value = false;
		if (res.ok) {
			onChanged?.({ visibility: next, shareSlug: slug.value });
			return;
		}
		visibility.value = previous;
		error.value = res.message ?? "That privacy change could not be applied.";
	}

	/** Mint a link on the current scope and the chosen terms. */
	async function createLink(): Promise<void> {
		if (!subject || busy.value) return;
		const scope = visibility.value;
		if (scope === "private") return;
		busy.value = true;
		error.value = null;
		const res = await FilesService.createShare({
			itemId: subject.kind === "asset" ? subject.id : null,
			folderId: subject.kind === "folder" ? subject.id : null,
			visibility: scope,
			expiresAt: expiryIso(expiry.value),
			downloadLimit: limitOn.value && limitCount.value ? limitCount.value : null,
		});
		busy.value = false;
		if (res.ok && res.data) {
			minted.value = res.data;
			slug.value = res.data.slug;
			linkLive.value = true;
			onChanged?.({ visibility: scope, shareSlug: res.data.slug });
			return;
		}
		// No bare `if (ok)`: a mint that failed silently leaves the terms panel on screen looking as
		// though it is still waiting for a press that already happened.
		error.value = res.message ?? "That share link could not be created.";
	}

	/**
	 * Revoke the link. Terminal — re-sharing mints a NEW slug, so a URL that has already leaked stays
	 * dead rather than being re-armed under someone else's copy of it.
	 */
	async function revokeLink(): Promise<void> {
		const target = slug.value;
		if (!target || busy.value) return;
		busy.value = true;
		error.value = null;
		const res = await FilesService.revokeShare({ slug: target });
		busy.value = false;
		if (!res.ok) {
			error.value = res.message ?? "That share link could not be revoked.";
			return;
		}
		slug.value = null;
		minted.value = null;
		linkLive.value = null;
		copied.value = false;
		onChanged?.({ visibility: visibility.value, shareSlug: null });
	}

	/** Copy the URL, falling back to selecting it when the clipboard is unavailable or refused. */
	async function copyUrl(): Promise<void> {
		const target = slug.value;
		if (!target) return;
		const url = absoluteShareUrl(target);
		try {
			await globalThis.navigator?.clipboard?.writeText(url);
			copied.value = true;
			if (copyTimer.current !== null) clearTimeout(copyTimer.current);
			copyTimer.current = setTimeout(() => {
				copyTimer.current = null;
				copied.value = false;
			}, COPY_NOTICE_MS) as unknown as number;
		} catch {
			// An insecure context has no clipboard at all. Selecting the field is a real fallback: the
			// person presses one key instead of none, and nothing pretends to have succeeded.
			urlRef.current?.focus();
			urlRef.current?.select();
			error.value = "Copying was blocked — the link is selected, press Ctrl/⌘ + C.";
		}
	}
	// #endregion

	if (!mounted || !subject) return null;

	// #region Derived
	const scope = visibility.value;
	const hasLink = slug.value !== null;
	const shared = scope !== "private";
	const url = slug.value ? absoluteShareUrl(slug.value) : "";
	const link = minted.value;
	const noun = subject.kind === "folder" ? "folder" : "file";
	// #endregion

	return (
		<BodyPortal>
			<div class="fsh" data-state={state} style={`--ovl-z:${stack.zIndex}`}>
				<Backdrop visible={state === "open"} onClick={onClose} />
				<div
					ref={panelRef}
					class="fsh__panel"
					role="dialog"
					aria-modal="true"
					aria-labelledby={titleId}
				>
					<header class="fsh__head">
						<div class="fsh__heading">
							<h2 class="fsh__title" id={titleId}>Share</h2>
							<p class="fsh__subject">{subject.name}</p>
						</div>
						<Tooltip content="Close">
							<button type="button" class="fsh__close" aria-label="Close" onClick={onClose}>
								<Icon name="close" size="sm" />
							</button>
						</Tooltip>
					</header>

					<div class="fsh__body">
						{error.value ? <Message severity="danger" text={error.value} /> : null}

						{/* --- Who can see this --- */}
						<fieldset class="fsh-sec">
							<legend class="fsh-sec__legend">Who can see this</legend>

							{subject.canManage
								? (
									<div class="fsh-choices">
										{SCOPES.map((value) => {
											const noteId = `${rootId}-scope-${value}`;
											const chosen = scope === value;
											return (
												<label
													key={value}
													class="fsh-choice"
													data-chosen={chosen ? "true" : "false"}
												>
													<input
														type="radio"
														class="fsh-choice__input"
														name={`${rootId}-scope`}
														value={value}
														checked={chosen}
														disabled={busy.value}
														aria-describedby={noteId}
														onChange={() => void applyVisibility(value)}
													/>
													<span class="fsh-choice__label">
														<span class="fsh-choice__glyph">
															<VisibilityMark visibility={value} />
														</span>
														{visibilityLabel(value)}
													</span>
													<p class="fsh-choice__note" id={noteId}>
														{scopeNote(value, subject.kind)}
													</p>
												</label>
											);
										})}
									</div>
								)
								: (
									<>
										<p class="fsh-readonly">
											<span class="fsh-readonly__mark" aria-hidden="true">
												<VisibilityMark visibility={scope} />
											</span>
											{visibilityLabel(scope)}
										</p>
										<p class="fsh-sec__note">
											{`This ${noun} is managed by someone else, so its privacy is theirs to change.`}
										</p>
									</>
								)}
						</fieldset>

						{/* --- The link --- */}
						<fieldset class="fsh-sec">
							<legend class="fsh-sec__legend">Share link</legend>

							{
								/*
								 * A viewer without `canManage` is never shown the URL, even when one exists.
								 * The slug is a bearer capability, and being able to READ a file is not the same
								 * grant as being able to hand out a key to it — the SSOT's own share projection
								 * strips `shareSlug` from what a recipient receives for exactly this reason.
								 */
							}
							{!subject.canManage
								? (
									<p class="fsh-sec__note">
										{`Sharing this ${noun} is managed by whoever owns it.`}
									</p>
								)
								: hasLink
								? (
									<div class="fsh-link">
										<div class="fsh-link__row">
											{
												/*
												 * Read-only rather than disabled: the value is still selectable and still
												 * reachable by keyboard, which is the whole fallback when the clipboard is
												 * refused. A disabled input is neither.
												 */
											}
											<input
												ref={urlRef}
												class="fsh-link__url"
												type="text"
												value={url}
												readOnly
												spellcheck={false}
												aria-label="Share link address"
												onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
											/>
											<Button
												variant="outlined"
												size="sm"
												icon={<Icon name="copy" />}
												label={copied.value ? "Copied" : "Copy"}
												onClick={() => void copyUrl()}
											/>
										</div>

										<p class="fsh-link__credential">
											<Icon name="lock" size="2xs" aria-hidden="true" />
											<span>
												<strong>The link is the credential.</strong> Anyone holding it can open this
												{" "}
												{noun}{" "}
												— no account, no invitation. Treat it like a key: it works for everyone it
												is forwarded to, and it keeps working until it is revoked.
											</span>
										</p>

										{link
											? (
												<ul class="fsh-link__terms">
													<li class="fsh-link__term">
														<Icon name="clock" size="2xs" aria-hidden="true" />
														<span>
															{link.expiresAt
																? `Expires ${formatDay(link.expiresAt)}`
																: "No expiry"}
														</span>
													</li>
													<li class="fsh-link__term">
														<Icon name="download" size="2xs" aria-hidden="true" />
														<span>
															{link.downloadLimit === null
																? "Unlimited downloads"
																: `Stops after ${link.downloadLimit} downloads`}
														</span>
													</li>
												</ul>
											)
											: (
												<p class="fsh-sec__note">
													This link's terms were set when it was created. Its terms cannot be
													changed afterwards — revoke it and make a new one instead.
												</p>
											)}

										{linkLive.value === false
											? (
												<Message
													severity="warning"
													text="This link did not open when it was checked. If it should still work, revoke it and create a new one."
												/>
											)
											: null}

										{
											/*
											 * Revoking is a SEPARATE act from lowering the privacy scope, so a person who
											 * has just set this back to "Only you" is told where the other control is
											 * rather than left assuming one press did both.
											 */
										}
										{!shared
											? (
												<Message
													severity="warning"
													text={`This ${noun} is set to "${
														visibilityLabel("private")
													}" — a link you shared earlier is revoked separately. Revoke it if it should stop working.`}
												/>
											)
											: null}

										<div class="fsh-link__actions">
											<Button
												variant="text"
												size="sm"
												severity="danger"
												icon={<Icon name="close" />}
												label="Revoke link"
												loading={busy.value}
												onClick={() => void revokeLink()}
											/>
										</div>
									</div>
								)
								: !shared
								? (
									<p class="fsh-sec__note">
										A link only works once this {noun} is shared. Choose{" "}
										{`"${visibilityLabel("link")}"`} or {`"${visibilityLabel("public")}"`}{" "}
										above, then create one.
									</p>
								)
								: (
									<div class="fsh-terms">
										<p class="fsh-sec__note">
											These terms are fixed once the link exists — the only way to change them later
											is to revoke it and create another.
										</p>

										<fieldset class="fsh-optset">
											<legend class="fsh-terms__label">Stops working</legend>
											<div class="fsh-opts">
												{EXPIRY_OPTIONS.map((option) => (
													<label key={option.value} class="fsh-opt">
														<input
															type="radio"
															class="fsh-opt__input"
															name={`${rootId}-expiry`}
															value={option.value}
															checked={expiry.value === option.value}
															disabled={busy.value}
															onChange={() => (expiry.value = option.value)}
														/>
														{option.label}
													</label>
												))}
											</div>
										</fieldset>

										<div class="fsh-terms__row">
											<Checkbox
												value={limitOn}
												disabled={busy.value}
												label="Stop after a number of downloads"
											/>
											{limitOn.value
												? (
													<InputNumber
														value={limitCount}
														min={1}
														max={100_000}
														step={1}
														showButtons
														disabled={busy.value}
														class="fsh-terms__limit"
														// Distinct from the checkbox's visible label rather than a copy of it: two
														// controls answering to the same spoken name is an ambiguous voice target.
														aria-label="Maximum downloads"
													/>
												)
												: null}
										</div>

										<div class="fsh-link__actions">
											<Button
												variant="filled"
												size="sm"
												icon={<Icon name="link" />}
												label="Create link"
												loading={busy.value}
												onClick={() => void createLink()}
											/>
										</div>
									</div>
								)}
						</fieldset>
					</div>

					<footer class="fsh__foot">
						<p class="fsh__footnote" role="status">
							{copied.value
								? "Link copied to the clipboard."
								: hasLink
								? "Anyone with this link can open it."
								: `Nothing is shared until a link exists.`}
						</p>
						<div class="fsh__footactions">
							<Button variant="text" label="Done" onClick={onClose} />
						</div>
					</footer>
				</div>
			</div>
		</BodyPortal>
	);
}

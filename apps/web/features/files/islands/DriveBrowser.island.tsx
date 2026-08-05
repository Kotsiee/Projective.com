import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

// #region Stylesheet carrier
/**
 * A stylesheet reaches a page ONLY through a client/island bundle — a sheet imported by a server
 * component ships nothing. This island renders `.drv-*` and the `.prov-chip` its rail is built from,
 * both of which live in the one sheet imported here; the package components it mounts carry their own
 * sheets into this same bundle through their module imports.
 */
import "../styles/share-drive.css";
// #endregion

import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useId, useOverlayStack } from "@projective/ui/hooks";
import { Button } from "@projective/ui/fields";
import { Message, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	connectionIsRecoverable,
	type ConnectionStatus,
	type UserConnection,
} from "@projective/types/integrations";

import { FileKindIcon } from "@web/features/projects/components/file-glyphs.tsx";
import { IntegrationsService } from "../core/IntegrationsService.ts";
import { simFromSeam, subscribeFilesSim } from "../core/files-seam.ts";
import {
	type AssetFolder,
	type AssetItem,
	type AssetOwnerType,
	type AssetSource,
	consumesQuota,
	type FilesSim,
	sourceLabel,
} from "../types/file-types.ts";
import {
	ProviderChip,
	providerConsent,
	providerStatusLabel,
	sourceForProvider,
} from "../components/ProviderChip.tsx";

/**
 * DriveBrowser — a connected drive, one level at a time, and the two ways of bringing something back.
 *
 * ## A breadcrumb-driven column, not a disclosure tree
 *
 * The obvious build is the shared `TreeNav`, and it is the wrong one twice over. It has no
 * virtualization, so a Drive folder holding five thousand objects pays the full DOM cost of all of
 * them; and it has no lazy children, so the whole hierarchy would have to arrive in one payload — a
 * request nobody can bound, against a provider that pages with an opaque continuation token. So this
 * surface fetches exactly ONE level per request ({@link IntegrationsService.browse}), renders it as a
 * flat column, and keeps the trail behind it as breadcrumbs.
 *
 * The trail is hand-rolled rather than the hub's `AssetBreadcrumbs`, and the difference is real: that
 * component gives every crumb a genuine `url` alongside its `command`, so middle-click, Cmd-click and
 * "copy link address" keep working on a hub folder. A level inside somebody else's Drive has no route
 * on this origin, so there is no href to offer, and rendering anchors would advertise three
 * interactions that cannot work.
 *
 * ## Two flows, and the quota consequence is the entire difference
 *
 * **Attach Directly** mounts by REFERENCE: the hub stores a pointer, the bytes stay where they are,
 * and the size counts against the provider's allowance rather than the platform's. **Import to
 * Library** would copy the bytes in, and they would then count against yours. The SSOT's
 * {@link consumesQuota} is the predicate that tells the two apart, and this surface uses it on the row
 * that actually came back rather than asserting which one happened.
 *
 * Both are offered, because the choice is the thing worth teaching; only the first is wired. There is
 * no copy endpoint — `IntegrationsBackendService.importAsset` documents at length that it moves no
 * bytes — and a client cannot fill that gap, because copying requires reading the object with a
 * provider credential the browser never holds and must never hold. So the second names its cost, says
 * plainly that it is not available yet, and refuses rather than quietly doing the first thing under
 * the second thing's label. That would be the one failure a person could not detect: their allowance
 * would simply not move.
 *
 * ## Every connection state is a different surface
 *
 * `degraded` and `expired` do NOT browse. The service refuses them (409), and the refusal matters
 * more than it looks: an empty column is indistinguishable from "this drive has no files here", so a
 * lapsed grant that fell through to a listing would read as an empty Drive and send someone looking
 * for a file they can see in another tab. Both therefore prompt RE-CONSENT before any request is made.
 * `revoked` / `disconnected` / `error` prompt a fresh consent instead — offering "reconnect" on a
 * grant that no longer exists would imply a stored authorization to refresh. `pending` offers neither
 * and says so.
 *
 * Dumb island: everything goes through the thin {@link IntegrationsService}; no Supabase, no adapter,
 * and no token has a shape anywhere in this file.
 */

// #region Props
export interface DriveBrowserProps {
	open: boolean;
	/**
	 * The viewer's connections, resolved by the host (SSR, or `IntegrationsService.connections`).
	 * Non-storage connectors are filtered out here rather than by the caller, so a host can pass the
	 * whole list it already has.
	 */
	connections: UserConnection[];
	/** The library a mount is filed into. A REQUEST the server authorises — never the answer. */
	owner: { ownerType: AssetOwnerType; ownerId: string };
	/** The destination folder; `null` files it at the library root, which is a real destination. */
	folderId: string | null;
	/** The same-origin PATH a consent returns to. Validated server-side; an absolute URL is refused. */
	returnTo: string;
	onClose: () => void;
	/** The rows that landed in the hub — the host re-reads its listing. */
	onAdded?: (assets: AssetItem[]) => void;
}
// #endregion

// #region Model
/** One level in the trail. `folderId` is the PROVIDER's own id, never one we invented. */
interface DriveLevel {
	/** `null` at the drive root. */
	folderId: string | null;
	label: string;
}

/** How something found in a drive comes back into the hub. */
type AddMode = "attach" | "import";

/**
 * Whether copying into the platform's own storage can happen at all.
 *
 * A named constant rather than an inline `false`, so the day a copy endpoint lands the change is one
 * line and the branch it controls is already written and already explained (see the module note).
 */
const IMPORT_COPY_AVAILABLE = false;

/** One page of a level. Small — a picker is a finder, and the tail loads on demand. */
const PAGE_LIMIT = 60;

/**
 * The storage connectors a drive can be mounted from, in the order the hub's tree lists them.
 *
 * Each is simultaneously a provider slug and an {@link AssetSource} member, which is why one array
 * serves both the consent call and `sourceLabel`. That coincidence is not guaranteed for a future
 * connector — `sourceForProvider` is the mapping that survives it.
 */
const STORAGE_PROVIDERS: readonly AssetSource[] = ["google_drive", "dropbox", "frameio", "s3"];

/** Storage connectors only: a calendar or a conferencing grant has no files to browse. */
function isBrowsable(connection: UserConnection): boolean {
	return connection.providerCapabilities.includes("storage") ||
		connection.grantedKinds.includes("storage");
}

/**
 * Whether a connection is in a state a listing can be asked for.
 *
 * The one condition, in one place, read by both the fetch guard and the render branch — so the column
 * can never be showing an empty listing for a connection the fetch declined to ask about.
 */
function canBrowse(status: ConnectionStatus): boolean {
	return status === "active";
}
// #endregion

export default function DriveBrowser(props: DriveBrowserProps): JSX.Element | null {
	const { open, connections, owner, folderId, returnTo, onClose, onAdded } = props;

	// #region State
	/** The connection being browsed; `null` before one is chosen. */
	const activeId = useSignal<string | null>(null);
	/** The trail from the drive root, deepest last. `[]` is the root itself. */
	const trail = useSignal<DriveLevel[]>([]);

	const entries = useSignal<AssetItem[]>([]);
	const folders = useSignal<AssetFolder[]>([]);
	/**
	 * Whether a listing has ANSWERED for the current level.
	 *
	 * Explicit, because `entries.length === 0` conflates "not loaded" with "loaded, and this folder is
	 * empty" — and on this surface those two must never be confused, since an empty column is also what
	 * a lapsed connection would look like if it were allowed to fall through.
	 */
	const seeded = useSignal(false);
	const loading = useSignal(false);
	const error = useSignal<string | null>(null);
	const hasMore = useSignal(false);
	const cursor = useSignal<string | null>(null);

	/** Chosen files, in click order, accumulated ACROSS levels — a person may pick from two folders. */
	const picked = useSignal<AssetItem[]>([]);
	const mode = useSignal<AddMode>("attach");

	const adding = useSignal(false);
	/** The outcome of the last add. Never swallowed, and never a bare success when some rows failed. */
	const outcome = useSignal<{ severity: "success" | "warning" | "danger"; text: string } | null>(
		null,
	);
	/** A consent is being started for this provider slug — disables just that path. */
	const starting = useSignal<string | null>(null);

	const panelRef = useRef<HTMLDivElement>(null);
	const reqId = useRef(0);
	const simRef = useRef<FilesSim | undefined>(undefined);

	const rootId = useId(undefined, "drv");
	const titleId = `${rootId}-title`;
	// #endregion

	// #region Overlay
	const { mounted, state } = usePresence(open);
	/** `layer: "modal"` EXPLICITLY — the default is `"popover"` (z 1100) and would be outranked. */
	const stack = useOverlayStack({ active: mounted, lockScroll: true, layer: "modal" });
	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({
		open: mounted,
		enabled: stack.isTop,
		onDismiss: onClose,
		panelRef,
		closeOnOutside: false,
	});
	// #endregion

	// #region Derived
	const browsable = connections.filter(isBrowsable);
	const active = browsable.find((c) => c.id === activeId.value) ?? null;
	const level = trail.value.at(-1) ?? null;
	// #endregion

	// #region Reads
	/**
	 * Read one level.
	 *
	 * `folderId` is passed for BOTH provider families. S3 has no folder objects, and its adapter
	 * collapses an incoming `folderId` into a key prefix rather than resolving it against a lookup that
	 * cannot exist — so a single field addresses both, and the alternative (deciding here which family
	 * a connection belongs to) would put provider knowledge in an island.
	 */
	async function readLevel(connectionId: string, at: string | null): Promise<void> {
		const my = ++reqId.current;
		loading.value = true;
		error.value = null;
		const res = await IntegrationsService.browse({
			connectionId,
			folderId: at,
			limit: PAGE_LIMIT,
		}, simRef.current);
		if (my !== reqId.current) return;
		loading.value = false;
		if (res.ok && res.data) {
			entries.value = res.data.entries;
			folders.value = res.data.folders;
			hasMore.value = res.data.hasMore;
			cursor.value = res.data.nextCursor;
			seeded.value = true;
			return;
		}
		// No bare `if (ok)`: a failed read with no else leaves the PREVIOUS folder's contents under
		// breadcrumbs that claim to be somewhere else, which is how a person attaches the wrong file.
		entries.value = [];
		folders.value = [];
		hasMore.value = false;
		cursor.value = null;
		error.value = res.message ?? "That drive could not be read.";
	}

	/** Append the next page. Guarded, so a fast press cannot fire twice for one cursor. */
	async function loadMore(): Promise<void> {
		const connectionId = activeId.value;
		if (!connectionId || loading.value || !hasMore.value || !cursor.value) return;
		const my = reqId.current;
		loading.value = true;
		const res = await IntegrationsService.browse({
			connectionId,
			folderId: level?.folderId ?? null,
			cursor: cursor.value,
			limit: PAGE_LIMIT,
		}, simRef.current);
		if (my !== reqId.current) return;
		loading.value = false;
		if (res.ok && res.data) {
			const known = new Set(entries.value.map((e) => e.id));
			entries.value = [...entries.value, ...res.data.entries.filter((e) => !known.has(e.id))];
			const knownFolders = new Set(folders.value.map((f) => f.id));
			folders.value = [
				...folders.value,
				...res.data.folders.filter((f) => !knownFolders.has(f.id)),
			];
			hasMore.value = res.data.hasMore;
			cursor.value = res.data.nextCursor;
			return;
		}
		error.value = res.message ?? "The next page could not be loaded.";
	}
	// #endregion

	// #region Navigation
	/** Clear the level's contents. Selection deliberately SURVIVES — it spans the whole visit. */
	function resetLevel(): void {
		entries.value = [];
		folders.value = [];
		seeded.value = false;
		hasMore.value = false;
		cursor.value = null;
		error.value = null;
	}

	function selectConnection(connection: UserConnection): void {
		activeId.value = connection.id;
		trail.value = [];
		picked.value = [];
		outcome.value = null;
		resetLevel();
		// The guard is the same predicate the render branches on, so a lapsed grant is never asked for
		// a listing whose emptiness would then be indistinguishable from an empty drive.
		if (canBrowse(connection.status)) void readLevel(connection.id, null);
	}

	function openFolder(folder: AssetFolder): void {
		const connectionId = activeId.value;
		const at = folder.externalFolderId;
		if (!connectionId || at === null) return;
		trail.value = [...trail.value, { folderId: at, label: folder.name }];
		resetLevel();
		void readLevel(connectionId, at);
	}

	/** Climb to a depth: `0` is the drive root, `n` is the nth level of the trail. */
	function climbTo(depth: number): void {
		const connectionId = activeId.value;
		if (!connectionId) return;
		const next = trail.value.slice(0, depth);
		trail.value = next;
		resetLevel();
		void readLevel(connectionId, next.at(-1)?.folderId ?? null);
	}
	// #endregion

	// #region Selection
	function isPicked(asset: AssetItem): boolean {
		return picked.value.some((a) => a.id === asset.id);
	}

	function togglePick(asset: AssetItem): void {
		outcome.value = null;
		picked.value = isPicked(asset)
			? picked.value.filter((a) => a.id !== asset.id)
			: [...picked.value, asset];
	}
	// #endregion

	// #region Consent
	/**
	 * Begin a consent and hand the browser to the provider.
	 *
	 * A NAVIGATION, never a fetch: a consent screen is something a person reads and agrees to, and
	 * requesting it in the background would be asking the provider to authorise a grant nobody saw.
	 */
	async function connect(providerSlug: string): Promise<void> {
		if (starting.value) return;
		starting.value = providerSlug;
		error.value = null;
		const res = await IntegrationsService.start({ providerSlug, returnTo });
		if (res.ok && res.data) {
			globalThis.location.assign(res.data.authorizeUrl);
			// Deliberately NOT clearing `starting`: the page is navigating away, and re-enabling the
			// control in the frames before it does invites a second consent for the same provider.
			return;
		}
		starting.value = null;
		error.value = res.message ?? "That connection could not be started.";
	}
	// #endregion

	// #region Add
	/**
	 * Bring the chosen files back.
	 *
	 * Sequential rather than concurrent, and the partial outcome is REPORTED: four parallel mounts
	 * against one provider is how a rate limit turns into three silent failures, and "3 of 4 added" is
	 * a sentence a person can act on where a bare success is not.
	 */
	async function add(): Promise<void> {
		const connectionId = activeId.value;
		const chosen = picked.value;
		if (!connectionId || chosen.length === 0 || adding.value) return;

		if (mode.value === "import" && !IMPORT_COPY_AVAILABLE) {
			outcome.value = {
				severity: "warning",
				text:
					"Copying into your library is not available yet — only attaching by reference is. Choose Attach Directly, or come back when copying lands.",
			};
			return;
		}

		adding.value = true;
		outcome.value = null;
		const landed: AssetItem[] = [];
		const failed: string[] = [];
		/**
		 * The ids of the DRIVE rows that succeeded — kept separately from `landed`, whose rows are the
		 * hub's newly-minted assets and carry different ids. Pruning the selection by name instead would
		 * clear the wrong row the first time a drive holds two files called `final.psd`.
		 */
		const done = new Set<string>();

		for (const asset of chosen) {
			const externalFileId = asset.external?.externalFileId;
			if (!externalFileId) {
				// A row with no back-reference is not addressable at the provider, so it cannot be mounted.
				// Counted as a failure rather than skipped, because a person chose it.
				failed.push(asset.name);
				continue;
			}
			const res = await IntegrationsService.importAsset({
				connectionId,
				externalFileId,
				folderId,
				owner: { ownerType: owner.ownerType, ownerId: owner.ownerId },
			});
			if (res.ok && res.data) {
				landed.push(res.data);
				done.add(asset.id);
			} else {
				failed.push(asset.name);
			}
		}

		adding.value = false;

		if (landed.length > 0) {
			picked.value = picked.value.filter((a) => !done.has(a.id));
			onAdded?.(landed);
		}

		if (failed.length === 0) {
			// The quota claim comes from the SSOT's predicate applied to the row that actually came back,
			// not from what this surface believed it was doing.
			const free = landed.every((a) => !consumesQuota(a));
			outcome.value = {
				severity: "success",
				text: `${landed.length} ${landed.length === 1 ? "file" : "files"} added${
					free ? " — nothing was copied, so your storage allowance is unchanged." : "."
				}`,
			};
			return;
		}

		outcome.value = {
			severity: landed.length > 0 ? "warning" : "danger",
			text: landed.length > 0
				? `${landed.length} of ${landed.length + failed.length} added. These could not be: ${
					failed.join(", ")
				}.`
				: `Nothing could be added: ${failed.join(", ")}.`,
		};
	}
	// #endregion

	// #region Mount
	useEffect(() => {
		simRef.current = simFromSeam();
		const unsubscribe = subscribeFilesSim((sim) => {
			simRef.current = sim;
			// The connection-state axis is SERVER-derived, so a re-render would relabel the same rows
			// rather than reach the state being simulated — the read has to happen again.
			//
			// The location is `peek`ed off the signal rather than read from the render closure: this
			// effect is mounted once, so a captured `level` would be the one from the first render and
			// the refetch would re-read the drive root however deep the person had navigated.
			const connectionId = activeId.peek();
			if (connectionId) void readLevel(connectionId, trail.peek().at(-1)?.folderId ?? null);
		});
		return unsubscribe;
	}, []);

	/**
	 * Start clean each time the browser opens.
	 *
	 * `useEffect` keyed on the boolean read during render, NOT `useSignalEffect`: a signal effect
	 * subscribes to everything read synchronously inside it, and this body writes several of those —
	 * so it would re-run and reset the trail on the first navigation.
	 */
	useEffect(() => {
		if (!open) return;
		picked.value = [];
		outcome.value = null;
		mode.value = "attach";
		trail.value = [];
		resetLevel();
		const first = browsable.find((c) => canBrowse(c.status)) ?? browsable[0] ?? null;
		activeId.value = first?.id ?? null;
		if (first && canBrowse(first.status)) void readLevel(first.id, null);
	}, [open]);
	// #endregion

	if (!mounted) return null;

	// #region Column
	function column(): JSX.Element {
		if (!active) {
			return (
				<div class="fov-state" role="status">
					<p class="fov-state__title">No drives connected</p>
					<p class="fov-state__note">
						Connecting a drive is a separate permission from signing in — signing in with Google
						grants no access to your Drive. A connected drive stays read-only here.
					</p>
					<div class="fov-state__actions">
						{STORAGE_PROVIDERS.map((slug) => (
							<Button
								key={slug}
								variant="outlined"
								size="sm"
								label={sourceLabel(slug)}
								loading={starting.value === slug}
								disabled={starting.value !== null}
								onClick={() => void connect(slug)}
							/>
						))}
					</div>
				</div>
			);
		}

		if (!canBrowse(active.status)) {
			const consent = providerConsent(active.status);
			const recoverable = connectionIsRecoverable(active.status);
			return (
				<div class="fov-state fov-state--consent" role="status">
					<p class="fov-state__title">
						{`${active.providerLabel} — ${providerStatusLabel(active.status)}`}
					</p>
					<p class="fov-state__note">
						{active.status === "pending"
							? "This connection has not finished being set up. Once the provider confirms it, its files will show up here."
							: recoverable
							? `Its permission has lapsed, so its files cannot be listed. Nothing has been lost — reconnecting restores access. Until then this is deliberately blank rather than an empty folder, because the two look identical and mean opposite things.`
							: `This connection no longer exists, so its files cannot be listed. Connecting again means granting the permission afresh.`}
					</p>
					{active.lastError
						? (
							<p class="fov-state__note">
								{
									/* The provider's own words. A paraphrase of somebody else's failure is how a
								    person ends up debugging the wrong thing. */
								}
								{active.lastError}
							</p>
						)
						: null}
					{consent !== "none"
						? (
							<div class="fov-state__actions">
								<Button
									variant="filled"
									size="sm"
									label={consent === "reconnect" ? "Reconnect" : `Connect ${active.providerLabel}`}
									loading={starting.value === active.providerSlug}
									disabled={starting.value !== null}
									onClick={() => void connect(active.providerSlug)}
								/>
							</div>
						)
						: null}
				</div>
			);
		}

		if (error.value && !seeded.value) {
			return (
				<div class="fov-state fov-state--error" role="alert">
					<p class="fov-state__title">This folder could not be read</p>
					<p class="fov-state__note">{error.value}</p>
					<div class="fov-state__actions">
						<Button
							variant="outlined"
							size="sm"
							label="Try again"
							onClick={() => void readLevel(active.id, level?.folderId ?? null)}
						/>
					</div>
				</div>
			);
		}

		if (!seeded.value && loading.value) {
			return (
				<div class="fov-state" role="status">
					<p class="fov-state__note">{`Reading ${active.providerLabel}…`}</p>
				</div>
			);
		}

		if (seeded.value && folders.value.length === 0 && entries.value.length === 0) {
			return (
				<div class="fov-state" role="status">
					<p class="fov-state__title">Nothing in this folder</p>
					<p class="fov-state__note">
						{`${active.providerLabel} reports no files or folders here.`}
					</p>
				</div>
			);
		}

		return (
			<>
				<ul class="drv-list">
					{folders.value.map((folder) => {
						const openable = folder.externalFolderId !== null;
						return (
							<li key={`f:${folder.id}`} class="drv-item">
								<button
									type="button"
									class="drv-row"
									disabled={!openable}
									onClick={() => openFolder(folder)}
								>
									<span class="drv-row__glyph" aria-hidden="true">
										<Icon name="folder" size="sm" />
									</span>
									<span class="drv-row__body">
										<span class="drv-row__name">{folder.name}</span>
										<span class="drv-row__meta">
											{openable
												? `${folder.itemCount} ${folder.itemCount === 1 ? "item" : "items"}`
												: "This folder cannot be opened from here"}
										</span>
									</span>
									<span class="drv-row__tail" aria-hidden="true">
										<Icon name="chevron-right" size="xs" />
									</span>
								</button>
							</li>
						);
					})}

					{entries.value.map((asset) => {
						const chosen = isPicked(asset);
						const out = asset.external?.externalWebUrl ?? null;
						return (
							<li key={`a:${asset.id}`} class="drv-item">
								{
									/*
									 * The provider link is a SIBLING of the row button, not a child of it. An anchor
									 * inside a button is invalid content and, in practice, unreachable — the browser
									 * decides which of the two nested interactive elements an activation belongs to,
									 * and the answer differs between pointer and keyboard.
									 */
								}
								<button
									type="button"
									class="drv-row"
									// Preact DROPS `aria-pressed={false}`, so the string is rendered in both states —
									// otherwise an unchosen row ships with no attribute and reads as a plain button.
									aria-pressed={chosen ? "true" : "false"}
									onClick={() => togglePick(asset)}
								>
									<span class="drv-row__glyph" aria-hidden="true">
										{chosen
											? <Icon name="check" size="sm" />
											: <FileKindIcon kind={asset.kind} size={20} />}
									</span>
									<span class="drv-row__body">
										<span class="drv-row__name">{asset.name}</span>
										<span class="drv-row__meta">{`${asset.sizeLabel} · ${asset.dateLabel}`}</span>
									</span>
								</button>
								{out
									? (
										<Tooltip content={`Open in ${active.providerLabel}`}>
											<a
												class="drv-item__out"
												href={out}
												target="_blank"
												rel="noopener noreferrer"
												aria-label={`Open ${asset.name} in ${active.providerLabel} (opens in a new tab)`}
											>
												<Icon name="external-link" size="2xs" aria-hidden="true" />
											</a>
										</Tooltip>
									)
									: null}
							</li>
						);
					})}
				</ul>

				{error.value && seeded.value ? <Message severity="danger" text={error.value} /> : null}

				{hasMore.value
					? (
						<div class="drv__more">
							<Button
								variant="outlined"
								size="sm"
								label={loading.value ? "Loading…" : "Show more"}
								disabled={loading.value}
								onClick={() => void loadMore()}
							/>
						</div>
					)
					: null}
			</>
		);
	}
	// #endregion

	const count = picked.value.length;
	const canAdd = count > 0 && active !== null && canBrowse(active.status) &&
		(mode.value === "attach" || IMPORT_COPY_AVAILABLE);

	return (
		<BodyPortal>
			<div class="drv" data-state={state} style={`--ovl-z:${stack.zIndex}`}>
				<Backdrop visible={state === "open"} onClick={onClose} />
				<div
					ref={panelRef}
					class="drv__panel"
					role="dialog"
					aria-modal="true"
					aria-labelledby={titleId}
				>
					<header class="drv__head">
						<div class="drv__heading">
							<h2 class="drv__title" id={titleId}>Add from a connected drive</h2>
							<p class="drv__lede">
								Browse a service you have connected and bring what you find into your files.
							</p>
						</div>
						<Tooltip content="Close">
							<button type="button" class="drv__close" aria-label="Close" onClick={onClose}>
								<Icon name="close" size="sm" />
							</button>
						</Tooltip>
					</header>

					<div class="drv__body">
						{browsable.length > 0
							? (
								<div class="drv__rail">
									<div class="prov-chips" role="group" aria-label="Connected drives">
										{browsable.map((connection) => (
											<ProviderChip
												key={connection.id}
												label={connection.providerLabel}
												source={sourceForProvider(connection.providerSlug)}
												status={connection.status}
												accountLabel={connection.externalAccountLabel}
												selected={connection.id === activeId.value}
												onSelect={() => selectConnection(connection)}
											/>
										))}
									</div>
									{active
										? (
											<p class="drv__railnote">
												{active.externalAccountLabel ?? active.providerLabel}
											</p>
										)
										: null}
								</div>
							)
							: null}

						{active && canBrowse(active.status)
							? (
								<nav class="drv-crumbs" aria-label="Drive folder path">
									<ol class="drv-crumbs__list">
										<li class="drv-crumbs__item">
											{trail.value.length === 0
												? (
													<span class="drv-crumbs__here" aria-current="page">
														{active.providerLabel}
													</span>
												)
												: (
													<button
														type="button"
														class="drv-crumbs__btn"
														onClick={() => climbTo(0)}
													>
														{active.providerLabel}
													</button>
												)}
										</li>
										{trail.value.map((crumb, index) => {
											const last = index === trail.value.length - 1;
											return (
												<li key={`${crumb.folderId}:${index}`} class="drv-crumbs__item">
													<span class="drv-crumbs__sep" aria-hidden="true">
														<Icon name="chevron-right" size="2xs" />
													</span>
													{last
														? (
															<span class="drv-crumbs__here" aria-current="page">
																{crumb.label}
															</span>
														)
														: (
															<button
																type="button"
																class="drv-crumbs__btn"
																onClick={() => climbTo(index + 1)}
															>
																{crumb.label}
															</button>
														)}
												</li>
											);
										})}
									</ol>
								</nav>
							)
							: null}

						<div class="drv__column">{column()}</div>

						{outcome.value
							? <Message severity={outcome.value.severity} text={outcome.value.text} />
							: null}

						{active && canBrowse(active.status)
							? (
								<fieldset class="drv-modes">
									<legend class="drv-modes__legend">How to add it</legend>

									<label class="drv-mode" data-chosen={mode.value === "attach" ? "true" : "false"}>
										<input
											type="radio"
											class="drv-mode__input"
											name={`${rootId}-mode`}
											value="attach"
											checked={mode.value === "attach"}
											disabled={adding.value}
											aria-describedby={`${rootId}-mode-attach`}
											onChange={() => {
												mode.value = "attach";
												outcome.value = null;
											}}
										/>
										<span class="drv-mode__label">Attach Directly</span>
										<p class="drv-mode__note" id={`${rootId}-mode-attach`}>
											The file stays where it is and your files link to it.{" "}
											<span class="drv-mode__cost">Uses none of your storage allowance</span>{" "}
											— it keeps counting against{" "}
											{active.providerLabel}. It stays read-only here, and changes made there show
											up here.
										</p>
									</label>

									<label
										class={IMPORT_COPY_AVAILABLE ? "drv-mode" : "drv-mode drv-mode--blocked"}
										data-chosen={mode.value === "import" ? "true" : "false"}
									>
										<input
											type="radio"
											class="drv-mode__input"
											name={`${rootId}-mode`}
											value="import"
											checked={mode.value === "import"}
											disabled={adding.value}
											aria-describedby={`${rootId}-mode-import`}
											onChange={() => {
												mode.value = "import";
												outcome.value = null;
											}}
										/>
										<span class="drv-mode__label">Import to Library</span>
										<p class="drv-mode__note" id={`${rootId}-mode-import`}>
											A copy is taken into your own library and stops depending on{" "}
											{active.providerLabel}.{" "}
											<span class="drv-mode__cost">Uses your storage allowance</span>, and the two
											copies stop matching the first time either is edited.
											{IMPORT_COPY_AVAILABLE ? "" : " Not available yet."}
										</p>
									</label>
								</fieldset>
							)
							: null}
					</div>

					<footer class="drv__foot">
						<p class="drv__footnote" role="status">
							{count === 0 ? "Nothing chosen" : `${count} ${count === 1 ? "file" : "files"} chosen`}
							{count > 0 && mode.value === "import" && !IMPORT_COPY_AVAILABLE
								? " — copying is not available yet, so choose Attach Directly."
								: ""}
						</p>
						<div class="drv__footactions">
							<Button variant="text" label="Cancel" onClick={onClose} />
							<Button
								variant="filled"
								label={count > 1 ? `Add ${count} files` : "Add"}
								disabled={!canAdd}
								loading={adding.value}
								onClick={() => void add()}
							/>
						</div>
					</footer>
				</div>
			</div>
		</BodyPortal>
	);
}

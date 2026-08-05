import type {
	AssetFolder,
	AssetItem,
	AssetListPage,
	AssetListParams,
	AssetOwnerType,
	AssetTreeNode,
	CreateFolder,
	CreateShare,
	DedupCheck,
	DedupVerdict,
	DeleteAssets,
	DownloadEvent,
	DownloadGuard,
	DownloadHistoryPage,
	DownloadVia,
	FileScope,
	FilesSim,
	LinkAttach,
	MoveAssets,
	RenameAsset,
	RevokeShare,
	SetVisibility,
	ShareLink,
	ShareResolution,
	StorageQuota,
	UploadComplete,
	UploadInit,
	UploadTicket,
} from "@projective/types/files";
import { SAMPLE_THRESHOLD_BYTES } from "@projective/types/files";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isFilesBackendLive } from "../../core/supabase.ts";
import * as fx from "./assets-fixtures.ts";
import { meterUpload, resolveQuota } from "./quota-fixtures.ts";
import * as shares from "./share-fixtures.ts";
import { resolveLinkPreview } from "./link-scan.ts";
import {
	ANONYMOUS_ACTOR,
	type AssetOwnerRef,
	authoriseOwner,
	type FilesActor,
	fixtureOwner,
} from "./acting-principal.ts";

/**
 * FilesBackendService — the FAT half of the `/files` asset hub (thin-routes / fat-services, root
 * CLAUDE.md §2 / SYSTEM_ARCHITECTURE §Backend Services). It owns the scope reads (a library location, a
 * mounted project channel, a conversation, a connected drive, a share resolution), the storage
 * allowance, the upload handshake, every mutation over what is already stored, the read-only share
 * capability, and the download ledger — each returning a transport-agnostic {@link ServiceResult}. The
 * thin `/api/files/*` routes parse + Zod-validate + auth-guard + delegate here; islands never reach it.
 *
 * Gated by {@link isFilesBackendLive} (`FILES_BACKEND_LIVE`, default off): until the RLS-scoped
 * `files.items` / `files.folders` / `files.share_links` / `files.download_events` tables and the
 * Supabase Storage signed-URL handshake are wired, reads answer from deterministic fixtures and writes
 * mutate an in-module session store.
 *
 * **Every method forks on that gate as its first statement, including the ones whose two branches are
 * currently identical.** The fork is not decoration: it is the seam a live implementation is written
 * INTO, and a method without one has nowhere to put a Postgres call except in place of the fixture
 * call, which is how a stub becomes unreachable in the same commit that makes it wrong. Each LIVE
 * branch names the table or handshake it will use and then falls back to the fixtures with zero shape
 * churn, exactly like the sibling services.
 *
 * ### Three invariants this service exists to hold
 *
 * **`canManage` and `downloadedByViewer` are SERVER-DERIVED on every row it returns.** Neither may be
 * inferred client-side. `canManage` is an authority decision — a mounted channel attachment is
 * read-only in the hub as a matter of product rule, not of ownership arithmetic — and a client that
 * computed it would be deciding its own permissions. `downloadedByViewer` cannot be answered from
 * `localStorage` at all: that store is per-browser, is wiped, and is wrong the moment the same person
 * opens the asset on their phone.
 *
 * **The OWNER of a write is resolved from the session, never from the payload.** Every mutation takes a
 * {@link FilesActor} the route derived from `ctx.state.userContext`, and a payload `ownerType`/`ownerId`
 * is treated as a REQUEST to act as that principal which {@link authoriseOwner} either evidences or
 * refuses (see `./acting-principal.ts`). This is identity, not capability: it decides who is calling,
 * never whether their persona or plan permits the operation — a capability bounce would make every Dev
 * Context Switcher axis inert, since the switcher is a client seam the server cannot see (Decision
 * #53(b)).
 *
 * **Quota enforcement is FAIL-OPEN and param-gated.** The service METERS an upload and warns; it
 * refuses only once `security.platform_params.storage_quota_enforced` is on. When it does refuse, the
 * `entitlement.denied` analytics event is emitted by the APP LAYER, not here and not in the database —
 * a `RAISE` inside Postgres rolls back the analytics row written moments earlier, because there are no
 * autonomous transactions, so the denial telemetry would go dark exactly when enforcement starts
 * mattering (Decision #58).
 */
export class FilesBackendService {
	// #region Reads

	/**
	 * A filtered, sorted, paged page of one location — plus its child folders, its breadcrumb trail, and
	 * (on a `hub` read only) the owner's storage allowance.
	 *
	 * Folders travel with items because a single view renders both; splitting them across two requests
	 * would let a rename land in one response and not the other, and the reader would see one directory
	 * under two names.
	 *
	 * `sim` is the developer overlay, taken as a SEPARATE argument rather than folded into
	 * {@link AssetListParams}. The Dev Context Switcher is a client seam the server cannot see, so its
	 * axes travel as their own validated query params (`simFromParams`) — keeping them off the params
	 * shape is what stops a simulated request from being indistinguishable from a real one, and what
	 * lets the live branch ignore the overlay by simply not reading this argument.
	 */
	static async list(
		params: AssetListParams,
		sim?: FilesSim,
	): Promise<ServiceResult<AssetListPage>> {
		if (!isFilesBackendLive()) return await Promise.resolve(listFromFixtures(params, sim));
		// LIVE: read RLS-scoped `files.items` + `files.folders` for the resolved scope, ignoring `sim`
		// entirely — not yet implemented; fall back to the fixtures with zero shape churn.
		return await Promise.resolve(listFromFixtures(params, sim));
	}

	/**
	 * The `/files` navigation tree: the owner's writable library, the read-only mounted engagements, and
	 * the connected drives, as three sibling sections rather than one merged root (a merged root would
	 * put things the owner cannot rename or delete inside "my files").
	 */
	static async tree(params: {
		scope: FileScope;
		subjectId?: string | null;
		ownerType: AssetOwnerType;
		ownerId: string;
	}): Promise<ServiceResult<AssetTreeNode[]>> {
		if (!isFilesBackendLive()) {
			const owner = fixtureOwnerRef(params.ownerType, params.ownerId);
			return await Promise.resolve(ok(fx.buildTree(owner.ownerType, owner.ownerId)));
		}
		// LIVE: one recursive read of `files.folders` for the owner, UNION the mounted engagement roots
		// the caller can see (`projects.has_project_access`) and their active `integrations` storage
		// connections. RLS decides which sections exist, so a caller cannot enumerate a library by
		// asking for its tree — not yet implemented; fall back to the fixtures.
		return await Promise.resolve(ok(fx.buildTree(params.ownerType, params.ownerId)));
	}

	/** One asset's full row. */
	static async item(id: string, sim?: FilesSim): Promise<ServiceResult<AssetItem>> {
		if (!isFilesBackendLive()) return await Promise.resolve(itemFromFixtures(id, sim));
		// LIVE: `files.items` by id under the caller's JWT, re-deriving `canManage` and
		// `downloadedByViewer` server-side — not yet implemented; fall back to the fixtures. The sim
		// overlay is not applied on the live path; a real row is the answer.
		return await Promise.resolve(itemFromFixtures(id));
	}

	/**
	 * A principal's resolved storage allowance.
	 *
	 * Every figure is server-computed: the client renders them and never subtracts, divides or totals,
	 * for the same reason `/wallet` never lets the client do money arithmetic (Decision #60).
	 *
	 * `actor` is optional because this is a READ, and an SSR bootstrap resolving its own first paint has
	 * no request to derive one from. It is honoured on the live path, where an allowance is a real fact
	 * about a real subscription and a caller must not be able to read another principal's; the fixture
	 * projection is a plan tier plus a usage figure measured over a public deterministic corpus, so
	 * scoping it while the gate is off would cost the dev axes their reach and protect nothing.
	 */
	static async quota(params: {
		ownerType: AssetOwnerType;
		ownerId: string;
		sim?: FilesSim;
	}, actor?: FilesActor): Promise<ServiceResult<StorageQuota>> {
		if (!isFilesBackendLive()) {
			return await Promise.resolve(
				ok(resolveQuota({ ...params, ...fixtureOwnerRef(params.ownerType, params.ownerId) })),
			);
		}
		// LIVE: `fn_effective_limit('storage_megabytes')` + `fn_footprint_usage` for the owner, scoped to
		// a principal the caller may actually read — not yet implemented; fall back to the fixtures.
		const owner = authoriseOwner(actor ?? ANONYMOUS_ACTOR, {
			ownerType: params.ownerType,
			ownerId: params.ownerId,
		});
		if (!owner) {
			return await Promise.resolve(fail(403, { message: "That allowance isn't yours to read." }));
		}
		return await Promise.resolve(ok(resolveQuota(params)));
	}

	// #endregion

	// #region Upload handshake

	/**
	 * Pre-flight a batch of content fingerprints before any bytes move.
	 *
	 * The point is not disk savings — it is telling a person they already have a 400 MB file BEFORE they
	 * wait through re-uploading it. A `sampled-sha-256` match is reported as a candidate and is never
	 * authoritative: two files sharing a head window, a tail window and a length are very probably the
	 * same file and absolutely not certainly the same file, so {@link uploadComplete} must re-digest in
	 * full before it collapses two rows onto one stored object. A false positive there does not save a
	 * copy; it silently replaces one person's file with someone else's.
	 *
	 * The index searched is the ACTOR's own library, resolved here rather than passed in: a duplicate
	 * check that accepted a target owner would answer "does this exact file exist in that person's
	 * library?", which is a content-addressed read of a library the caller may not hold.
	 */
	static async dedupCheck(
		input: DedupCheck,
		actor?: FilesActor,
		sim?: FilesSim,
	): Promise<ServiceResult<DedupVerdict[]>> {
		if (!isFilesBackendLive()) {
			return await Promise.resolve(
				ok(dedupVerdicts(input, fixtureOwner(actor ?? ANONYMOUS_ACTOR), sim)),
			);
		}
		// LIVE: one indexed read of `files.items.content_hash` scoped to the actor's own rows, plus the
		// name probe within the target folder — not yet implemented; fall back to the fixtures. The
		// simulation overlay is deliberately NOT applied on the live path: a real index answer must
		// never be overridden by a client-supplied hint.
		return await Promise.resolve(
			ok(dedupVerdicts(input, fixtureOwner(actor ?? ANONYMOUS_ACTOR))),
		);
	}

	/**
	 * Step 1–2 of the upload handshake: mint the `pending_upload` row and answer with a scoped ticket.
	 *
	 * Bytes never transit an application route. A 500 MB file streamed through a Deno handler occupies a
	 * request worker for minutes and buys nothing — the browser PUTs straight at a short-lived,
	 * single-object signed URL, which is also what lets the quota, dedup and MIME checks all happen
	 * before a person waits.
	 *
	 * A row exists from this first moment, so an abandoned upload is a visible, sweepable
	 * `pending_upload` rather than an orphaned object nobody has a record of.
	 *
	 * The payload's owner is a REQUEST, not the answer: the file is attributed to the principal the
	 * session evidences, and the ticket's first path segment — the RLS anchor the storage policies check
	 * via `(storage.foldername(name))[1]` — is built from THAT. A client-chosen anchor would be a
	 * client-chosen storage policy.
	 */
	static async uploadInit(
		input: UploadInit,
		actor: FilesActor,
	): Promise<ServiceResult<UploadTicket>> {
		if (!isFilesBackendLive()) return initUpload(input, fixtureOwner(actor));
		// LIVE: insert the `pending_upload` row into `files.items` and mint a Supabase Storage signed
		// upload URL over the `quarantine` bucket — not yet implemented; fall back to the fixtures.
		const owner = authoriseOwner(actor, { ownerType: input.ownerType, ownerId: input.ownerId });
		if (!owner) return await Promise.resolve(fail(403, { message: DENIED_OWNER }));
		return initUpload(input, owner);
	}

	/**
	 * Step 3: the object landed. Promotes the row out of `pending_upload`.
	 *
	 * The fixtures go straight to `uploaded`; the live path leaves it `scanning` until the virus/MIME
	 * check clears, because a row that says `uploaded` is a row the hub will hand to someone.
	 */
	static async uploadComplete(
		input: UploadComplete,
		actor: FilesActor,
	): Promise<ServiceResult<AssetItem>> {
		if (!isFilesBackendLive()) return await Promise.resolve(completeUpload(input));
		// LIVE: re-digest the stored object in full (a sampled fingerprint is never authoritative),
		// promote the row to `scanning`, and let the scan worker move it to `uploaded`. The row is
		// addressed by id AND by owner, so a caller cannot finalise an upload they did not start —
		// not yet implemented; fall back to the fixtures.
		void actor;
		return await Promise.resolve(completeUpload(input));
	}

	/**
	 * Store a web link as a first-class asset.
	 *
	 * The URL is resolved SERVER-side for its title and favicon, which makes this the hub's SSRF surface
	 * — every guard is in `./link-scan.ts` and a URL that fails them is refused before anything is
	 * fetched. The favicon is RE-HOSTED, never hotlinked: a hotlink sends every viewer's IP to a host the
	 * link's author chose.
	 */
	static async attachLink(
		input: LinkAttach,
		actor: FilesActor,
	): Promise<ServiceResult<AssetItem>> {
		if (!isFilesBackendLive()) return await storeLink(input, fixtureOwner(actor));
		// LIVE: the same scan, then an insert into `files.items` with `source = 'link'` — not yet
		// implemented; fall back to the fixtures.
		const owner = authoriseOwner(actor, { ownerType: input.ownerType, ownerId: input.ownerId });
		if (!owner) return await Promise.resolve(fail(403, { message: DENIED_OWNER }));
		return await storeLink(input, owner);
	}

	// #endregion

	// #region Mutations

	/** Create a folder. An omitted visibility INHERITS the parent's — the only non-surprising default. */
	static async createFolder(
		input: CreateFolder,
		actor: FilesActor,
	): Promise<ServiceResult<AssetFolder>> {
		if (!isFilesBackendLive()) {
			return await Promise.resolve(makeFolder(input, fixtureOwner(actor)));
		}
		// LIVE: insert into `files.folders` under the caller's JWT — not yet implemented; fall back to
		// the fixtures.
		const owner = authoriseOwner(actor, { ownerType: input.ownerType, ownerId: input.ownerId });
		if (!owner) return await Promise.resolve(fail(403, { message: DENIED_OWNER }));
		return await Promise.resolve(makeFolder(input, owner));
	}

	/**
	 * Rename an asset. The extension is preserved — a person edits the name, not the type.
	 *
	 * The row's own `canManage` is the authority, and it is the SERVER's: a mounted channel attachment
	 * and a connected-drive object are read-only in the hub as a matter of product rule, so this refuses
	 * them regardless of who is asking.
	 */
	static async rename(
		input: RenameAsset,
		actor: FilesActor,
	): Promise<ServiceResult<AssetItem>> {
		if (!isFilesBackendLive()) return await Promise.resolve(renameAsset(input));
		// LIVE: `UPDATE files.items SET name = … WHERE id = … AND deleted_at IS NULL`, under the caller's
		// JWT so RLS bounds the row set, plus the explicit owner predicate below so a policy widened
		// later cannot silently widen this — not yet implemented; fall back to the fixtures.
		void actor;
		return await Promise.resolve(renameAsset(input));
	}

	/**
	 * Move assets into a folder. `targetFolderId: null` moves them to the library root.
	 *
	 * Reports the count that actually moved rather than failing the batch: a mixed selection containing
	 * one read-only mounted file should move the rest, and an all-or-nothing refusal would make the
	 * viewer hunt for which row blocked it.
	 */
	static async move(
		input: MoveAssets,
		actor: FilesActor,
	): Promise<ServiceResult<{ moved: number }>> {
		if (!isFilesBackendLive()) return await Promise.resolve(moveAssets(input));
		// LIVE: one `UPDATE … WHERE id = ANY($1)` bounded by RLS and by the destination folder's owner,
		// so a move can never relocate a row into a library the caller does not hold — not yet
		// implemented; fall back to the fixtures.
		void actor;
		return await Promise.resolve(moveAssets(input));
	}

	/**
	 * Delete assets.
	 *
	 * Nothing is hard-deleted (root CLAUDE.md §5): the live path stamps `files.items.deleted_at`, so the
	 * deletion is recoverable and a share link pointing at the asset stops resolving rather than 500ing.
	 */
	static async remove(
		input: DeleteAssets,
		actor: FilesActor,
	): Promise<ServiceResult<{ removed: number }>> {
		if (!isFilesBackendLive()) return await Promise.resolve(removeAssets(input));
		// LIVE: stamp `deleted_at` (never a `DELETE`), and revoke every share link over the rows in the
		// same transaction — a link that outlives its asset resolves to a 404 the owner never asked for
		// — not yet implemented; fall back to the fixtures.
		void actor;
		return await Promise.resolve(removeAssets(input));
	}

	/**
	 * Change the privacy scope of assets and folders in one call.
	 *
	 * One call because it is one control: a person selecting a mixed set expects one answer, not two
	 * requests with a window in which half their selection is public and half is not. Elevation is
	 * automatic when an asset is attached somewhere; DE-escalation is only ever this explicit action, so
	 * attaching something can never silently narrow access another surface already depends on.
	 */
	static async setVisibility(
		input: SetVisibility,
		actor: FilesActor,
	): Promise<ServiceResult<AssetItem[]>> {
		if (!isFilesBackendLive()) return await Promise.resolve(applyVisibility(input));
		// LIVE: one transaction over `files.items` + `files.folders` so the selection can never be half
		// applied, under the caller's JWT — not yet implemented; fall back to the fixtures.
		void actor;
		return await Promise.resolve(applyVisibility(input));
	}

	// #endregion

	// #region Sharing

	/**
	 * Mint a read-only capability URL over exactly one asset or one folder.
	 *
	 * `createdBy` is a PERSON, not an entity: a link minted while acting for a team is still attributable
	 * to whoever pressed the button, which is the fact an owner needs when a URL turns up somewhere it
	 * should not be. It comes from the session and is never in the payload.
	 */
	static async createShare(
		input: CreateShare,
		actor: FilesActor,
	): Promise<ServiceResult<ShareLink>> {
		if (!isFilesBackendLive()) {
			return await Promise.resolve(mintShare(input, fixtureOwner(actor).ownerId));
		}
		// LIVE: insert into `files.share_links` with a server-minted slug (a client-chosen slug is a
		// client-chosen entropy budget), bounded by RLS to a subject the caller may share — not yet
		// implemented; fall back to the fixtures.
		if (!actor.userId) {
			return await Promise.resolve(fail(403, { message: "Sign in to share a file." }));
		}
		return await Promise.resolve(mintShare(input, actor.userId));
	}

	/**
	 * Revoke a link. Terminal — re-sharing mints a NEW slug, so a leaked URL stays dead.
	 *
	 * An unknown slug and an already-revoked one both answer `{ revoked: false }` with a 200, so the
	 * response cannot be used to probe whether a slug the caller does not hold exists. **That is also why
	 * an unauthorised revoke must answer identically**: a 403 here would confirm the slug is real.
	 */
	static async revokeShare(
		input: RevokeShare,
		actor: FilesActor,
	): Promise<ServiceResult<{ revoked: boolean }>> {
		if (!isFilesBackendLive()) return await Promise.resolve(dropShare(input));
		// LIVE: stamp `files.share_links.revoked_at` WHERE the caller owns the link — a row the caller
		// cannot see updates nothing and falls through to the same `{ revoked: false }` — not yet
		// implemented; fall back to the fixtures.
		void actor;
		return await Promise.resolve(dropShare(input));
	}

	/**
	 * Resolve a share slug.
	 *
	 * Returns the four failure states DISTINCTLY so the service can log and meter them — an owner's "your
	 * link was used after it expired" audit line needs the difference. **The route must collapse all four
	 * into one identical 404 with one identical body**: telling an anonymous caller "this link expired"
	 * rather than "no such link" confirms a link existed, which is the only bit an enumeration attack
	 * needs.
	 *
	 * There is no actor and there must not be one. A share link is a capability URL handed to someone
	 * with no account, so resolution is deliberately anonymous — reading a session here would create a
	 * path by which a signed-in visitor resolves a link a signed-out one cannot.
	 *
	 * `userRef` is an OPAQUE, server-minted per-recipient reference used to attribute a download to the
	 * copy of the link that was actually opened. It is never a handle, a user id or an email — a share
	 * URL gets forwarded and pasted into public places, and personal data must never travel in a query
	 * string (root CLAUDE.md §Privacy).
	 */
	static async resolveShare(
		slug: string,
		userRef?: string | null,
	): Promise<ServiceResult<ShareResolution>> {
		void userRef;
		if (!isFilesBackendLive()) return await Promise.resolve(ok(shares.resolveSlug(slug)));
		// LIVE: read `files.share_links` by slug under the SERVICE ROLE — the resolver has no session to
		// scope by, which is the whole point of a capability URL — then check expiry, revocation and the
		// download limit. Not yet implemented; fall back to the fixtures.
		return await Promise.resolve(ok(shares.resolveSlug(slug)));
	}

	// #endregion

	// #region Downloads

	/**
	 * Whether the acting viewer has already taken a copy — so the hub can offer "you downloaded this on
	 * Tuesday, open it instead" rather than silently handing over a second copy.
	 *
	 * Answered server-side because `localStorage` cannot answer it: it is per-browser, is wiped, and is
	 * wrong the moment the same person opens the asset on their phone.
	 */
	static async downloadGuard(params: {
		assetId: string;
		actorId: string;
		deviceFingerprint: string | null;
	}): Promise<ServiceResult<DownloadGuard>> {
		if (!isFilesBackendLive()) return await Promise.resolve(guardFromFixtures(params));
		// LIVE: one indexed read of `files.download_events` by `(asset_id, actor_id)` — or by
		// `(asset_id, device_fingerprint)` for an anonymous share recipient — not yet implemented; fall
		// back to the fixtures.
		return await Promise.resolve(guardFromFixtures(params));
	}

	/**
	 * Append a download to the ledger.
	 *
	 * **There is no IP address on this event and one must not be added.** An IP is personal data under
	 * GDPR and the single highest-value column in any breach of a table an owner can read, and neither
	 * job the ledger exists for needs it: an owner wants to know a person took a copy, not where they
	 * were standing. Identity is `actorId` when signed in and an opaque, rotating `deviceFingerprint`
	 * when anonymous — enough to answer "again?", deliberately not enough to locate anyone. Abuse
	 * metering is a separate, short-retention concern and belongs at the edge.
	 */
	static async recordDownload(params: {
		assetId: string;
		actorId: string;
		deviceFingerprint: string | null;
		via: DownloadVia;
		shareSlug?: string | null;
	}): Promise<ServiceResult<DownloadEvent>> {
		if (!isFilesBackendLive()) return await Promise.resolve(appendDownload(params));
		// LIVE: bump `files.share_links.download_count` and insert the `files.download_events` row in ONE
		// transaction, so a link with one download left cannot serve two to concurrent requests — the
		// fixture path takes the same order for the same reason. Not yet implemented; fall back.
		return await Promise.resolve(appendDownload(params));
	}

	/** A cursor-paged slice of the ledger for one asset, one actor, or the whole library. */
	static async history(params: {
		assetId?: string;
		actorId?: string;
		cursor?: string | null;
		limit?: number;
	}): Promise<ServiceResult<DownloadHistoryPage>> {
		if (!isFilesBackendLive()) return await Promise.resolve(ok(fx.downloadHistory(params)));
		// LIVE: keyset-paged `files.download_events` under the caller's JWT — RLS is what bounds an
		// `actorId` filter to a ledger the caller may read (see `../../../apps/web/routes/api/files/
		// history.ts`) — not yet implemented; fall back to the fixtures.
		return await Promise.resolve(ok(fx.downloadHistory(params)));
	}

	// #endregion
}

// #region Refusals

/**
 * The one message an unauthorised owner request answers with.
 *
 * Shared so the three write paths cannot drift into three different wordings — a difference between
 * them would be readable as a difference in what the server knows.
 */
const DENIED_OWNER = "You can't add files to that library.";

// #endregion

// #region Fixture-backed bodies
//
// Each is the stub answer for one method, extracted so the method itself is a gate fork and nothing
// else. Keeping them out of the class is what makes the LIVE branch a matter of replacing one call
// rather than unpicking a body that has grown around the fixtures.

/** One asset's row. */
function itemFromFixtures(id: string, sim?: FilesSim): ServiceResult<AssetItem> {
	const item = fx.findAsset(id);
	if (!item) return fail(404, { message: "No such file." });
	// Apply the SAME simulation projection the list read applies. Without this an asset opened in the
	// Inspect panel renders unsimulated while its own row in the grid behind it renders simulated —
	// two different answers about one asset on one screen.
	const [projected] = fx.projectRows([item], sim);
	return ok(projected ?? item);
}

/**
 * Positional duplicate verdicts for one drop, searched within `owner`'s library.
 *
 * A name collision is scoped to the TARGET FOLDER, not the whole library: the same filename in two
 * directories is filing, not a conflict, and prompting about it trains people to dismiss the prompt
 * that matters.
 */
function dedupVerdicts(
	input: DedupCheck,
	owner: AssetOwnerRef,
	sim?: FilesSim,
): DedupVerdict[] {
	return input.fingerprints.map((print, index) => {
		const name = input.names?.[index];

		// The `dedupState` dev axis forces the verdict so the duplicate-resolution panel and its four
		// outcomes are reachable without first contriving a genuine collision — which otherwise means
		// uploading the same file twice, and is impossible to stage at all for `name_collision`.
		//
		// A forced conflict borrows a real corpus row as `existing`, because a prompt that cannot show
		// WHAT it matched asks the person to guess, and a null there would exercise a branch the live
		// path never produces. `new` is honoured too — forcing "definitely not a duplicate" is how you
		// get past the prompt to the plain upload path while the axis is set.
		//
		// The switcher's own `none` never arrives here: `files-seam.ts` treats it as "no overlay" and
		// omits the field entirely, so an unset axis leaves real detection untouched.
		if (sim?.dedupState) {
			if (sim.dedupState === "new") return { verdict: "new", existing: null };
			const existing = fx.anyOwnedAsset(owner.ownerType, owner.ownerId);
			if (existing) return { verdict: sim.dedupState, existing };
		}

		const byHash = fx.findByHash(owner.ownerType, owner.ownerId, print.hash);
		if (byHash) return { verdict: "exact_duplicate", existing: byHash };

		if (name) {
			const byName = fx.findByName(
				owner.ownerType,
				owner.ownerId,
				input.folderId ?? null,
				name,
			);
			if (byName) return { verdict: "name_collision", existing: byName };
		}
		return { verdict: "new", existing: null };
	});
}

/** Meter the allowance, mint the `pending_upload` row, and answer with the scoped ticket. */
async function initUpload(
	input: UploadInit,
	owner: AssetOwnerRef,
): Promise<ServiceResult<UploadTicket>> {
	const quota = resolveQuota(owner);
	const meter = meterUpload(quota, input.sizeBytes);
	if (!meter.allowed) {
		// The ROUTE emits `entitlement.denied` from `meter.deniedEvent` — see the class note.
		return await Promise.resolve(
			fail(422, {
				message: meter.note ?? "This upload exceeds your storage allowance.",
				errors: { quota: `Over by ${meter.overageMib} MB.` },
			}),
		);
	}

	const asset = fx.createPendingAsset({ ...input, ...owner });
	const [verdict] = dedupVerdicts({
		fingerprints: input.fingerprint ? [input.fingerprint] : [{
			algo: "sha-256",
			// An insecure context has no `crypto.subtle`, so a browser may genuinely be unable to
			// fingerprint. That is a degraded experience (no duplicate prompt), never a blocked
			// upload — the absence is modelled rather than rejected.
			hash: "0".repeat(64),
			sizeBytes: input.sizeBytes,
			sampled: false,
		}],
		folderId: input.folderId,
		names: [input.name],
	}, owner);

	const ticket: UploadTicket = {
		assetId: asset.id,
		// EVERY upload lands in quarantine first, whatever its final home. The scan promotes it; a
		// direct write to the destination bucket would mean serving bytes nobody has inspected.
		bucket: "quarantine",
		// The first path segment is the RLS anchor the storage policies check via
		// `(storage.foldername(name))[1]`, so a path built here always satisfies the matching policy —
		// and it is built from the RESOLVED owner, never from the payload's.
		path: `${owner.ownerId}/${asset.id}/${input.name}`,
		signedUrl: isFilesBackendLive()
			? `/storage/v1/object/upload/sign/quarantine/${owner.ownerId}/${asset.id}`
			: "#stub-upload",
		expiresAt: new Date(Date.parse(asset.createdAt) + 15 * 60_000).toISOString(),
		headers: {
			"content-type": input.mimeType,
			// The strength of the digest travels with it, so the server never reads a sampled claim
			// as a full one.
			"x-content-hash": input.fingerprint?.hash ?? "",
			"x-content-hash-sampled": String(
				input.fingerprint?.sampled ?? input.sizeBytes > SAMPLE_THRESHOLD_BYTES,
			),
		},
		dedup: verdict ?? { verdict: "new", existing: null },
	};

	return ok(ticket, {
		status: 201,
		// A metered-but-permitted overage still warns: "you are over your allowance" is a fact worth
		// stating even when it carries no consequence yet.
		message: meter.wouldExceed ? meter.note ?? undefined : undefined,
	});
}

/** Promote a landed object out of `pending_upload`. */
function completeUpload(input: UploadComplete): ServiceResult<AssetItem> {
	const item = fx.completeUpload(input.assetId);
	if (!item) return fail(404, { message: "No such upload." });
	return ok(item, { message: "Upload complete." });
}

/** Resolve a URL's preview under the SSRF guards, then store it as a first-class asset. */
async function storeLink(
	input: LinkAttach,
	owner: AssetOwnerRef,
): Promise<ServiceResult<AssetItem>> {
	const preview = await resolveLinkPreview(input.url);
	if (!preview) {
		return fail(422, {
			message: "That link could not be attached.",
			errors: { url: "Only public https:// links can be attached." },
		});
	}
	if (preview.scanStatus === "blocked") {
		return fail(422, {
			message: "That link was blocked by the safety check.",
			errors: { url: preview.reason ?? "Listed as malicious." },
		});
	}
	const asset = fx.createLinkAsset({
		url: preview.url,
		domain: preview.domain,
		title: preview.title,
		description: preview.description,
		faviconUrl: preview.faviconUrl,
		scanStatus: preview.scanStatus,
		folderId: input.folderId,
		ownerType: owner.ownerType,
		ownerId: owner.ownerId,
	});
	return ok(asset, { status: 201, message: "Link saved." });
}

/** Create a folder under `owner`. */
function makeFolder(input: CreateFolder, owner: AssetOwnerRef): ServiceResult<AssetFolder> {
	const folder = fx.createFolderRow({ ...input, ...owner });
	if (!folder) return fail(403, { message: "That folder can't hold new folders." });
	return ok(folder, { status: 201, message: "Folder created." });
}

/** Rename one asset. */
function renameAsset(input: RenameAsset): ServiceResult<AssetItem> {
	const item = fx.renameAssetRow(input);
	if (!item) return fail(403, { message: "You can't rename this file." });
	return ok(item, { message: "Renamed." });
}

/** Move a batch, reporting the count that actually moved. */
function moveAssets(input: MoveAssets): ServiceResult<{ moved: number }> {
	const moved = fx.moveAssetRows(input);
	if (moved === 0) return fail(403, { message: "Nothing could be moved there." });
	return ok({ moved }, { message: `Moved ${moved} ${moved === 1 ? "file" : "files"}.` });
}

/** Soft-delete a batch, reporting the count that actually went. */
function removeAssets(input: DeleteAssets): ServiceResult<{ removed: number }> {
	const removed = fx.deleteAssetRows(input.assetIds);
	if (removed === 0) return fail(403, { message: "Nothing could be deleted." });
	return ok({ removed }, { message: `Deleted ${removed} ${removed === 1 ? "file" : "files"}.` });
}

/** Re-scope a mixed selection of assets and folders. */
function applyVisibility(input: SetVisibility): ServiceResult<AssetItem[]> {
	const touched = fx.setVisibilityRows(input.assetIds, input.folderIds, input.visibility);
	if (touched.length === 0 && input.folderIds.length === 0) {
		return fail(403, { message: "Nothing could be changed." });
	}
	return ok(touched, { message: "Sharing updated." });
}

/** Mint a read-only capability URL, attributed to the person who created it. */
function mintShare(input: CreateShare, createdBy: string): ServiceResult<ShareLink> {
	const link = shares.createShareLink(input, createdBy);
	if (!link) return fail(404, { message: "No such file or folder." });
	return ok(link, { status: 201, message: "Share link created." });
}

/** Revoke a link, answering identically for unknown and already-revoked slugs. */
function dropShare(input: RevokeShare): ServiceResult<{ revoked: boolean }> {
	const revoked = shares.revokeShareLink(input.slug);
	return ok({ revoked }, {
		message: revoked ? "Share link revoked." : "That link is already closed.",
	});
}

/** Whether this viewer already holds a copy. */
function guardFromFixtures(params: {
	assetId: string;
	actorId: string;
	deviceFingerprint: string | null;
}): ServiceResult<DownloadGuard> {
	if (!fx.findAsset(params.assetId)) return fail(404, { message: "No such file." });
	return ok(
		fx.downloadGuardFor(params.assetId, params.actorId || null, params.deviceFingerprint),
	);
}

/** Append one download to the ledger, counting a share pull against its link first. */
function appendDownload(params: {
	assetId: string;
	actorId: string;
	deviceFingerprint: string | null;
	via: DownloadVia;
	shareSlug?: string | null;
}): ServiceResult<DownloadEvent> {
	const slug = params.shareSlug ?? null;
	if (slug) {
		// A share download must be counted against the link's limit BEFORE it is served, or a link
		// with one download left serves two to a pair of concurrent requests.
		const resolution = shares.resolveSlug(slug);
		if (resolution.state !== "ok") {
			return fail(404, { message: "That link is no longer available." });
		}
		shares.bumpShareDownload(slug);
	}

	const event = fx.recordDownloadEvent({
		assetId: params.assetId,
		actorId: params.actorId || null,
		actorHandle: params.actorId === fx.HUB_OWNER_ID ? fx.HUB_VIEWER.handle : null,
		deviceFingerprint: params.deviceFingerprint,
		via: params.via,
		shareSlug: slug,
	});
	if (!event) return fail(404, { message: "No such file." });
	return ok(event, { status: 201 });
}

// #endregion

// #region Scope resolution

/** An empty page for a scope that resolved to nothing renderable. */
function emptyPage(params: AssetListParams, viewerId: string): AssetListPage {
	return {
		scope: params.scope,
		subjectId: params.subjectId ?? null,
		folderId: params.folderId ?? null,
		items: [],
		folders: [],
		crumbs: [],
		hasMore: false,
		nextCursor: null,
		total: 0,
		viewerId,
		readOnly: true,
		quota: null,
	};
}

/**
 * Resolve one scope read against the fixture corpus.
 *
 * Each scope answers a genuinely different question, so they branch rather than share one query: a hub
 * location has folders and a quota, an engagement scope has neither and is read-only, and a share
 * resolution is a single asset a stranger may hold.
 */
/**
 * Normalise a requested owner onto the one library the fixture corpus actually expresses.
 *
 * While `FILES_BACKEND_LIVE` is off there is exactly one library, keyed on `HUB_OWNER_ID`. Two
 * callers arrive with two different ideas of who is asking: a thin route resolves the owner through
 * `fixtureOwner()`, which ignores the actor entirely, while an SSR resolver derives it from the real
 * `UserContext` — a genuine uuid, or `""` for a session without one. Left unnormalised the two paths
 * disagree about the SAME screen: the server-rendered first paint finds no rows and draws an empty
 * hub with a 0-byte quota, then a client refetch through the route draws the full library over it.
 *
 * Reads therefore normalise exactly as writes already do. This is safe only BECAUSE the gate is off —
 * there is no real data to cross-serve — so it is deliberately confined to the fixture branches and
 * never applied on the live path, where the owner is a real access decision.
 */
function fixtureOwnerRef(
	ownerType: AssetOwnerType,
	ownerId: string,
): { ownerType: AssetOwnerType; ownerId: string } {
	void ownerType;
	void ownerId;
	return { ownerType: fx.HUB_OWNER_TYPE, ownerId: fx.HUB_OWNER_ID };
}

function listFromFixtures(
	params: AssetListParams,
	sim: FilesSim | undefined,
): ServiceResult<AssetListPage> {
	const viewerId = fx.HUB_OWNER_ID;

	switch (params.scope) {
		case "hub": {
			// A `path` of folder names (a deep-linked `/files/a/b/c`) wins over an explicit `folderId`:
			// the URL is what the person shared and navigated to, so it is the more specific intent.
			const byPath = params.path && params.path.length > 0 ? fx.resolvePath(params.path) : null;
			const folderId = byPath?.id ?? params.folderId ?? null;
			if (folderId && !fx.findFolder(folderId)) {
				return fail(404, { message: "No such folder." });
			}

			const slice = fx.sliceAssets(fx.assetsIn(folderId), params);
			return ok({
				scope: "hub",
				subjectId: params.subjectId ?? null,
				folderId,
				items: fx.projectRows(slice.items, sim),
				folders: fx.childFolders(folderId),
				crumbs: fx.crumbsFor(folderId),
				hasMore: slice.hasMore,
				nextCursor: slice.nextCursor,
				total: slice.total,
				viewerId,
				// A mounted section is read-only AS A PLACE, so the surface withholds the upload target
				// and the new-folder control rather than offering them and refusing every attempt.
				readOnly: folderId ? fx.isMountedFolder(folderId) : false,
				quota: resolveQuota({
					ownerType: fx.HUB_OWNER_TYPE,
					ownerId: fx.HUB_OWNER_ID,
					sim,
				}),
			});
		}

		case "channel":
		case "project":
		case "conversation": {
			const subjectId = params.subjectId ?? null;
			if (!subjectId) return fail(422, { message: "That view needs a subject." });
			// Delegates to the corpus that already owns those attachments, so the hub agrees with EVERY
			// project and conversation — not only the two mounted into the library tree.
			const rows = fx.scopedAttachments(params.scope, subjectId, params.channelId ?? null);
			if (!rows) return fail(404, { message: "No such workspace." });
			const slice = fx.sliceAssets(rows, params);
			return ok({
				scope: params.scope,
				subjectId,
				folderId: null,
				items: fx.projectRows(slice.items, sim),
				folders: [],
				crumbs: [],
				hasMore: slice.hasMore,
				nextCursor: slice.nextCursor,
				total: slice.total,
				viewerId,
				readOnly: true,
				// Not metered against the reader's allowance, so drawing a meter here would assert
				// otherwise.
				quota: null,
			});
		}

		case "drive": {
			const connectionId = params.subjectId ?? null;
			if (!connectionId) return fail(422, { message: "That view needs a connection." });
			const folderId = params.folderId ?? null;
			const rows = fx.assetsIn(folderId).filter((it) => it.external?.connectionId === connectionId);
			const slice = fx.sliceAssets(rows, params);
			return ok({
				scope: "drive",
				subjectId: connectionId,
				folderId,
				items: fx.projectRows(slice.items, sim),
				folders: fx.childFolders(folderId),
				crumbs: fx.crumbsFor(folderId),
				hasMore: slice.hasMore,
				nextCursor: slice.nextCursor,
				total: slice.total,
				viewerId,
				readOnly: true,
				quota: null,
			});
		}

		case "share": {
			const slug = params.subjectId ?? null;
			if (!slug) return fail(404, { message: "Not found." });
			const link = shares.findShare(slug);
			const resolution = shares.resolveSlug(slug);

			// A FOLDER link lists that folder's contents. Its assets are projected without the owner's
			// filing system, exactly as a single-asset resolution is.
			if (link && link.folderId && link.revokedAt === null) {
				const folder = fx.findFolder(link.folderId);
				if (!folder) return fail(404, { message: "Not found." });
				const slice = fx.sliceAssets(fx.assetsIn(folder.id), params);
				return ok({
					scope: "share",
					subjectId: slug,
					folderId: folder.id,
					items: slice.items.map((it) => ({
						...it,
						folderId: null,
						folderPath: [],
						canManage: false,
						shareSlug: null,
					})),
					folders: [],
					crumbs: [],
					hasMore: slice.hasMore,
					nextCursor: slice.nextCursor,
					total: slice.total,
					viewerId: "",
					readOnly: true,
					quota: null,
				});
			}

			if (resolution.state !== "ok") return fail(404, { message: "Not found." });
			return ok({
				...emptyPage(params, ""),
				scope: "share",
				subjectId: slug,
				items: [resolution.asset],
				total: 1,
			});
		}
	}
}

// #endregion

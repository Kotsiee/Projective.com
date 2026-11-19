import type { SupabaseClient } from "supabaseClient";
import {
	downloadHref,
	type EntitlementHolderType,
	EntitlementSlug,
	EntitlementStatus,
	ListingLicence,
	type ProductVersionFile,
	ProductVersionFileSchema,
	type Purchase,
	type PurchaseDelivery,
	type PurchaseList,
} from "@projective/types/catalogue";
import { originalLocation } from "@projective/types/files";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { copyObject } from "../../core/storage-signed.ts";
import { fetchStoredObject } from "../../core/storage-stream.ts";
import { getServiceClient, getUserClient, isCatalogueBackendLive } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { isAssetId } from "../files/inspect-dto.ts";
import {
	completeLength,
	contentDisposition,
	forwardHeaders,
	proxyContentType,
	type StreamedAsset,
	type StreamRequest,
	upstreamOutcome,
} from "../media/stream.ts";

/**
 * delivery — a bought product's files, from the frozen version to the buyer (Decision #488;
 * ASSET_DELIVERY_ARCHITECTURE.md §6, Phase 0).
 *
 * Three jobs, in the order a sale meets them:
 *
 *  1. **Materialise** — publishing froze a version (`catalogue.fn_freeze_product_version`); this copies
 *     each of its files from the seller's library into the policy-less `originals` bucket as the
 *     service role, then stamps the version ready. Idempotent: a file already copied is skipped.
 *  2. **Stream** — the gate for `GET|HEAD /api/downloads/[entitlement]/[fileId]`. The entitlement and
 *     its version are read under the CALLER's JWT (gate first, key second: invariant 3); only then do
 *     the bytes move, as the service role, through the app. Every refusal is the same 404; a version
 *     whose copy has not landed is a 503 with Retry-After; a completed body is recorded
 *     (`catalogue.fn_record_delivery`, the A8 fact).
 *  3. **List** — the purchases view: every entitlement the acting account holds, newest first.
 *
 * The transport reuses the media proxy's pieces (`fetchStoredObject`, `upstreamOutcome`,
 * `forwardHeaders`, `contentDisposition`, `proxyContentType`) as they stand; the header policy is the
 * `delivery` class of §5.4.
 */

// #region Types
/** One delivery request, as the thin route parsed it: the proxy's transport fields. */
export type DeliveryRequest = Omit<StreamRequest, "tier" | "share" | "download">;

/** Who an acting context buys and holds as. */
export interface Holder {
	type: EntitlementHolderType;
	id: string;
}

/** The stored row the gate reads (under the caller's JWT). */
interface EntitlementGateRow {
	id: string;
	slug: string;
	status: string;
	holder_type: string;
	holder_id: string;
	version_id: string | null;
	product_id: string | null;
}

/** The version columns the gate reads. */
interface VersionGateRow {
	id: string;
	product_id: string;
	manifest: unknown;
	ready_at: string | null;
}
// #endregion

// #region Pure rules
const NOT_FOUND = "Not found.";
const PREPARING = "This file is still being prepared. Try again in a moment.";
const UNREACHABLE = "We couldn't reach this file just now. Try again in a moment.";
/** How long a client is told to wait while a version's copy lands. */
export const PREPARING_RETRY_SECONDS = 30;

/**
 * The holder an acting context speaks for: the person in a personal context, else the team, business
 * or enterprise being acted as. A context with no id holds nothing.
 */
export function holderOf(
	actor: Pick<ReadActor, "userId" | "contextId" | "contextType">,
): Holder | null {
	if (!actor.userId) return null;
	if (actor.contextType === "personal") return { type: "user", id: actor.userId };
	if (!actor.contextId) return null;
	return { type: actor.contextType, id: actor.contextId };
}

/**
 * Whether the acting context IS the entitlement's holder (ASSET §6 gate 4). RLS already limits the row
 * to the holder or a member of the holding entity; this narrows it to the context the session acts
 * in, so a business member acting personally does not download the business's purchase.
 */
export function actsAsHolder(
	actor: Pick<ReadActor, "userId" | "contextId" | "contextType">,
	row: Pick<EntitlementGateRow, "holder_type" | "holder_id">,
): boolean {
	const holder = holderOf(actor);
	return !!holder && holder.type === row.holder_type && holder.id === row.holder_id;
}

/** Why the entitlement gate refuses (each is the same 404 to the caller), or null when it passes. */
export type EntitlementRefusal = "no_entitlement" | "not_holder" | "not_active" | "no_files";

/**
 * The entitlement half of the gate (ASSET §6 gates 4 and 5), pure: a row the caller's JWT could not
 * read, one held in another context, one refunded or revoked, or one whose product froze no files.
 */
export function entitlementRefusal(
	actor: Pick<ReadActor, "userId" | "contextId" | "contextType">,
	row: Pick<EntitlementGateRow, "status" | "holder_type" | "holder_id" | "version_id"> | null,
): EntitlementRefusal | null {
	if (!row) return "no_entitlement";
	if (!actsAsHolder(actor, row)) return "not_holder";
	if (row.status !== "active") return "not_active";
	if (!row.version_id) return "no_files";
	return null;
}

/** The file of a version this address names (ASSET §6 gate 6), or undefined when it has no such file. */
export function versionFile(manifest: unknown, fileId: string): ProductVersionFile | undefined {
	return versionFiles(manifest).find((f) => f.fileId === fileId);
}

/** The files of a version's manifest that parse; a malformed entry is never served. */
export function versionFiles(manifest: unknown): ProductVersionFile[] {
	if (!Array.isArray(manifest)) return [];
	return manifest.flatMap((entry) => {
		const parsed = ProductVersionFileSchema.safeParse(entry);
		return parsed.success ? [parsed.data] : [];
	});
}

/**
 * The `delivery` class headers (§5.4): never cached, always an attachment named by the version's own
 * display name, same-origin, sandboxed, never sniffed or indexed. Nothing names a host, bucket or path.
 */
export function deliveryHeaders(file: Pick<ProductVersionFile, "name" | "mime">): Headers {
	return new Headers({
		"content-type": proxyContentType(file.mime),
		"content-disposition": contentDisposition(file.name, false),
		"cache-control": "private, no-store",
		vary: "cookie, sec-fetch-dest",
		"x-content-type-options": "nosniff",
		"cross-origin-resource-policy": "same-origin",
		"content-security-policy": "default-src 'none'; sandbox",
		"x-robots-tag": "noindex, nofollow",
		"referrer-policy": "no-referrer",
	});
}

/**
 * Whether a finished response delivered the WHOLE object (ruling A8): a `200` that streamed every
 * byte, or a `206` whose one range ran from the first byte to the last. A partial range, a seek, a
 * `HEAD`, a `304` or an aborted body never counts.
 */
export function deliveredWhole(status: number, headers: Headers, bytesSent: number): boolean {
	if (status === 200) {
		const length = completeLength(headers, true);
		return length !== null && bytesSent === length;
	}
	if (status === 206) {
		const range = headers.get("content-range")?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)\s*$/i);
		if (!range) return false;
		const [start, end, total] = [Number(range[1]), Number(range[2]), Number(range[3])];
		return start === 0 && end === total - 1 && bytesSent === total;
	}
	return false;
}

/**
 * A body that counts the bytes it passes on and calls `onWhole` once it has passed `total` of them to
 * the end. An abort (the browser went away) never reaches `flush`, so a cut download records nothing.
 */
export function countingBody(
	body: ReadableStream<Uint8Array>,
	onDone: (bytesSent: number) => void,
): ReadableStream<Uint8Array> {
	let sent = 0;
	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				sent += chunk.byteLength;
				controller.enqueue(chunk);
			},
			flush() {
				onDone(sent);
			},
		}),
	);
}

/** How a purchase's files stand, from its version. */
export function deliveryOf(version: Pick<VersionGateRow, "ready_at"> | null): PurchaseDelivery {
	if (!version) return "none";
	return version.ready_at ? "ready" : "preparing";
}
// #endregion

// #region Materialise
/**
 * Copy one version's files into `originals` and stamp it ready. Answers whether the version is ready.
 * Service role throughout: the version and the source rows are read only after a seller's publish or a
 * buyer's gate has already passed, and no client path is ever passed in.
 */
export async function materialiseVersion(versionId: string): Promise<boolean> {
	const svc = getServiceClient();
	const { data, error } = await svc.schema("catalogue").from("product_versions")
		.select("id, product_id, manifest, ready_at").eq("id", versionId).maybeSingle();
	if (error || !data) return false;
	const version = data as VersionGateRow;
	if (version.ready_at) return true;

	const files = versionFiles(version.manifest);
	if (files.length === 0) return false;
	const sources = await svc.schema("files").from("items")
		.select("id, bucket_id, storage_path").in("id", files.map((f) => f.fileId));
	if (sources.error) return false;
	const byId = new Map(
		((sources.data ?? []) as { id: string; bucket_id: string; storage_path: string }[]).map((
			s,
		) => [s.id, s]),
	);

	for (const file of files) {
		const target = originalLocation(version.product_id, version.id, file.fileId);
		const head = await fetchStoredObject(target.bucket, target.path, { method: "HEAD" });
		const exists = head.status === 200;
		if (head.body) await head.body.cancel();
		if (exists) continue;
		const source = byId.get(file.fileId);
		if (!source) return false;
		if (!await copyObject(source.bucket_id, source.storage_path, target.bucket, target.path)) {
			return false;
		}
	}

	const stamp = await svc.schema("catalogue").rpc("mark_product_version_ready", {
		p_version: version.id,
	});
	return !stamp.error;
}

/**
 * After a publish: copy every not-yet-ready version of these listings' products. Read under the
 * seller's own session (the seller policy shows them their versions), copied as the service role. A
 * failure is logged, never thrown: the listing is already published, and the download route retries
 * the copy itself.
 */
export async function materialisePublished(
	db: SupabaseClient,
	listingIds: readonly string[],
): Promise<void> {
	if (listingIds.length === 0) return;
	try {
		const listings = await db.schema("catalogue").from("listings")
			.select("product_id").in("id", [...listingIds]);
		const productIds = ((listings.data ?? []) as { product_id: string | null }[])
			.flatMap((l) => l.product_id ? [l.product_id] : []);
		if (productIds.length === 0) return;
		const pending = await db.schema("catalogue").from("product_versions")
			.select("id").in("product_id", productIds).is("ready_at", null);
		for (const row of (pending.data ?? []) as { id: string }[]) {
			if (!await materialiseVersion(row.id)) {
				console.error("[catalogue:delivery] version not copied", row.id);
			}
		}
	} catch (error) {
		console.error("[catalogue:delivery]", error instanceof Error ? error.message : error);
	}
}
// #endregion

// #region Stream
const deliveryLimiter = new SlidingWindowLimiter({ max: 120, windowMs: 60_000 });

/** Only a fresh read spends the allowance: a resumed download's follow-up ranges do not. */
function countsTowardLimit(range: string | null): boolean {
	return range === null || /^\s*bytes\s*=\s*0\s*-/i.test(range);
}

/** Record a completed delivery, as the service role, after the body has gone. Never throws. */
async function recordDelivery(
	entitlementId: string,
	fileId: string,
	actorId: string,
): Promise<void> {
	try {
		const { error } = await getServiceClient().schema("catalogue").rpc("fn_record_delivery", {
			p_entitlement: entitlementId,
			p_file: fileId,
			p_actor: actorId,
		});
		if (error) console.error("[catalogue:delivery] delivery not recorded", error.message);
	} catch (error) {
		console.error("[catalogue:delivery]", error instanceof Error ? error.message : error);
	}
}

/**
 * Stream one file of a purchase to its holder. 404 for every refusal — a malformed address, no
 * session, no such entitlement, one the caller does not hold in this context, one refunded or revoked,
 * a file outside its version; 429 past the per-identity window; 503 (with `retryAfterSeconds`) while
 * the version's copy lands or when storage cannot be reached.
 */
export async function streamDelivery(
	actor: ReadActor,
	entitlementSlug: string,
	fileId: string,
	request: DeliveryRequest,
): Promise<ServiceResult<StreamedAsset>> {
	if (!EntitlementSlug.safeParse(entitlementSlug).success || !isAssetId(fileId)) {
		return fail(404, { message: NOT_FOUND });
	}
	if (!isCatalogueBackendLive() || !canReadLive(actor)) return fail(404, { message: NOT_FOUND });
	try {
		const db = getUserClient(actor.accessToken);
		const ent = await db.schema("catalogue").from("entitlements")
			.select("id, slug, status, holder_type, holder_id, version_id, product_id")
			.eq("slug", entitlementSlug).maybeSingle();
		if (ent.error) return fail(503, { message: UNREACHABLE });
		const row = ent.data as EntitlementGateRow | null;
		if (!row || entitlementRefusal(actor, row) !== null || !row.version_id) {
			return fail(404, { message: NOT_FOUND });
		}

		const ver = await db.schema("catalogue").from("product_versions")
			.select("id, product_id, manifest, ready_at").eq("id", row.version_id).maybeSingle();
		if (ver.error) return fail(503, { message: UNREACHABLE });
		const version = ver.data as VersionGateRow | null;
		const file = version ? versionFile(version.manifest, fileId) : undefined;
		if (!version || !file) return fail(404, { message: NOT_FOUND });

		if (countsTowardLimit(request.range)) {
			const decision = deliveryLimiter.take(`d:${actor.userId}`);
			if (!decision.allowed) {
				return fail(429, {
					message: "Too many downloads just now. Try again shortly.",
					details: { retryAt: new Date(Date.now() + decision.retryAfterMs).toISOString() },
				});
			}
		}

		if (!version.ready_at && !await materialiseVersion(version.id)) {
			return fail(503, {
				message: PREPARING,
				details: { retryAfterSeconds: PREPARING_RETRY_SECONDS },
			});
		}

		const target = originalLocation(version.product_id, version.id, file.fileId);
		const upstream = await fetchStoredObject(target.bucket, target.path, {
			method: request.method,
			range: request.range,
			ifRange: request.ifRange,
			ifNoneMatch: request.ifNoneMatch,
			ifModifiedSince: request.ifModifiedSince,
			signal: request.signal,
		});
		return settleDelivery(upstream, file, request, (sent, headers, status) => {
			if (deliveredWhole(status, headers, sent)) {
				void recordDelivery(row.id, file.fileId, actor.userId);
			}
		});
	} catch (error) {
		if (!request.signal.aborted) {
			console.error("[catalogue:delivery]", error instanceof Error ? error.message : error);
		}
		return fail(503, { message: UNREACHABLE });
	}
}

/** Storage's answer, as the delivery class: forwarded status and validators, our own policy headers. */
async function settleDelivery(
	upstream: Response,
	file: ProductVersionFile,
	request: DeliveryRequest,
	onBody: (sent: number, headers: Headers, status: number) => void,
): Promise<ServiceResult<StreamedAsset>> {
	const outcome = upstreamOutcome(upstream.status);
	const headers = deliveryHeaders(file);
	if (outcome.kind === "missing") {
		if (upstream.body) await upstream.body.cancel();
		// The version says the file is there and storage says it is not: an operator's problem, and to
		// the buyer the same "try again" as an unreachable store, never a 404 that reads as "not yours".
		return fail(503, { message: UNREACHABLE });
	}
	if (outcome.kind === "unsatisfiable") {
		if (upstream.body) await upstream.body.cancel();
		headers.set("accept-ranges", "bytes");
		headers.set("content-range", `bytes */${file.bytes}`);
		return ok({ status: 416, headers, body: null }, { status: 416 });
	}
	forwardHeaders(headers, upstream.headers, outcome.status);
	if (outcome.status === 304 || request.method === "HEAD" || !upstream.body) {
		if (upstream.body) await upstream.body.cancel();
		return ok({ status: outcome.status, headers, body: null }, { status: outcome.status });
	}
	const body = countingBody(upstream.body, (sent) => onBody(sent, headers, outcome.status));
	return ok({ status: outcome.status, headers, body }, { status: outcome.status });
}
// #endregion

// #region Purchases
interface PurchaseRow {
	id: string;
	slug: string;
	status: string;
	licence: string;
	seats: number;
	created_at: string;
	first_delivered_at: string | null;
	order_line_id: string;
	product_versions: VersionGateRow & { version: number } | null;
}

/** Map one entitlement, its version and its receipt to what the purchases view draws. */
export function purchaseOf(
	row: PurchaseRow,
	line: { title: string; order_id: string } | undefined,
	reference: string | undefined,
): Purchase | null {
	const slug = EntitlementSlug.safeParse(row.slug);
	const status = EntitlementStatus.safeParse(row.status);
	const licence = ListingLicence.safeParse(row.licence);
	if (!slug.success || !status.success || !licence.success) return null;
	const version = row.product_versions;
	const delivery = deliveryOf(version);
	const live = status.data === "active" && delivery === "ready";
	return {
		slug: slug.data,
		title: (line?.title ?? "A product you bought").slice(0, 200),
		orderReference: reference ? reference.slice(0, 40) : null,
		purchasedAt: row.created_at,
		licence: licence.data,
		seats: row.seats,
		status: status.data,
		delivery,
		version: version?.version ?? null,
		firstDeliveredAt: row.first_delivered_at,
		files: version
			? versionFiles(version.manifest).map((f) => ({
				fileId: f.fileId,
				name: f.name,
				label: f.label,
				bytes: f.bytes,
				href: live ? downloadHref(slug.data, f.fileId) : null,
			}))
			: [],
	};
}

/**
 * Every entitlement the acting account holds, newest first (at most 200), with the receipt each came
 * from. Read under the caller's JWT: the entitlements policy, then the orders policy, decide what is
 * seen. A signed-out caller or a fixture deployment holds nothing.
 */
export async function listPurchases(actor: ReadActor): Promise<ServiceResult<PurchaseList>> {
	const holder = holderOf(actor);
	if (!isCatalogueBackendLive() || !canReadLive(actor) || !holder) return ok({ purchases: [] });
	try {
		const db = getUserClient(actor.accessToken);
		const ents = await db.schema("catalogue").from("entitlements")
			.select(
				"id, slug, status, licence, seats, created_at, first_delivered_at, order_line_id, " +
					"product_versions!entitlements_version_fkey(id, product_id, version, manifest, ready_at)",
			)
			.eq("holder_type", holder.type).eq("holder_id", holder.id)
			.order("created_at", { ascending: false }).limit(200);
		if (ents.error) return fail(503, { message: "We couldn't load your purchases just now." });
		const rows = (ents.data ?? []) as unknown as PurchaseRow[];
		if (rows.length === 0) return ok({ purchases: [] });

		const lines = await db.schema("finance").from("order_lines")
			.select("id, title, order_id").in("id", rows.map((r) => r.order_line_id));
		const lineById = new Map(
			((lines.data ?? []) as { id: string; title: string; order_id: string }[]).map((
				l,
			) => [l.id, l]),
		);
		const orders = await db.schema("finance").from("orders")
			.select("id, reference").in("id", [
				...new Set([...lineById.values()].map((l) => l.order_id)),
			]);
		const refById = new Map(
			((orders.data ?? []) as { id: string; reference: string }[]).map((o) => [o.id, o.reference]),
		);

		const purchases = rows.flatMap((row) => {
			const line = lineById.get(row.order_line_id);
			const purchase = purchaseOf(row, line, line ? refById.get(line.order_id) : undefined);
			return purchase ? [purchase] : [];
		});
		return ok({ purchases });
	} catch (error) {
		console.error("[catalogue:purchases]", error instanceof Error ? error.message : error);
		return fail(503, { message: "We couldn't load your purchases just now." });
	}
}

/** What a receipt line needs to know about its purchase: its address, standing and files. */
export interface LineEntitlement {
	slug: string;
	status: string;
	/** How its files stand — `none` when the product froze no file. */
	delivery: PurchaseDelivery;
	files: ProductVersionFile[];
}

/**
 * The entitlement of each of these order lines the caller can read — what the order confirmation links
 * a download line with. Read under the caller's own JWT; a line without one (not a product, or not the
 * caller's) is absent.
 */
export async function entitlementsForLines(
	db: SupabaseClient,
	orderLineIds: readonly string[],
): Promise<Map<string, LineEntitlement>> {
	const out = new Map<string, LineEntitlement>();
	if (orderLineIds.length === 0) return out;
	const { data, error } = await db.schema("catalogue").from("entitlements")
		.select(
			"order_line_id, slug, status, product_versions!entitlements_version_fkey(manifest, ready_at)",
		)
		.in("order_line_id", [...orderLineIds]);
	if (error) return out;
	for (
		const row of (data ?? []) as unknown as {
			order_line_id: string;
			slug: string;
			status: string;
			product_versions: { manifest: unknown; ready_at: string | null } | null;
		}[]
	) {
		out.set(row.order_line_id, {
			slug: row.slug,
			status: row.status,
			delivery: deliveryOf(row.product_versions),
			files: row.product_versions ? versionFiles(row.product_versions.manifest) : [],
		});
	}
	return out;
}
// #endregion

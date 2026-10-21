import {
	type AssetFolder,
	type AssetItem,
	type AssetSource,
	categoryToKind,
	describeFile,
	durationLabelOf,
} from "@projective/types/files";
import type { UserConnection } from "@projective/types/integrations";
import type { z } from "zod";
import { clamp, clampOr } from "../../../core/text.ts";
import { fmtDateTime, fmtDay, fmtSize, fmtTime } from "../../files/asset-row.ts";
import { pinnedRequest } from "../../files/link-fetch.ts";
import {
	type StorageAdapterContext,
	StorageAdapterError,
	type StorageAdapterErrorCode,
	type StorageNet,
} from "./StorageAdapter.ts";

/**
 * adapter-support — what every storage connector shares: the HTTP call and its refusal vocabulary, and
 * the ONE projection from a provider object onto the hub's `AssetItem` / `AssetFolder`.
 *
 * The projection is shared for the same reason `services/files/asset-row.ts` is: five connectors
 * drawing their own rows is how a Dropbox file comes to read "2.4 MB" and a Drive file of the same size
 * "2.3 MB". A connector row is always read-only (`canManage: false`), never metered against our quota,
 * private, settled, and carries its provenance in `external` so a later mount is a lookup, not a guess.
 */

// #region Network

const TIMEOUT_MS = 15_000;
const ERROR_SUMMARY_MAX = 160;
const CURSOR_MAX = 600;

/**
 * The most body a pinned request reads: a full 1,000-key `ListObjectsV2` page of 1,024-byte keys,
 * URL-encoded, is about 3 MiB. A larger answer is refused, never cut — a truncated listing is wrong.
 */
export const PINNED_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

/** The adapter's network, with production defaults for every seam the context leaves unset. */
export function netOf(ctx: StorageAdapterContext): StorageNet {
	return {
		fetch: ctx.net?.fetch ?? ((url, init) => fetch(url, init)),
		pinned: ctx.net?.pinned ?? pinnedFetch,
		resolve: ctx.net?.resolve ?? resolveAll,
		now: ctx.net?.now ?? (() => new Date()),
	};
}

const NO_BODY_STATUSES = new Set([204, 205, 304]);

async function pinnedFetch(url: string, init: RequestInit, address: string): Promise<Response> {
	const method = init.method ?? "GET";
	if ((method !== "GET" && method !== "HEAD") || init.body != null) {
		throw new Error("A pinned request is a GET or HEAD without a body.");
	}
	const raw = await pinnedRequest(
		{ method, url: new URL(url), headers: new Headers(init.headers) },
		address,
		Date.now() + TIMEOUT_MS,
		PINNED_RESPONSE_MAX_BYTES,
	);
	if (raw.truncated) throw new Error("The response was larger than a pinned request reads.");
	if (raw.status < 200 || raw.status > 599) throw new Error(`Unexpected status ${raw.status}.`);
	const body = method === "HEAD" || NO_BODY_STATUSES.has(raw.status)
		? null
		: new Uint8Array(raw.body);
	return new Response(body, { status: raw.status, headers: raw.headers });
}

async function resolveAll(hostname: string): Promise<string[]> {
	const [v4, v6] = await Promise.allSettled([
		Deno.resolveDns(hostname, "A"),
		Deno.resolveDns(hostname, "AAAA"),
	]);
	return [
		...(v4.status === "fulfilled" ? v4.value : []),
		...(v6.status === "fulfilled" ? v6.value : []),
	];
}

/** The bearer token an OAuth connector acts under, or a `misconfigured` refusal. */
export function bearerOf(ctx: StorageAdapterContext, provider: string): string {
	const credential = ctx.credential;
	if (credential?.scheme === "bearer" && credential.accessToken.length > 0) {
		return credential.accessToken;
	}
	throw new StorageAdapterError(
		"misconfigured",
		`${provider}: the connection holds no access token.`,
	);
}

/** Provider-specific refusal mapping, consulted before the status-code default. */
export type ErrorClassifier = (status: number, body: string) => StorageAdapterErrorCode | null;

/**
 * One provider request. Redirects are never followed — a credential-bearing request must not be
 * replayed at a host the provider named — and a non-2xx answer becomes a {@link StorageAdapterError}.
 */
export async function providerFetch(
	net: StorageNet,
	provider: string,
	url: string,
	init: RequestInit,
	classify?: ErrorClassifier,
): Promise<Response> {
	let response: Response;
	try {
		response = await net.fetch(url, {
			...init,
			redirect: "manual",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (cause) {
		throw new StorageAdapterError("provider_error", `${provider} could not be reached.`, { cause });
	}
	if (response.ok) return response;

	const body = await response.text().catch(() => "");
	const code = classify?.(response.status, body) ?? codeForStatus(response.status, body);
	const retryAfter = Number(response.headers.get("retry-after"));
	throw new StorageAdapterError(
		code,
		`${provider} answered ${response.status}${summaryOf(body)}.`,
		{
			status: response.status,
			retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
		},
	);
}

/** {@link providerFetch}, read as JSON. */
export async function providerJson<T>(
	net: StorageNet,
	provider: string,
	url: string,
	init: RequestInit,
	classify?: ErrorClassifier,
): Promise<T> {
	const response = await providerFetch(net, provider, url, init, classify);
	try {
		return await response.json() as T;
	} catch (cause) {
		throw new StorageAdapterError("provider_error", `${provider} answered with unreadable JSON.`, {
			cause,
		});
	}
}

function codeForStatus(status: number, body: string): StorageAdapterErrorCode {
	if (status === 401) return "unauthorized";
	if (status === 429 || /rateLimitExceeded/.test(body)) return "rate_limited";
	if (status === 403) return "forbidden";
	if (status === 404 || status === 410) return "not_found";
	return "provider_error";
}

/** A provider's own short error code, when its body names one — never the body itself. */
function summaryOf(body: string): string {
	const match = body.match(/"(?:error_summary|code|reason)"\s*:\s*"([^"]{1,160})"/) ??
		body.match(/<Code>([^<]{1,160})<\/Code>/);
	return match ? ` (${clamp(match[1], ERROR_SUMMARY_MAX)})` : "";
}

/** `null` for a provider's "no such object"; every other refusal still throws. */
export async function orNull<T>(work: Promise<T>): Promise<T | null> {
	try {
		return await work;
	} catch (error) {
		if (error instanceof StorageAdapterError && error.code === "not_found") return null;
		throw error;
	}
}

/**
 * A provider continuation token as the browse contract carries it. A token longer than the contract's
 * bound is refused rather than cut: a truncated token resumes nowhere, silently.
 */
export function continuation(token: string | null | undefined, provider: string): string | null {
	if (!token) return null;
	if (token.length > CURSOR_MAX) {
		throw new StorageAdapterError(
			"provider_error",
			`${provider} returned a continuation token too long to carry.`,
		);
	}
	return token;
}

/** A page size within both the caller's ask and the provider's own ceiling. */
export function pageSize(limit: number, providerMax: number): number {
	return Math.max(1, Math.min(providerMax, Number.isFinite(limit) ? Math.floor(limit) : 50));
}

/** The connection's `config`, parsed against the provider's own schema, or a `misconfigured` refusal. */
export function configOf<S extends z.ZodType>(
	schema: S,
	connection: UserConnection,
	provider: string,
): z.infer<S> {
	const parsed = schema.safeParse(connection.config ?? {});
	if (!parsed.success) {
		throw new StorageAdapterError(
			"misconfigured",
			`${provider}: the connection's settings are incomplete.`,
		);
	}
	return parsed.data;
}

// #endregion

// #region Projection

/** One provider object, normalised just enough to be projected. */
export interface ConnectorObject {
	/** The provider's own id for the object — a Drive file id, a Dropbox `id:`, an S3 key. */
	externalId: string;
	/** The provider's id for the containing folder; `null` at the connection's root. */
	parentId: string | null;
	name: string;
	mimeType: string | null;
	sizeBytes: number;
	/** ISO timestamp of the provider's last change — the browse view's date column. */
	modifiedAt: string | null;
	/** The provider's own "open in …" page — the only safe hand-off. */
	webUrl: string | null;
	/** The provider's change token for delta sync. */
	etag: string | null;
	width?: number | null;
	height?: number | null;
	durationMs?: number | null;
}

/** One provider folder. */
export interface ConnectorFolderObject {
	externalId: string;
	parentId: string | null;
	name: string;
	/** Direct children, when the provider reports it; `0` when it does not. */
	itemCount: number;
	modifiedAt: string | null;
}

const ROW_ID_MAX = 120;

/**
 * The hub row id for a provider object: `{source}:{externalId}`, so two connectors' ids cannot collide.
 * An id too long for the row (an S3 key can run to 1,024 bytes) is digested instead; `external` still
 * carries the provider's own id intact, and that is what a mount reads.
 */
export function connectorRowId(source: AssetSource, externalId: string): string {
	const plain = `${source}:${externalId}`;
	return plain.length <= ROW_ID_MAX ? plain : `${source}:#${digest(externalId)}`;
}

function digest(value: string): string {
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		a = Math.imul(a ^ c, 0x01000193) >>> 0;
		b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
	}
	return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** A value kept only when it fits its field whole — a cut URL or id is worse than none. */
function whole(value: string | null | undefined, max: number): string | null {
	return value && value.length <= max ? value : null;
}

function positiveInt(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 1
		? Math.floor(value)
		: null;
}

function nonNegativeInt(value: number | null | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function instantOf(raw: string | null, now: number): number {
	const ms = raw ? Date.parse(raw) : Number.NaN;
	return Number.isNaN(ms) ? now : ms;
}

/** A provider object as a hub asset row — read-only, private, unmetered, provenance attached. */
export function connectorAsset(
	source: AssetSource,
	connection: UserConnection,
	object: ConnectorObject,
	now: number,
): AssetItem {
	const name = clampOr(object.name, 200, "Untitled");
	const described = describeFile(object.name || name, object.mimeType ?? undefined);
	const sizeBytes = nonNegativeInt(object.sizeBytes);
	const at = instantOf(object.modifiedAt, now);
	const webUrl = whole(object.webUrl, 600);
	const durationMs = object.durationMs ?? 0;
	return {
		id: connectorRowId(source, object.externalId),
		assetId: null,
		kind: categoryToKind(described.category),
		category: described.category,
		name,
		ext: clamp(described.extension, 12),
		url: webUrl ?? "#",
		thumbnailUrl: null,
		sizeBytes,
		sizeLabel: clamp(fmtSize(sizeBytes), 16),
		width: positiveInt(object.width),
		height: positiveInt(object.height),
		durationLabel: durationMs > 0 ? clamp(durationLabelOf(durationMs), 12) : null,

		channelId: null,
		channelName: null,
		channelKind: null,
		messageId: null,
		messageText: null,
		messageAudioUrl: null,
		sender: null,

		createdAt: new Date(at).toISOString(),
		timeLabel: clamp(fmtTime(at), 20),
		dayLabel: clamp(fmtDay(at, now), 24),
		dateLabel: clamp(fmtDateTime(at), 28),
		starred: false,

		source,
		status: "uploaded",
		visibility: "private",
		ownerType: "user",
		ownerId: clampOr(connection.userId, 80, "unknown"),
		folderId: object.parentId ? connectorRowId(source, object.parentId) : null,
		folderPath: [],
		contentHash: null,
		hashSampled: false,
		external: {
			connectionId: clampOr(connection.id, 80, "unknown"),
			providerSlug: clampOr(connection.providerSlug, 40, source),
			externalFileId: object.externalId,
			externalParentId: object.parentId,
			externalWebUrl: webUrl,
			externalEtag: whole(object.etag, 120),
		},
		link: null,
		shareSlug: null,
		downloadCount: 0,
		downloadedByViewer: false,
		canManage: false,
	};
}

/** A provider folder as a hub folder row — read-only, private, sized by the provider (so `0`). */
export function connectorFolder(
	source: AssetSource,
	connection: UserConnection,
	folder: ConnectorFolderObject,
	now: number,
): AssetFolder {
	const at = new Date(instantOf(folder.modifiedAt, now)).toISOString();
	return {
		id: connectorRowId(source, folder.externalId),
		name: clampOr(folder.name, 200, "Untitled folder"),
		parentId: folder.parentId ? connectorRowId(source, folder.parentId) : null,
		path: [],
		ownerType: "user",
		ownerId: clampOr(connection.userId, 80, "unknown"),
		source,
		externalFolderId: folder.externalId,
		visibility: "private",
		itemCount: nonNegativeInt(folder.itemCount),
		sizeBytes: 0,
		sizeLabel: fmtSize(0),
		shareSlug: null,
		canManage: false,
		createdAt: at,
		updatedAt: at,
	};
}

// #endregion

import type { AssetFolder, AssetItem, AssetSource } from "@projective/types/files";
import type { UserConnection } from "@projective/types/integrations";

/**
 * StorageAdapter — the one interface every storage connector implements, and the seam that keeps a
 * connected Google Drive from becoming a second file model.
 *
 * **The adapter returns `AssetItem` and `AssetFolder`, never a provider row.** That is the whole point:
 * the picker, the grid, the table and the preview modal are then literally the same components for a
 * mounted Drive file and a hub-native upload, and the two cannot drift apart in how they are drawn. A
 * connector-shaped return type would need a second card family within a week.
 *
 * **Paging is the PROVIDER's, not ours.** `cursor` is their opaque continuation token echoed back
 * verbatim — a connector that pages by token cannot be resumed from an id we invented, and normalising
 * one into the other loses rows silently at the boundary.
 *
 * **A location is addressed two ways because the two families genuinely differ.** Object stores (Drive,
 * Dropbox, OneDrive, Frame.io) have folder objects with ids; key-prefix stores (S3) have no folder
 * objects at all, only a delimiter convention. {@link DrivePath} carries both rather than forcing one
 * into the other, which would either invent ids or discard the prefix.
 *
 * **Every connector is a real client of its provider's API, never a fixture corpus** (Decision #313):
 * it is handed one connection's unsealed credential for one request and speaks only to that provider's
 * fixed origin. None is reachable yet — no provider is enabled, consents are refused and the vault seals
 * nothing until its KMS envelope exists — so the connections service still refuses browsing and
 * mounting in words. `./mod.ts` is the one door that constructs an adapter, and it refuses while
 * `INTEGRATIONS_BACKEND_LIVE` is off.
 */

// #region Contract

/**
 * A location inside a connected drive. Exactly one of the two fields is meaningful per provider; both
 * `null` addresses the root.
 */
export interface DrivePath {
	/** The provider's own folder id (a Drive file id, a Frame.io folder id). */
	folderId: string | null;
	/** A key prefix, for providers that address by prefix rather than by folder object (S3). */
	path: string | null;
}

/** One level of a connected drive, already projected into the hub's row shapes. */
export interface StorageListing {
	entries: AssetItem[];
	folders: AssetFolder[];
	hasMore: boolean;
	/** The provider's own continuation token, echoed back verbatim. */
	nextCursor: string | null;
}

/**
 * A storage connector.
 *
 * `downloadUrl` and `thumbnailUrl` return **short-lived, provider-minted** URLs and are deliberately
 * async and per-call: caching one on the asset row would persist a credential-bearing URL into a
 * projection the client reads, and a signed URL that outlives its purpose is a leaked capability.
 */
export interface StorageAdapter {
	/** The `integrations.providers.slug` this adapter serves. */
	readonly slug: string;
	/** The `AssetSource` a row it produces carries. */
	readonly source: AssetSource;
	/** List one level. */
	list(path: DrivePath, cursor: string | null, limit: number): Promise<StorageListing>;
	/** One object's full row, or `null` when the provider no longer has it. */
	metadata(id: string): Promise<AssetItem | null>;
	/** A short-lived download URL, or `null` when the provider will not mint one. */
	downloadUrl(id: string): Promise<string | null>;
	/** A short-lived thumbnail URL, or `null` when the object has no visual preview. */
	thumbnailUrl(id: string): Promise<string | null>;
}

/**
 * The unsealed credential an adapter acts under — held for one request, never logged, returned or
 * attached to an error. `bearer` is an OAuth access token; `aws_sigv4` is the key pair an `s3`
 * connection signs every request with, because S3 has no authorization server to mint a token.
 */
export type StorageCredential =
	| { scheme: "bearer"; accessToken: string }
	| {
		scheme: "aws_sigv4";
		accessKeyId: string;
		secretAccessKey: string;
		sessionToken: string | null;
	};

/** The network an adapter speaks through. Injectable so every request it builds is testable offline. */
export interface StorageNet {
	fetch(url: string, init: RequestInit): Promise<Response>;
	/**
	 * `fetch`, but over a connection opened to `address` — one the adapter already resolved and checked
	 * — with TLS verified against the URL's hostname. A host a person chose (a custom S3 endpoint) is
	 * reached only this way: `fetch` would resolve the name again, after the check.
	 */
	pinned(url: string, init: RequestInit, address: string): Promise<Response>;
	/** Every address a hostname resolves to — the custom-endpoint guard refuses a private one. */
	resolve(hostname: string): Promise<string[]>;
	now(): Date;
}

/** What an adapter is constructed with — the connection whose consent it acts under. */
export interface StorageAdapterContext {
	connection: UserConnection;
	/**
	 * The connection's unsealed credential, or `null` when none is stored.
	 *
	 * An adapter that reads a credential it was not given is an adapter that will one day fetch with
	 * someone else's. Retrieved through `../token-vault.ts`, service-role only.
	 */
	credential: StorageCredential | null;
	/** Network overrides for tests; production leaves this unset. */
	net?: Partial<StorageNet>;
}

/** Constructs an adapter for a connection. */
export type StorageAdapterFactory = (ctx: StorageAdapterContext) => StorageAdapter;

// #endregion

// #region Errors

/**
 * Why a provider call failed, in the terms a refusal is worded in: `unauthorized` (reconnect) ·
 * `forbidden` (the grant does not reach it) · `not_found` · `rate_limited` · `misconfigured` (the
 * connection's config or credential cannot address the provider) · `unavailable` (the integrations gate
 * is off, or no client exists) · `provider_error` (the provider failed).
 */
export type StorageAdapterErrorCode =
	| "unauthorized"
	| "forbidden"
	| "not_found"
	| "rate_limited"
	| "misconfigured"
	| "unavailable"
	| "provider_error";

/**
 * A failed provider call. The message names the provider and the status and never carries a request
 * URL, a header or a response body verbatim, so no credential can ride an error into a log line.
 */
export class StorageAdapterError extends Error {
	readonly code: StorageAdapterErrorCode;
	/** The provider's HTTP status, when it answered at all. */
	readonly status: number | null;
	/** The provider's `Retry-After`, in seconds, for a `rate_limited` refusal. */
	readonly retryAfterSeconds: number | null;

	constructor(
		code: StorageAdapterErrorCode,
		message: string,
		options: { status?: number | null; retryAfterSeconds?: number | null; cause?: unknown } = {},
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "StorageAdapterError";
		this.code = code;
		this.status = options.status ?? null;
		this.retryAfterSeconds = options.retryAfterSeconds ?? null;
	}
}

// #endregion

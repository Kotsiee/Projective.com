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
 * Dropbox, Frame.io) have folder objects with ids; key-prefix stores (S3) have no folder objects at all,
 * only a delimiter convention. {@link DrivePath} carries both rather than forcing one into the other,
 * which would either invent ids or discard the prefix.
 *
 * No connector is implemented in this deployment: a real one needs its provider's OAuth client and the
 * token vault's envelope key (`../token-vault.ts`). This interface is the seam it plugs into, and the
 * connections service refuses browsing and mounting in words until one exists.
 */

// #region Contract

/**
 * A location inside a connected drive. Exactly one of the two fields is meaningful per provider; both
 * `null` addresses the root.
 */
export interface DrivePath {
	/** The provider's own folder id (a Drive file id, a Frame.io asset id). */
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

/** What an adapter is constructed with — the connection whose consent it acts under. */
export interface StorageAdapterContext {
	connection: UserConnection;
	/**
	 * The decrypted provider access token.
	 *
	 * An adapter that reads a token it was not given is an adapter that will one day fetch with someone
	 * else's. Retrieved through `../token-vault.ts`, service-role only, and never logged.
	 */
	accessToken: string | null;
}

/** Constructs an adapter for a connection. */
export type StorageAdapterFactory = (ctx: StorageAdapterContext) => StorageAdapter;

// #endregion

import { isIntegrationsBackendLive } from "../../../core/supabase.ts";
import { createDropboxAdapter } from "./DropboxAdapter.ts";
import { createFrameIoAdapter } from "./FrameIoAdapter.ts";
import { createGoogleDriveAdapter } from "./GoogleDriveAdapter.ts";
import { createOneDriveAdapter } from "./OneDriveAdapter.ts";
import { createS3Adapter } from "./S3Adapter.ts";
import {
	type StorageAdapter,
	type StorageAdapterContext,
	StorageAdapterError,
	type StorageAdapterFactory,
} from "./StorageAdapter.ts";

export type {
	DrivePath,
	StorageAdapter,
	StorageAdapterContext,
	StorageAdapterErrorCode,
	StorageCredential,
	StorageListing,
} from "./StorageAdapter.ts";
export { StorageAdapterError } from "./StorageAdapter.ts";
export { s3ExternalIdOf } from "./aws.ts";

/**
 * The storage clients this deployment has, keyed by `integrations.providers.slug` — one per connector
 * `AssetSource`. A catalogue row with no entry here (a calendar, a CRM) stores no files to browse.
 */
const FACTORIES: Readonly<Record<string, StorageAdapterFactory>> = {
	google_drive: createGoogleDriveAdapter,
	dropbox: createDropboxAdapter,
	onedrive: createOneDriveAdapter,
	frameio: createFrameIoAdapter,
	s3: createS3Adapter,
};

/** Whether a provider slug has a storage client. */
export function hasStorageAdapter(providerSlug: string): boolean {
	return Object.hasOwn(FACTORIES, providerSlug);
}

/**
 * The ONE door that constructs a storage adapter, for the connection's own provider.
 *
 * Refused while `INTEGRATIONS_BACKEND_LIVE` is off: an adapter makes outbound calls carrying somebody
 * else's stored credential, which is precisely what that gate exists to keep shut — and it is separate
 * from `FILES_BACKEND_LIVE` so that turning the hub on never starts acting at a third party.
 */
export function createStorageAdapter(ctx: StorageAdapterContext): StorageAdapter {
	if (!isIntegrationsBackendLive()) {
		throw new StorageAdapterError(
			"unavailable",
			"Connected drives are not enabled in this environment.",
		);
	}
	const factory = hasStorageAdapter(ctx.connection.providerSlug)
		? FACTORIES[ctx.connection.providerSlug]
		: null;
	if (!factory) {
		throw new StorageAdapterError(
			"unavailable",
			`${ctx.connection.providerLabel} stores no files to browse.`,
		);
	}
	return factory(ctx);
}

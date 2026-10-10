import { serverEnv } from "./env.ts";
import { encodeObjectPath } from "./storage-url.ts";

/**
 * storage-stream.ts — the service-role byte transport behind the media proxy.
 *
 * `storage-js` cannot forward `Range` or the conditional headers and drops the upstream status, so a
 * seekable stream needs the storage REST endpoint directly. The request goes to the INTERNAL origin
 * (`SUPABASE_URL`) as the service role and never reaches the browser; the caller builds its own response
 * from an allowlist of what comes back.
 *
 * Authorisation is NOT this module's job — the same trust note as `storage-signed.ts`: it is reached only
 * after the fat service has decided the caller may read the row. Never call it with a client-supplied path.
 */

/** What a proxied read forwards to storage. */
export interface StoredObjectRequest {
	method: "GET" | "HEAD";
	range?: string | null;
	ifRange?: string | null;
	ifNoneMatch?: string | null;
	ifModifiedSince?: string | null;
	/** Aborts the upstream read when the browser goes away (a seek, a closed tab). */
	signal?: AbortSignal;
}

/**
 * Fetch one stored object as the service role, forwarding the range and conditional headers.
 *
 * Answers storage's raw response, whatever its status; throws when the project is not configured or the
 * request cannot be made. The caller owns the body and must cancel any it does not forward.
 */
export async function fetchStoredObject(
	bucket: string,
	path: string,
	request: StoredObjectRequest,
): Promise<Response> {
	const env = serverEnv();
	const base = env.supabaseUrl?.replace(/\/+$/, "");
	const key = env.supabaseServiceRoleKey;
	if (!base || !key) throw new Error("Supabase storage is not configured.");
	const encoded = encodeObjectPath(path);
	if (!encoded) throw new Error("A stored object needs a path.");

	const headers = new Headers({ authorization: `Bearer ${key}`, apikey: key });
	if (request.range) headers.set("range", request.range);
	if (request.ifRange) headers.set("if-range", request.ifRange);
	if (request.ifNoneMatch) headers.set("if-none-match", request.ifNoneMatch);
	if (request.ifModifiedSince) headers.set("if-modified-since", request.ifModifiedSince);

	return await fetch(
		`${base}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encoded}`,
		{
			method: request.method,
			headers,
			signal: request.signal,
			redirect: "manual",
		},
	);
}

import {
	LIBRARY_IMAGE_MAX_BYTES,
	type LibraryAsset,
	SNIFF_BYTES,
	sniffBytes,
	unsupportedReason,
} from "@projective/types/files";
import { safeOAuthAvatarUrl } from "@projective/types/user";
import { fail, type ServiceResult } from "../ServiceResult.ts";
import { uploadObject } from "../../core/storage-signed.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { type FetchedPage, guardedFetch, type LinkTransport } from "../files/link-fetch.ts";
import { completeLibraryUpload, initLibraryUpload, quarantinePath } from "./library.ts";

/**
 * oauth-avatar — brings the caller's sign-in picture into their media library through the SAME
 * quarantine pipeline a browser upload takes, so it can be cropped like any other picture.
 *
 * The browser never fetches the provider's bytes: a canvas drawn from `lh3.googleusercontent.com`
 * is tainted, and the URL itself is user-writable metadata. The server fetches it under the link
 * guards (https, pinned DNS, no private addresses, a byte cap and one deadline), re-checks the FINAL
 * host against the provider allowlist after any redirect, sniffs the bytes, declares a quarantine
 * upload under the caller's own session, writes the bytes to that object as the service role and
 * completes it — magic-byte check, decode, WebP tiers, admission to `personal/users/{id}/library/`.
 */

// #region Constants

/** A provider picture is a few hundred KB; anything near the library cap is not a profile photo. */
export const OAUTH_AVATAR_MAX_BYTES = Math.min(8 * 1024 * 1024, LIBRARY_IMAGE_MAX_BYTES);
const ACCEPT = "image/webp,image/png,image/jpeg,image/*;q=0.8";
const FETCH_FAILED =
	"Your sign-in picture couldn't be fetched. Try again, or upload a picture instead.";

// #endregion

// #region Acceptance

/** A fetched provider picture the pipeline may take: its bytes, canonical MIME and extension. */
export interface AcceptedImage {
	bytes: Uint8Array;
	mime: string;
	ext: string;
}

/**
 * Whether a fetched page is a provider picture the pipeline may ingest: a complete 200 from an
 * allowlisted host whose bytes sniff as a processable still. A refusal is the sentence to show.
 */
export function acceptOAuthImage(page: FetchedPage): AcceptedImage | { refusal: string } {
	if (!safeOAuthAvatarUrl(page.url)) return { refusal: FETCH_FAILED };
	if (page.status !== 200 || page.truncated || page.body.length === 0) {
		return { refusal: FETCH_FAILED };
	}
	const sniffed = sniffBytes(page.body.subarray(0, SNIFF_BYTES));
	const reason = unsupportedReason(sniffed, false);
	if (reason || !sniffed) return { refusal: reason ?? FETCH_FAILED };
	return { bytes: page.body, mime: sniffed.mime, ext: sniffed.ext };
}

// #endregion

// #region Ingest

/**
 * Fetch `sourceUrl` (already read from the caller's verified identity) and admit it to their
 * library. Answers with the finished library asset, exactly as a completed browser upload does.
 */
export async function ingestOAuthAvatar(
	actor: ReadActor,
	sourceUrl: string,
	transport?: LinkTransport,
): Promise<ServiceResult<LibraryAsset>> {
	if (!canReadLive(actor)) return fail(401, { message: "Sign in to use your sign-in picture." });
	const url = safeOAuthAvatarUrl(sourceUrl);
	if (!url) return fail(422, { message: "Your sign-in account has no picture we can use." });

	const fetched = await guardedFetch(url, {
		maxBytes: OAUTH_AVATAR_MAX_BYTES,
		accept: ACCEPT,
		transport,
	});
	if (!fetched.ok) return fail(502, { message: FETCH_FAILED });
	const image = acceptOAuthImage(fetched.page);
	if ("refusal" in image) return fail(422, { message: image.refusal });

	const name = `sign-in-picture.${image.ext}`;
	const ticket = await initLibraryUpload(actor, {
		name,
		mimeType: image.mime,
		sizeBytes: image.bytes.length,
	});
	if (!ticket.ok || !ticket.data) return fail(ticket.status, { message: ticket.message });

	const stored = await uploadObject(
		"quarantine",
		quarantinePath(actor.userId, ticket.data.assetId, name),
		image.bytes,
		image.mime,
	);
	if (!stored) return fail(503, { message: FETCH_FAILED });

	return await completeLibraryUpload(actor, {
		assetId: ticket.data.assetId,
		posterDataUrl: null,
		durationMs: null,
	});
}

// #endregion

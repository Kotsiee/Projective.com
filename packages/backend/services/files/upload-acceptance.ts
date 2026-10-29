import { type AssetMetadata, PROCESSABLE_IMAGE_MIME, type Sniffed } from "@projective/types/files";

/**
 * upload-acceptance — what the `/files` hub admits, decided from the sniffed bytes alone.
 *
 * Pure (a sniff verdict and the browser's metadata in, a decision out) so every refusal is unit-tested
 * without storage. `live-uploads.ts` acts on the decision; a refusal's `message` is the sentence the
 * upload drawer shows.
 */

// #region Types
/** The hub's decision for one stored upload. */
export type UploadAcceptance =
	| { ok: false; hostile: boolean; message: string }
	| {
		ok: true;
		/** The MIME type the object is stored and served with — the sniff's, never the client's. */
		mime: string;
		/** A picture the pipeline must decode; a failed decode is a refusal ({@link UNDECODABLE}). */
		decode: boolean;
		/** The browser's metadata, kept only when it does not claim a media kind the bytes lack. */
		metadata: AssetMetadata | undefined;
	};
// #endregion

// #region Decision
export const PROGRAM_REFUSED = "Programs can't be uploaded.";
export const MARKUP_REFUSED = "SVG, HTML and XML files can't be uploaded.";
export const UNDECODABLE =
	"This picture couldn't be read. The file may be damaged — export it again and upload that.";

/**
 * Admit or refuse a sniffed upload. Programs and the markup family (a browser runs script from SVG,
 * HTML and XML) are refused; a sniff miss is stored as `application/octet-stream`, and a client
 * `image` / `video` envelope is dropped unless the bytes are that kind.
 */
export function acceptUpload(
	sniffed: Sniffed | null,
	clientMetadata: AssetMetadata | null | undefined,
): UploadAcceptance {
	if (sniffed?.family === "executable") {
		return { ok: false, hostile: true, message: PROGRAM_REFUSED };
	}
	if (sniffed?.family === "markup") return { ok: false, hostile: false, message: MARKUP_REFUSED };
	const kind = clientMetadata?.media.kind;
	const claimsMedia = kind === "image" || kind === "video";
	return {
		ok: true,
		mime: sniffed?.mime ?? "application/octet-stream",
		decode: !!sniffed && PROCESSABLE_IMAGE_MIME.includes(sniffed.mime),
		metadata: claimsMedia && kind !== sniffed?.family ? undefined : clientMetadata ?? undefined,
	};
}
// #endregion

import {
	type AssetMetadata,
	PROCESSABLE_IMAGE_MIME,
	resolveViewer,
	type Sniffed,
	TEXT_VIEWERS,
} from "@projective/types/files";

/**
 * upload-acceptance — what the `/files` hub admits, decided from the sniffed bytes alone.
 *
 * Pure (a sniff verdict and the browser's metadata in, a decision out) so every refusal is unit-tested
 * without storage. `live-uploads.ts` acts on the decision; a refusal's `message` is the sentence the
 * upload drawer shows.
 *
 * ## Markup is admitted, and made harmless (Decision #396)
 *
 * People deliver websites and diagrams here, so HTML, XML, JavaScript and SVG are ordinary files. The
 * danger is only ever a browser running one from this origin, and three layers stop that:
 *
 * - **HTML, XML and JS stay byte-exact and inert.** Rewriting them would corrupt a delivered site, and
 *   they do not need it: nothing here renders them. The media proxy serves them as `text/plain` (a
 *   stored script can never be loaded as a script, `nosniff` sees to that) with an attachment
 *   disposition and a sandbox CSP, the inspector shows them as escaped source, and storage is told
 *   `text/plain` too, so no read path that is added later can hand a browser a live page.
 * - **SVG is the one that must render**, so it is sanitised on the server (`svg-sanitize.ts`), and
 *   only ever drawn through `<img>`, where script cannot run in any case.
 * - **A file that lies is refused.** Markup bytes under a picture's or a PDF's name are not a
 *   mis-saved file, they are a polyglot, and no canvas could draw them anyway.
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
		/** An SVG: the bytes go through `sanitizeSvg` before anything is stored. */
		sanitize: boolean;
		/** Markup kept as text: filed with storage as `text/plain`, whatever `mime` records. */
		inert: boolean;
	};
// #endregion

// #region Decision
export const PROGRAM_REFUSED = "Programs can't be uploaded.";
export const MARKUP_MISMATCH = "This file's contents don't match its name, so it wasn't uploaded.";
export const UNDECODABLE =
	"This picture couldn't be read. The file may be damaged — export it again and upload that.";

/**
 * Admit or refuse a sniffed upload. Programs are refused. A file named as an SVG is sent to the
 * sanitiser whatever its head looks like, because a comment can push `<svg` past the sniffed bytes;
 * other markup is admitted as inert text under a name that says it is text, and refused under one
 * that does not. A sniff miss is stored as `application/octet-stream`, and a client `image` / `video`
 * envelope is dropped unless the bytes are that kind.
 */
export function acceptUpload(
	sniffed: Sniffed | null,
	clientMetadata: AssetMetadata | null | undefined,
	fileName: string,
): UploadAcceptance {
	if (sniffed?.family === "executable") {
		return { ok: false, hostile: true, message: PROGRAM_REFUSED };
	}
	const kind = clientMetadata?.media.kind;
	const claimsMedia = kind === "image" || kind === "video";
	const { viewer } = resolveViewer(fileName);
	if (viewer === "svg") {
		return {
			ok: true,
			mime: "image/svg+xml",
			decode: false,
			metadata: kind === "image" ? clientMetadata ?? undefined : undefined,
			sanitize: true,
			inert: false,
		};
	}
	if (sniffed?.family === "markup") {
		if (!TEXT_VIEWERS.has(viewer)) return { ok: false, hostile: false, message: MARKUP_MISMATCH };
		return {
			ok: true,
			// SVG text under a text file's name is text: only the sanitiser may file a picture.
			mime: sniffed.mime === "image/svg+xml" ? "application/xml" : sniffed.mime,
			decode: false,
			metadata: claimsMedia ? undefined : clientMetadata ?? undefined,
			sanitize: false,
			inert: true,
		};
	}
	return {
		ok: true,
		mime: sniffed?.mime ?? "application/octet-stream",
		decode: !!sniffed && PROCESSABLE_IMAGE_MIME.includes(sniffed.mime),
		metadata: claimsMedia && kind !== sniffed?.family ? undefined : clientMetadata ?? undefined,
		sanitize: false,
		inert: false,
	};
}
// #endregion

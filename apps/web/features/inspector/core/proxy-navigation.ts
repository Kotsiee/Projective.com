import { fileInspectHref } from "@projective/types/files";

/**
 * proxy-navigation — whether a `/api/media/proxy/[fileId]` request is a person opening the bytes as a
 * page ("Open image in new tab", a pasted address) rather than a canvas fetching them.
 *
 * A top-level navigation is sent to the inspector; every subresource fetch (`<img>`, `<video>`,
 * `fetch()`, `<iframe>`) and every explicit `?download=1` / `?raw=1` keeps streaming bytes.
 */

/** The inspector address a proxy request should be redirected to, or `null` to stream the bytes. */
export function inspectRedirect(req: Request, url: URL, fileId: string): string | null {
	if (req.method !== "GET") return null;
	const sp = url.searchParams;
	if (sp.get("download") === "1" || sp.get("raw") === "1" || sp.get("raw") === "true") return null;
	const dest = req.headers.get("sec-fetch-dest");
	// Browsers without Fetch Metadata fall back to an HTML-first `Accept`.
	const navigation = dest
		? dest === "document"
		: (req.headers.get("accept") ?? "").trim().toLowerCase().startsWith("text/html");
	return navigation ? fileInspectHref(fileId, { share: sp.get("share") }) : null;
}

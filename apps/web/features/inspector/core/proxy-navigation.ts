/**
 * proxy-navigation — whether a `/api/media/proxy/[fileId]` request is a person opening the bytes as a
 * page ("Open image in new tab", a pasted address) rather than a canvas fetching them.
 *
 * A top-level navigation is sent to the inspector (the route asks the media service for the file's
 * `fil-` address, Decision #563); every subresource fetch (`<img>`, `<video>`, `fetch()`, `<iframe>`)
 * and every explicit `?download=1` / `?raw=1` keeps streaming bytes.
 */

/** Whether a proxy request is a page navigation that belongs in the inspector rather than the bytes. */
export function opensAsPage(req: Request, url: URL): boolean {
	if (req.method !== "GET") return false;
	const sp = url.searchParams;
	if (sp.get("download") === "1" || sp.get("raw") === "1" || sp.get("raw") === "true") return false;
	const dest = req.headers.get("sec-fetch-dest");
	// Browsers without Fetch Metadata fall back to an HTML-first `Accept`.
	return dest
		? dest === "document"
		: (req.headers.get("accept") ?? "").trim().toLowerCase().startsWith("text/html");
}

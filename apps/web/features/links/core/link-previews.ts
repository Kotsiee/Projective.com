import { signal } from "@preact/signals";
import { LINK_PREVIEW_BATCH_MAX, type LinkPreview } from "@projective/types/links";
import { LinkPreviewService } from "./LinkPreviewService.ts";

/**
 * link-previews — one page-wide cache of link previews, filled in batches. Every bubble asks for its
 * own links; the asks made in the same tick go out as one request (20 links at most each), and a URL
 * is asked about once per page. A URL the server had no card for — or could not answer about —
 * settles to `null`, which renders the link plainly and keeps an external one behind the interstitial.
 */

/**
 * The hosts that are this platform, for telling an internal link from an external one. Empty until a
 * bubble mounts in the browser, so the server render and the hydrating render classify alike; the
 * product's canonical hosts count either way (`classifyLink`).
 */
export const pageHosts = signal<readonly string[]>([]);

/** Adopt the serving origin's host once the page runs in a browser. */
export function adoptPageHost(): void {
	const host = globalThis.location?.host;
	if (host && !pageHosts.value.includes(host)) pageHosts.value = [...pageHosts.value, host];
}

/** URL → its preview, or `null` once settled without one. Absent while unasked or in flight. */
export const linkPreviews = signal<Readonly<Record<string, LinkPreview | null>>>({});

const asked = new Set<string>();
const queue: string[] = [];
let scheduled = false;

async function flush(): Promise<void> {
	scheduled = false;
	while (queue.length > 0) {
		const batch = queue.splice(0, LINK_PREVIEW_BATCH_MAX);
		const res = await LinkPreviewService.previews(batch);
		const found = res.ok && res.data ? res.data.previews : {};
		const next = { ...linkPreviews.value };
		for (const url of batch) next[url] = found[url] ?? null;
		linkPreviews.value = next;
	}
}

/** Ask for the previews of `urls`; already-asked URLs are skipped. */
export function requestLinkPreviews(urls: readonly string[]): void {
	for (const url of urls) {
		if (asked.has(url)) continue;
		asked.add(url);
		queue.push(url);
	}
	if (queue.length === 0 || scheduled) return;
	scheduled = true;
	queueMicrotask(() => void flush());
}

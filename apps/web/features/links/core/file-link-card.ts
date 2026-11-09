import { formatBytes } from "@features/projects/core/composer-model.ts";

/**
 * file-link-card — the words on a file's link card (Decision #401): what it is and how big, and the
 * address it opens, as the card's footer prints it. Pure, so the card renders the same on the server
 * and in the browser.
 */

/** The facts a card's meta line reads. */
export interface FileCardFacts {
	/** The extension, lower-cased, without the dot. */
	ext: string;
	/** A type in words ("Document", "PDF"), preferred over the extension when known. */
	typeLabel?: string | null;
	sizeBytes?: number | null;
	/** An already-formatted size, used when the byte count is not at hand. */
	sizeLabel?: string | null;
}

/** "PDF · 2.4 MB": the type, then the size, either left out when unknown. */
export function fileCardMeta(facts: FileCardFacts): string {
	const type = facts.typeLabel?.trim() || facts.ext.trim().toUpperCase();
	const size = typeof facts.sizeBytes === "number" && facts.sizeBytes > 0
		? formatBytes(facts.sizeBytes)
		: facts.sizeLabel?.trim() || "";
	return [type, size].filter((part) => part.length > 0).join(" · ");
}

/**
 * The address a card's footer prints: the host it lives on, then the path, without the scheme or a
 * trailing slash. `host` is empty until the page knows its own (during server rendering), when the
 * path alone is printed.
 */
export function fileCardUrl(href: string, host: string): string {
	let path = href;
	try {
		const url = new URL(href, "https://projective.invalid");
		path = `${url.pathname}${url.search}`;
	} catch {
		path = href;
	}
	const trimmed = path.replace(/\/+$/, "");
	return host ? `${host}${trimmed}` : trimmed.replace(/^\//, "");
}

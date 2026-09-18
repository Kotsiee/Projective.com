import type { ShareRequest } from "./share-request.ts";

/**
 * share-targets — the external destinations the share modal offers, and how each is addressed.
 *
 * Pure and unit-tested: every destination is a URL template over the request, and a wrong template
 * fails silently at the far end (an app that opens with an empty composer says nothing about why).
 * The intents are the public, documented web endpoints — the only kind a web page can reach
 * without an SDK, an app token or a native bridge:
 *
 *  - WhatsApp  `https://wa.me/?text=…`                            (text carries the link)
 *  - Telegram  `https://t.me/share/url?url=…&text=…`
 *  - X         `https://x.com/intent/post?url=…&text=…`
 *  - Facebook  `https://www.facebook.com/sharer/sharer.php?u=…`  (the sharer ignores any text)
 *  - Snapchat  `https://www.snapchat.com/scan?attachmentUrl=…`   (Creative Kit's web entry)
 *
 * **Instagram has no web share intent.** There is no URL that opens Instagram with a link or a
 * caption pre-filled; sharing into it is possible only through the device's own share sheet
 * (`navigator.share`, which lists Instagram wherever it is installed) or by pasting. So its button
 * is honest about that: it hands the share to the native sheet where one exists, and otherwise
 * copies the link and opens Instagram for the viewer to paste into. That is recorded here as a
 * distinct `mode` rather than a fake URL, so the modal cannot render a button that appears to work
 * and opens a page with nothing in it.
 */

// #region Targets
export type ExternalShareTarget =
	| "whatsapp"
	| "telegram"
	| "x"
	| "facebook"
	| "snapchat"
	| "instagram";

/** How a target is reached. `intent` opens a URL; `sheet-or-paste` has no URL of its own. */
export type ShareTargetMode = "intent" | "sheet-or-paste";

export interface ShareTargetSpec {
	key: ExternalShareTarget;
	label: string;
	mode: ShareTargetMode;
}

/** The quick-action order the modal renders (the brief's list, verbatim). */
export const SHARE_TARGETS: readonly ShareTargetSpec[] = [
	{ key: "snapchat", label: "Snapchat", mode: "intent" },
	{ key: "whatsapp", label: "WhatsApp", mode: "intent" },
	{ key: "facebook", label: "Facebook", mode: "intent" },
	{ key: "instagram", label: "Instagram", mode: "sheet-or-paste" },
	{ key: "x", label: "X", mode: "intent" },
	{ key: "telegram", label: "Telegram", mode: "intent" },
];

/** Where the paste-mode target sends the viewer after the link is on their clipboard. */
export const INSTAGRAM_HOME = "https://www.instagram.com/";
// #endregion

// #region Composition
/** The sentence carried into an app that takes text: the title, then the note if there is one. */
export function composeShareText(request: Pick<ShareRequest, "title" | "text">): string {
	const title = request.title.trim();
	const text = (request.text ?? "").trim();
	if (title && text) return `${title} — ${text}`;
	return title || text;
}

/** The message body an INTERNAL share posts: the note (or the title), then the link on its own line. */
export function composeInternalMessage(
	request: Pick<ShareRequest, "title" | "text" | "url">,
	note: string,
): string {
	const lead = note.trim() || composeShareText(request);
	return lead ? `${lead}\n${request.url}` : request.url;
}

/**
 * The URL that opens a target with this request, or `null` for a target that has none
 * (Instagram — see the module docblock). Every value is `encodeURIComponent`-escaped exactly once.
 */
export function externalShareUrl(
	target: ExternalShareTarget,
	request: Pick<ShareRequest, "url" | "title" | "text">,
): string | null {
	const url = encodeURIComponent(request.url);
	const text = composeShareText(request);
	const enc = encodeURIComponent(text);
	switch (target) {
		case "whatsapp":
			return `https://wa.me/?text=${
				encodeURIComponent(text ? `${text} ${request.url}` : request.url)
			}`;
		case "telegram":
			return `https://t.me/share/url?url=${url}${text ? `&text=${enc}` : ""}`;
		case "x":
			return `https://x.com/intent/post?url=${url}${text ? `&text=${enc}` : ""}`;
		case "facebook":
			return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
		case "snapchat":
			return `https://www.snapchat.com/scan?attachmentUrl=${url}`;
		case "instagram":
			return null;
	}
}
// #endregion

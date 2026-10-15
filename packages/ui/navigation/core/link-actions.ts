import type { MenuItem } from "../../types/mod.ts";

// #region Types
/** One browser utility row a linkable card can offer. */
export type LinkAction = "open" | "open-new-tab" | "copy-link" | "share" | "save";

/** Input to {@link linkActionItems}. */
export interface LinkActionsInput {
	/** The entity's canonical href — relative or absolute. */
	href: string;
	/** The entity's name, carried into the device share sheet. */
	title: string;
	/** Rows to offer, in menu order (default: every row the platform and the caller can honour). */
	include?: readonly LinkAction[];
	/** The app's share flow. Omitted: the device share sheet where one exists, else no Share row. */
	onShare?: () => void;
	/** Save state and its toggle. Omitted: no Save row. */
	save?: { saved: boolean; onToggle: () => void };
	/** Told whether Copy link reached the clipboard, so the host can confirm or explain. */
	onCopied?: (ok: boolean) => void;
}

interface ClipboardLike {
	writeText?: (text: string) => Promise<void>;
}

interface NavigatorLike {
	clipboard?: ClipboardLike;
	share?: (data: { title?: string; url?: string }) => Promise<void>;
}
// #endregion

const ALL: readonly LinkAction[] = ["open", "open-new-tab", "copy-link", "share", "save"];

function nav(): NavigatorLike | undefined {
	return (globalThis as { navigator?: NavigatorLike }).navigator;
}

/** `href` resolved against the current document, or unchanged outside a browser. */
export function absoluteHref(href: string): string {
	const base = (globalThis as { location?: { href?: string } }).location?.href;
	if (!base) return href;
	try {
		return new URL(href, base).toString();
	} catch {
		return href;
	}
}

/** Write `href` (made absolute) to the clipboard; resolves whether it landed. */
export async function copyLink(href: string): Promise<boolean> {
	const writeText = nav()?.clipboard?.writeText;
	if (!writeText) return false;
	try {
		await writeText.call(nav()?.clipboard, absoluteHref(href));
		return true;
	} catch {
		return false;
	}
}

/**
 * The browser utility rows for a card or list item that stands for a linkable entity: Open · Open in
 * new tab · Copy link · Share · Save. A row the platform or caller cannot honour is left out, never
 * rendered inert (UI gate 11): Share needs `onShare` or the device sheet, Save needs `save`.
 */
export function linkActionItems(input: LinkActionsInput): MenuItem[] {
	const wanted = input.include ?? ALL;
	const share = input.onShare ??
		(typeof nav()?.share === "function"
			? () => {
				nav()?.share?.({ title: input.title, url: absoluteHref(input.href) }).catch((error) => {
					if (error instanceof Error && error.name === "AbortError") return;
					void copyLink(input.href).then((ok) => input.onCopied?.(ok));
				});
			}
			: undefined);

	const rows: Record<LinkAction, MenuItem | null> = {
		open: { key: "link-open", label: "Open", icon: "arrow-right", url: input.href },
		"open-new-tab": {
			key: "link-open-new-tab",
			label: "Open in new tab",
			icon: "external-link",
			url: input.href,
			target: "_blank",
		},
		"copy-link": {
			key: "link-copy",
			label: "Copy link",
			icon: "link",
			command: () => {
				void copyLink(input.href).then((ok) => input.onCopied?.(ok));
			},
		},
		share: share ? { key: "link-share", label: "Share", icon: "share", command: share } : null,
		save: input.save
			? {
				key: "link-save",
				label: input.save.saved ? "Remove from saved" : "Save",
				icon: "bookmark",
				command: input.save.onToggle,
			}
			: null,
	};

	return wanted.map((action) => rows[action]).filter((row): row is MenuItem => row !== null);
}

/** Join non-empty row groups with separators, so a host can stack link rows over its own actions. */
export function composeMenu(...groups: ReadonlyArray<readonly MenuItem[]>): MenuItem[] {
	const out: MenuItem[] = [];
	for (const group of groups) {
		if (group.length === 0) continue;
		if (out.length > 0) out.push({ separator: true });
		out.push(...group);
	}
	return out;
}

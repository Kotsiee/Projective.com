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

/** Input to {@link linkOpenItem}. */
export interface LinkOpenInput {
	/** The page the row opens — relative or absolute. */
	href: string;
	/** The row's label (default `"Open"`). */
	label?: string;
	/** Stable key (default derived from `href`). */
	key?: string;
	/** Leading icon (default `arrow-right`); ignored when `image` is given. */
	icon?: string;
	/** Leading picture — see {@link MenuItem.image}. */
	image?: string | null;
	/** One line of meta text under the label. */
	hint?: string;
	/** Told whether Copy link reached the clipboard, so the host can confirm or explain. */
	onCopied?: (ok: boolean) => void;
	/** Offer Copy link in the submenu (default `true`); `false` when the host lists it beside the row. */
	copy?: boolean;
	/** How the submenu opens — see {@link MenuItem.submenuOn}. */
	submenuOn?: MenuItem["submenuOn"];
}

/**
 * Open `href` in a new browser window. shortcut: the web can only ask for a popup-style window (no
 * tab strip); a full window needs the browser's own menu.
 */
export function openInNewWindow(href: string): void {
	(globalThis as { open?: (url: string, target: string, features: string) => unknown }).open?.(
		absoluteHref(href),
		"_blank",
		"popup,noopener,noreferrer",
	);
}

/**
 * A link row that is itself the Open action: pressing it opens the page, and hovering it (or
 * ArrowRight) unfolds Open · Open in new tab · Open in new window · Copy link — or, with
 * `submenuOn: "contextmenu"`, only a right-click on it does. It renders as an anchor, so a
 * middle-click opens it in a new tab like any link. A tab group or a private window has no web API,
 * so neither is offered (UI gate 11).
 */
export function linkOpenItem(input: LinkOpenInput): MenuItem {
	const { href, onCopied } = input;
	const label = input.label ?? "Open";
	return {
		key: input.key ?? `open:${href}`,
		label,
		icon: input.image === undefined ? (input.icon ?? "arrow-right") : undefined,
		image: input.image,
		hint: input.hint,
		url: href,
		submenuOn: input.submenuOn,
		items: composeMenu(
			[
				...linkActionItems({ href, title: label, include: ["open", "open-new-tab"] }),
				{
					key: "link-open-new-window",
					label: "Open in new window",
					icon: "arrow-up-right",
					command: () => openInNewWindow(href),
				},
			],
			input.copy === false
				? []
				: linkActionItems({ href, title: label, include: ["copy-link"], onCopied }),
		),
	};
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

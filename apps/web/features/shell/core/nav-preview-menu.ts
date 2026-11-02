// The logic modules, not the barrels: those import stylesheets, which a unit test cannot load.
import { linkOpenItem } from "@ui/navigation/core/link-actions.ts";
import type { MenuItem } from "@ui/types/mod.ts";
import { formatRelative } from "@ui/display/core/table-format.ts";
import type { NavPreviewKind } from "@projective/types/user";
import { workspaceHref } from "@projective/types/workspace";
import { conversationHref } from "@web/features/messaging/core/conversation-model.ts";
import { listingHref } from "@web/features/catalogue/core/catalogue-model.ts";
import type { NavPreviewState } from "./nav-preview-state.ts";

/**
 * nav-preview-menu — the rows a rail destination's right-click menu lists under its Open row
 * (Decision #370): the preview's items as Open rows (press to open; hover for a new tab, a new window
 * or Copy link), or one inert row saying it is loading, empty or unavailable.
 */

/** The rail entries that preview their contents, by nav-model key. */
export const PREVIEW_KIND: Readonly<Record<string, NavPreviewKind>> = {
	messages: "messages",
	projects: "projects",
	catalogue: "catalogue",
	teams: "teams",
	businesses: "businesses",
};

const EMPTY: Record<NavPreviewKind, string> = {
	messages: "No conversations yet",
	projects: "No projects yet",
	catalogue: "No listings yet",
	teams: "No teams yet",
	businesses: "No businesses yet",
};

/** What the kind calls a pin: conversations and projects are starred, listings and profiles saved. */
const PINNED: Record<NavPreviewKind, string> = {
	messages: "Starred",
	projects: "Starred",
	catalogue: "Saved",
	teams: "Saved",
	businesses: "Saved",
};

/** Where a preview row opens. */
export function previewHref(kind: NavPreviewKind, ref: string): string {
	switch (kind) {
		case "messages":
			return conversationHref(ref);
		case "projects":
			return `/projects/${encodeURIComponent(ref)}`;
		case "catalogue":
			return listingHref(ref);
		case "teams":
			return workspaceHref("team", ref);
		case "businesses":
			return workspaceHref("business", ref);
	}
}

/** The menu rows for one destination's preview at `now`. */
export function previewRows(
	kind: NavPreviewKind,
	state: NavPreviewState | undefined,
	now: number,
	locale: string,
	onCopied?: (ok: boolean) => void,
): MenuItem[] {
	if (!state || state.status === "loading") {
		return [{
			key: "preview-loading",
			label: "Loading…",
			disabled: true,
			class: "shell-preview--loading",
		}];
	}
	if (state.status === "error") {
		return [{ key: "preview-error", label: "Couldn't load these right now", disabled: true }];
	}
	if (state.items.length === 0) {
		return [{ key: "preview-empty", label: EMPTY[kind], disabled: true }];
	}
	return state.items.map((item) =>
		linkOpenItem({
			key: `preview:${item.ref}`,
			href: previewHref(kind, item.ref),
			label: item.title,
			image: item.image,
			hint: [
				item.pinned ? PINNED[kind] : "",
				item.at ? formatRelative(Date.parse(item.at), now, locale) : "",
				item.detail,
			].filter(Boolean).join(" · "),
			onCopied,
		})
	);
}

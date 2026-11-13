import type { NotificationCategory } from "@projective/types/comms";
import type { IconName } from "@projective/ui/icons";
import type { InboxTab, InboxView } from "./notification-model.ts";

/** The glyph each category filter, and each category's platform rows, is drawn with. */
export const CATEGORY_ICON: Readonly<Record<NotificationCategory, IconName>> = {
	money: "wallet",
	work: "board",
	messages: "message",
	schedule: "calendar",
	discovery: "explore",
	account: "user",
	system: "settings",
	marketing: "tag",
};

/** The category filters' glyphs, "All categories" included. */
export const TAB_ICON: Readonly<Record<InboxTab, IconName>> = { all: "grid", ...CATEGORY_ICON };

/** The status views' glyphs. */
export const VIEW_ICON: Readonly<Record<InboxView, IconName>> = {
	all: "inbox",
	unread: "bell",
	archived: "archive-box",
};

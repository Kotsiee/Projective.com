import type { NotificationSummary } from "@projective/types/comms";
import type { Option } from "@projective/ui/fields";
import { countLabel, INBOX_TABS, TAB_LABEL, tabUnread } from "./notification-model.ts";

/**
 * The category `Select`'s options for the drawer and the phone filter bar: every category, each with
 * its unread figure as the option's quieter second line once there is one.
 */
export function categoryOptions(summary: NotificationSummary | null): Option[] {
	return INBOX_TABS.map((tab) => {
		const unread = tabUnread(summary, tab);
		return {
			value: tab,
			label: TAB_LABEL[tab],
			description: unread > 0 ? `${countLabel(unread)} unread` : undefined,
		};
	});
}

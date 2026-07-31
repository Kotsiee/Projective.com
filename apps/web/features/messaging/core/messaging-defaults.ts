import type { MessagingSettings } from "../types/messaging-types.ts";

/**
 * messaging-defaults — the fallback {@link MessagingSettings} projection used when the fat service
 * cannot resolve one (the stub gate, or a transport failure). Declared once here rather than inlined
 * at the call site, so the lane resolver and any future consumer cannot drift into two different
 * "defaults" for the same modal.
 */
export const DEFAULT_MESSAGING_SETTINGS: MessagingSettings = {
	autoResponsesEnabled: false,
	autoResponses: [],
	readReceipts: true,
	showTypingIndicator: true,
	notifications: {
		newMessage: true,
		mentions: true,
		groupActivity: true,
		serviceInquiries: true,
		sound: true,
		muteAll: false,
		quietHoursEnabled: false,
		quietStart: "22:00",
		quietEnd: "08:00",
	},
};

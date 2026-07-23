import type { MessagingRole, MessagingSettings } from "@projective/types/messaging";

/**
 * messaging settings fixtures — the fat {@link MessagingBackendService}'s in-memory answer for the
 * Message Settings modal (auto-responses + notification preferences), while `MESSAGING_BACKEND_LIVE`
 * is off. Deterministic; the auto-response rules are seeded per acting view (a freelancer/business
 * offers service/product auto-replies; a client sees none by default). The write path is a client-side
 * stub until the backend owns `messages.auto_responses` / `messages.notification_prefs`.
 */

/** The default notification preferences (all the common events on; quiet hours configured but off). */
function defaultNotifications(): MessagingSettings["notifications"] {
	return {
		newMessage: true,
		mentions: true,
		groupActivity: true,
		serviceInquiries: true,
		sound: true,
		muteAll: false,
		quietHoursEnabled: false,
		quietStart: "22:00",
		quietEnd: "08:00",
	};
}

/** Seed auto-response rules — provider views (freelancer/business) get service/product greetings. */
function seedAutoResponses(role: MessagingRole): MessagingSettings["autoResponses"] {
	if (role === "client") return [];
	return [
		{
			id: "ar-brand-greeting",
			enabled: true,
			name: "Brand inquiry greeting",
			trigger: "service",
			serviceId: "s_brand_identity",
			serviceName: "Brand Identity Sprint",
			productId: null,
			productName: null,
			keyword: null,
			message:
				"Thanks for reaching out about the Brand Identity Sprint! I typically reply within a few hours. To get us started, could you share a bit about your brand and timeline?",
			aiAssist: false,
		},
		{
			id: "ar-uikit-licence",
			enabled: false,
			name: "UI Kit licence auto-reply",
			trigger: "product",
			serviceId: null,
			serviceName: null,
			productId: "p_ui_kit",
			productName: "Aurora UI Kit",
			keyword: null,
			message:
				"Hi! The Aurora UI Kit includes a single-seat licence by default; team licences are available — happy to send a quote.",
			aiAssist: true,
		},
		{
			id: "ar-away",
			enabled: false,
			name: "Away message",
			trigger: "any",
			serviceId: null,
			serviceName: null,
			productId: null,
			productName: null,
			keyword: null,
			message: "Thanks for your message! I'm away until Monday and will reply as soon as I'm back.",
			aiAssist: false,
		},
	];
}

/** Resolve the current messaging settings for the acting view. */
export function findSettings(role: MessagingRole): MessagingSettings {
	return {
		autoResponsesEnabled: role !== "client",
		autoResponses: seedAutoResponses(role),
		notifications: defaultNotifications(),
		readReceipts: true,
		showTypingIndicator: true,
	};
}

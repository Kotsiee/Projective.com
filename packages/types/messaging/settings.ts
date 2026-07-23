import { z } from "zod";

/**
 * messaging.settings — the Zod SSOT for the Message Settings modal (task §2D), reached from the
 * `/messages` sidebar's Settings gear. It projects two concerns: the viewer's **auto-response** rules
 * (custom automated greetings / inquiry replies for incoming client messages about a specific service
 * or product, ready for a future AI plug-in) and their **notification** preferences (per-event toggles
 * + mute + quiet hours).
 *
 * A read/write projection over the eventual `messages.auto_responses` / `messages.notification_prefs`
 * tables — only primitives + shallow objects, stable across Zod majors (matching the sibling schemas).
 * The write path is stubbed client-side until `MESSAGING_BACKEND_LIVE` owns it (root CLAUDE.md §1).
 */

// #region Auto-responses
/**
 * What triggers an auto-response. `any` fires on any first incoming message; `service`/`product` fire
 * only when the inbound conversation is about a specific offering; `keyword` matches inbound text.
 */
export const AutoResponseTrigger = z.enum(["any", "service", "product", "keyword"]);
export type AutoResponseTrigger = z.infer<typeof AutoResponseTrigger>;

/** One configured automated response. */
export const AutoResponseRuleSchema = z.object({
	id: z.string().min(1).max(80),
	/** Whether this rule is active. */
	enabled: z.boolean(),
	/** A short human name for the rule (e.g. "Brand inquiry greeting"). */
	name: z.string().min(1).max(120),
	trigger: AutoResponseTrigger,
	/** The service this rule scopes to (`trigger === "service"`); null otherwise. */
	serviceId: z.string().max(80).nullable(),
	serviceName: z.string().max(120).nullable(),
	/** The product this rule scopes to (`trigger === "product"`); null otherwise. */
	productId: z.string().max(80).nullable(),
	productName: z.string().max(120).nullable(),
	/** The inbound keyword this rule matches (`trigger === "keyword"`); null otherwise. */
	keyword: z.string().max(80).nullable(),
	/** The message body sent automatically. */
	message: z.string().min(1).max(2000),
	/**
	 * Whether this rule is handled by the (future) AI assistant rather than sending the static `message`
	 * verbatim. A forward-looking flag — the plug-in point for AI-drafted replies; inert today.
	 */
	aiAssist: z.boolean(),
});
export type AutoResponseRule = z.infer<typeof AutoResponseRuleSchema>;
// #endregion

// #region Notification preferences
/** Per-event + global notification preferences. */
export const NotificationPreferencesSchema = z.object({
	/** Notify on any new direct message. */
	newMessage: z.boolean(),
	/** Notify when the viewer is @-mentioned. */
	mentions: z.boolean(),
	/** Notify on activity in group conversations. */
	groupActivity: z.boolean(),
	/** Notify on a new inbound service/product inquiry (provider side). */
	serviceInquiries: z.boolean(),
	/** Play a sound on a new message. */
	sound: z.boolean(),
	/** Master mute — suppresses ALL notifications regardless of the per-event flags. */
	muteAll: z.boolean(),
	/** Whether quiet hours are enforced (no notifications between `quietStart` and `quietEnd`). */
	quietHoursEnabled: z.boolean(),
	/** Quiet-hours start, `HH:MM` 24h. */
	quietStart: z.string().max(5),
	/** Quiet-hours end, `HH:MM` 24h. */
	quietEnd: z.string().max(5),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
// #endregion

// #region Settings projection
/** The full Message Settings projection the modal reads + writes. */
export const MessagingSettingsSchema = z.object({
	/** Master switch for auto-responses (a rule fires only when this AND the rule are enabled). */
	autoResponsesEnabled: z.boolean(),
	autoResponses: z.array(AutoResponseRuleSchema),
	notifications: NotificationPreferencesSchema,
	/** Send read receipts to the other party. */
	readReceipts: z.boolean(),
	/** Show a typing indicator to the other party. */
	showTypingIndicator: z.boolean(),
});
export type MessagingSettings = z.infer<typeof MessagingSettingsSchema>;
// #endregion

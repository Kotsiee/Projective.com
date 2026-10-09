import type { IconName } from "@ui/icons/core/paths.tsx";
import type { UserContext } from "@projective/types/auth";
import {
	DEFAULT_SETTINGS_SECTION,
	isSettingsSectionKey,
	type SettingsSectionKey,
	SettingsSectionKey as SectionKeyEnum,
} from "@projective/types/settings";

/**
 * settings-registry — the single source of truth for the Settings taxonomy (root CLAUDE.md §8
 * Decision #150). Pure, isomorphic and free of side effects: the contextual modal, the `/settings`
 * console's lane, its search, the attention dashboard and the mobile drill-down all read the SAME
 * sections and entries from here, so a setting is never findable in one surface and missing from
 * another.
 *
 * Two levels: a **section** (a page of the console, a pane of the modal) and its **entries** (the
 * individually searchable settings on that page, each with a DOM `anchor` the surfaces scroll to).
 * Section keys are owned by `@projective/types/settings`; everything presentational is owned here.
 */

// #region Shapes
export type { SettingsSectionKey };

/**
 * Where a setting can be CHANGED.
 *
 * - `modal` — edited in place in both the contextual modal and the console page.
 * - `page-only` — too large for the modal (a schedule matrix, a hosted-flow console): the modal shows
 *   its status and one "… in Console →" escalation to `/settings/[section]`. Never hidden, never
 *   disabled — an escalation is always offered.
 * - `status-escalate` — the editor lives OUTSIDE settings (the profile editor): both surfaces show the
 *   current state and link out to it.
 */
export type SettingsSurface = "modal" | "page-only" | "status-escalate";

/** Who may see an entry. Receives the EFFECTIVE context, so the dev persona axes apply. */
export type SettingsGate = (ctx: UserContext) => boolean;

/** One searchable setting. */
export interface SettingsRegistryEntry {
	/** Unique across the registry — `section.anchor` by convention. */
	key: string;
	section: SettingsSectionKey;
	label: string;
	description: string;
	icon: IconName;
	/** Extra words a person might search for; matched as whole phrases and word prefixes. */
	keywords: string[];
	surface: SettingsSurface;
	gate?: SettingsGate;
	/** Unique across the registry; the DOM id is {@link anchorId}, the URL hash is the bare anchor. */
	anchor: string;
}

/** One section — a console page and a modal pane. */
export interface SettingsSectionMeta {
	key: SettingsSectionKey;
	label: string;
	description: string;
	icon: IconName;
	keywords: string[];
	surface: SettingsSurface;
	gate?: SettingsGate;
}
// #endregion

// #region Gates
/** Sells on the platform (a freelancer, or acting as a team) — calls, payouts and identity checks. */
const isSeller: SettingsGate = (ctx) => ctx.isFreelancer || ctx.contextType === "team";
/** May run a micro-agency team — mirrors the sidebar's Teams gate. */
const mayRunTeams: SettingsGate = (ctx) => ctx.isFreelancer || ctx.contextType === "team";
// #endregion

// #region Sections
/** Every section in display order. */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
	{
		key: "account",
		label: "Account",
		description: "Your name, handle, sign-in methods and account type",
		icon: "lock",
		keywords: ["identity", "security", "login", "sign in"],
		surface: "modal",
	},
	{
		key: "profile",
		label: "Profile",
		description: "Who can find you and what your public page shows",
		icon: "user",
		keywords: ["public page", "discovery", "privacy"],
		surface: "modal",
	},
	{
		key: "workspaces",
		label: "Workspaces",
		description: "Who you're acting as, and your teams and businesses",
		icon: "members",
		keywords: ["context", "agency", "company"],
		surface: "modal",
	},
	{
		key: "language",
		label: "Language & region",
		description: "Language, date format, display currency and text direction",
		icon: "globe",
		keywords: ["locale", "international", "i18n"],
		surface: "modal",
	},
	{
		key: "appearance",
		label: "Appearance",
		description: "Theme, contrast, reading font and motion",
		icon: "eye",
		keywords: ["accessibility", "a11y", "display"],
		surface: "modal",
	},
	{
		key: "notifications",
		label: "Notifications",
		description: "What reaches you, where, and when it stays quiet",
		icon: "bell",
		keywords: ["alerts", "email", "push", "sms"],
		surface: "modal",
	},
	{
		key: "messaging",
		label: "Messaging",
		description: "Read receipts, typing, sounds and away replies",
		icon: "message",
		keywords: ["chat", "inbox", "dm"],
		surface: "modal",
	},
	{
		key: "scheduling",
		label: "Scheduling & calls",
		description: "Working hours, discovery calls and buffers",
		icon: "calendar",
		keywords: ["availability", "booking", "calendar"],
		surface: "page-only",
	},
	{
		key: "billing",
		label: "Billing",
		description: "Your plan and the cards you pay with",
		icon: "wallet",
		keywords: ["payment", "checkout", "purchase", "subscription"],
		surface: "modal",
	},
	{
		key: "verification",
		label: "Verification & payouts",
		description: "Identity checks, payout account and business verification",
		icon: "shield",
		keywords: ["kyc", "kyb", "stripe", "compliance"],
		surface: "status-escalate",
	},
	{
		key: "integrations",
		label: "Integrations",
		description: "Connected drives, calendars and video tools",
		icon: "link",
		keywords: ["connect", "oauth", "apps"],
		surface: "status-escalate",
	},
];
// #endregion

// #region Entries
/** Every searchable setting, grouped by section in display order. */
export const SETTINGS_REGISTRY: readonly SettingsRegistryEntry[] = [
	// Account
	{
		key: "account.identity",
		section: "account",
		label: "Name & date of birth",
		description: "Your legal name, handle and birth date",
		icon: "user",
		keywords: ["legal name", "given name", "first name", "last name", "birthday", "dob"],
		surface: "modal",
		anchor: "identity",
	},
	{
		key: "account.handle",
		section: "account",
		label: "Handle",
		description: "Your @username, and when you can change it",
		icon: "user",
		keywords: ["handle", "username", "change handle", "rename", "profile address", "@"],
		surface: "modal",
		anchor: "handle",
	},
	{
		key: "account.type",
		section: "account",
		label: "Freelancer or client",
		description: "Offer your skills, or only hire",
		icon: "switch",
		keywords: [
			"freelancer",
			"client",
			"become a freelancer",
			"partner",
			"seller",
			"switch role",
			"stop freelancing",
			"remove freelancer profile",
		],
		surface: "modal",
		anchor: "account-type",
	},
	{
		key: "account.emails",
		section: "account",
		label: "Email addresses",
		description: "Add, verify and choose your primary address",
		icon: "mail",
		keywords: ["email", "secondary email", "primary email", "verify email", "contact address"],
		surface: "modal",
		anchor: "emails",
	},
	{
		key: "account.password",
		section: "account",
		label: "Password",
		description: "Reset the password you sign in with",
		icon: "lock",
		keywords: ["password", "reset password", "change password", "sign in", "credentials"],
		surface: "modal",
		anchor: "password",
	},
	{
		key: "account.connected",
		section: "account",
		label: "Connected accounts",
		description: "Sign in with Google, Apple and more",
		icon: "link",
		keywords: [
			"connected accounts",
			"google",
			"apple",
			"facebook",
			"linkedin",
			"microsoft",
			"amazon",
			"social login",
			"sign in with",
			"oauth",
		],
		surface: "modal",
		anchor: "connected-accounts",
	},
	{
		key: "account.delete",
		section: "account",
		label: "Delete account",
		description: "Close your account and erase your data",
		icon: "trash",
		keywords: ["delete account", "close account", "deactivate", "erase", "remove account", "gdpr"],
		surface: "modal",
		anchor: "delete-account",
	},
	// Profile
	{
		key: "profile.visibility",
		section: "profile",
		label: "Discovery visibility",
		description: "Public, unlisted or private",
		icon: "eye",
		keywords: ["public", "private", "unlisted", "hide profile", "search results", "discoverable"],
		surface: "modal",
		anchor: "visibility",
	},
	{
		key: "profile.local-time",
		section: "profile",
		label: "Local time & location",
		description: "Show your clock and city on your profile",
		icon: "clock",
		keywords: ["local time", "clock", "time zone", "city", "location"],
		surface: "modal",
		anchor: "local-time",
	},
	{
		key: "profile.photo",
		section: "profile",
		label: "Photo zoom",
		description: "Let visitors open your photo full size",
		icon: "image",
		keywords: ["photo", "avatar", "picture", "expand", "zoom", "photo privacy"],
		surface: "modal",
		anchor: "photo",
	},
	// Workspaces
	{
		key: "workspaces.acting",
		section: "workspaces",
		label: "Acting as",
		description: "The person or workspace you're working as now",
		icon: "switch",
		keywords: ["switch context", "acting as", "persona", "current workspace"],
		surface: "modal",
		anchor: "acting",
	},
	{
		key: "workspaces.teams",
		section: "workspaces",
		label: "Teams",
		description: "The micro-agency teams you belong to",
		icon: "members",
		keywords: ["team", "agency", "micro-agency", "collective"],
		surface: "modal",
		gate: mayRunTeams,
		anchor: "teams",
	},
	{
		key: "workspaces.businesses",
		section: "workspaces",
		label: "Businesses",
		description: "The client businesses you buy for",
		icon: "building",
		keywords: ["business", "company", "client business", "employer"],
		surface: "modal",
		anchor: "businesses",
	},
	{
		key: "workspaces.organisations",
		section: "workspaces",
		label: "Organisations",
		description: "Organisations you can act for",
		icon: "building",
		keywords: ["organisation", "organization", "institution"],
		surface: "modal",
		anchor: "organisations",
	},
	// Language & region
	{
		key: "language.locale",
		section: "language",
		label: "Language & region",
		description: "The language and region numbers and prices follow",
		icon: "globe",
		keywords: ["language", "locale", "region", "number format", "country"],
		surface: "modal",
		anchor: "locale",
	},
	{
		key: "language.date-format",
		section: "language",
		label: "Date format",
		description: "How dates are written",
		icon: "calendar",
		keywords: [
			"date format",
			"dd/mm/yyyy",
			"mm/dd/yyyy",
			"yyyy-mm-dd",
			"iso date",
			"day month year",
		],
		surface: "modal",
		anchor: "date-format",
	},
	{
		key: "language.currency",
		section: "language",
		label: "Display currency",
		description: "The currency prices are shown in",
		icon: "wallet",
		keywords: ["currency", "default currency", "prices", "gbp", "usd", "eur", "exchange rate"],
		surface: "modal",
		anchor: "currency",
	},
	{
		key: "language.direction",
		section: "language",
		label: "Text direction",
		description: "Left-to-right or right-to-left layout",
		icon: "switch",
		keywords: ["rtl", "ltr", "right to left", "left to right", "direction", "arabic", "hebrew"],
		surface: "modal",
		anchor: "direction",
	},
	// Appearance
	{
		key: "appearance.theme",
		section: "appearance",
		label: "Theme",
		description: "Light, dark or follow your device",
		icon: "eye",
		keywords: ["dark mode", "light mode", "night", "colour scheme", "color scheme", "system theme"],
		surface: "modal",
		anchor: "theme",
	},
	{
		key: "appearance.contrast",
		section: "appearance",
		label: "High contrast",
		description: "Stronger text and outlines",
		icon: "eye",
		keywords: ["contrast", "high contrast", "aaa", "low vision", "outline"],
		surface: "modal",
		anchor: "contrast",
	},
	{
		key: "appearance.font",
		section: "appearance",
		label: "Dyslexia-friendly font",
		description: "Read everything in OpenDyslexic",
		icon: "document",
		keywords: ["dyslexia", "dyslexic", "opendyslexic", "font", "typeface", "reading"],
		surface: "modal",
		anchor: "font",
	},
	{
		key: "appearance.cvd",
		section: "appearance",
		label: "Colour vision",
		description: "Adjust status colours for colour blindness",
		icon: "eye",
		keywords: ["colour blind", "color blind", "protanopia", "deuteranopia", "tritanopia", "cvd"],
		surface: "modal",
		anchor: "colour-vision",
	},
	{
		key: "appearance.motion",
		section: "appearance",
		label: "Reduce motion",
		description: "Turn off animations and transitions",
		icon: "pause",
		keywords: ["animation", "motion", "reduced motion", "vestibular", "transitions"],
		surface: "modal",
		anchor: "motion",
	},
	// Notifications
	{
		key: "notifications.channels",
		section: "notifications",
		label: "Channels",
		description: "In-app, push, email and text messages",
		icon: "bell",
		keywords: ["email notifications", "push notifications", "sms", "text messages", "in-app"],
		surface: "modal",
		anchor: "channels",
	},
	{
		key: "notifications.routing",
		section: "notifications",
		label: "What you hear about",
		description: "Choose channels for money, work, messages and more",
		icon: "list",
		keywords: ["categories", "marketing emails", "unsubscribe", "work alerts", "money alerts"],
		surface: "modal",
		anchor: "routing",
	},
	{
		key: "notifications.quiet-hours",
		section: "notifications",
		label: "Quiet hours",
		description: "Silence push and texts overnight",
		icon: "clock",
		keywords: ["quiet hours", "do not disturb", "dnd", "night", "sleep"],
		surface: "modal",
		anchor: "quiet-hours",
	},
	{
		key: "notifications.snooze",
		section: "notifications",
		label: "Pause notifications",
		description: "Snooze everything for a while",
		icon: "bell-off",
		keywords: ["snooze", "pause", "mute all", "holiday", "vacation"],
		surface: "modal",
		anchor: "snooze",
	},
	// Messaging
	{
		key: "messaging.privacy",
		section: "messaging",
		label: "Read receipts & typing",
		description: "What others see while you read and write",
		icon: "eye",
		keywords: ["read receipts", "seen", "typing indicator", "message privacy"],
		surface: "modal",
		anchor: "message-privacy",
	},
	{
		key: "messaging.alerts",
		section: "messaging",
		label: "Message alerts & sounds",
		description: "New messages, mentions and the chat sound",
		icon: "volume",
		keywords: ["message sound", "mentions", "new message alert", "group activity", "inquiries"],
		surface: "modal",
		anchor: "message-alerts",
	},
	{
		key: "messaging.auto-responses",
		section: "messaging",
		label: "Away replies",
		description: "Automatic replies while you're out",
		icon: "send",
		keywords: [
			"out of office",
			"auto reply",
			"away message",
			"automatic response",
			"vacation reply",
			"holiday",
			"busy",
			"out of hours",
			"service inquiry",
			"product inquiry",
			"project invitation",
		],
		surface: "modal",
		anchor: "auto-responses",
	},
	// Scheduling & calls
	{
		key: "scheduling.hours",
		section: "scheduling",
		label: "Working hours",
		description: "Your weekly hours and time zone",
		icon: "clock",
		keywords: ["working hours", "availability", "schedule", "time zone", "office hours"],
		surface: "page-only",
		anchor: "working-hours",
	},
	{
		key: "scheduling.calls",
		section: "scheduling",
		label: "Discovery calls",
		description: "Let clients book a call with you",
		icon: "video",
		keywords: ["discovery call", "accept calls", "booking", "intro call", "consultation"],
		surface: "page-only",
		gate: isSeller,
		anchor: "calls",
	},
	{
		key: "scheduling.courtesy",
		section: "scheduling",
		label: "Free courtesy calls",
		description: "Length, weekly cap and cooldown",
		icon: "hourglass",
		keywords: ["courtesy call", "free call", "weekly cap", "cooldown", "call length"],
		surface: "page-only",
		gate: isSeller,
		anchor: "courtesy",
	},
	{
		key: "scheduling.buffers",
		section: "scheduling",
		label: "Buffers & notice",
		description: "Breathing room around calls and how far ahead to book",
		icon: "timeline",
		keywords: ["buffer", "notice", "advance notice", "minimum notice", "gap between calls"],
		surface: "page-only",
		gate: isSeller,
		anchor: "buffers",
	},
	// Billing
	{
		key: "billing.plan",
		section: "billing",
		label: "Plan",
		description: "Your plan, its renewal and what each plan includes",
		icon: "star",
		keywords: ["plan", "subscription", "pro", "upgrade", "tier", "renewal", "pricing"],
		surface: "modal",
		anchor: "plan",
	},
	{
		key: "billing.cards",
		section: "billing",
		label: "Saved cards",
		description: "Cards you've saved for checkout",
		icon: "wallet",
		keywords: ["card", "credit card", "debit card", "payment method", "default card"],
		surface: "modal",
		anchor: "cards",
	},
	// Verification & payouts
	{
		key: "verification.identity",
		section: "verification",
		label: "Identity check",
		description: "Level 2 verification to earn on Projective",
		icon: "seal-check",
		keywords: ["kyc", "identity", "id check", "passport", "level 2"],
		surface: "status-escalate",
		gate: isSeller,
		anchor: "identity-check",
	},
	{
		key: "verification.payouts",
		section: "verification",
		label: "Payout account",
		description: "Where your withdrawals are paid",
		icon: "wallet",
		keywords: ["payout", "bank account", "withdraw", "stripe connect"],
		surface: "status-escalate",
		gate: isSeller,
		anchor: "payouts",
	},
	{
		key: "verification.businesses",
		section: "verification",
		label: "Business verification",
		description: "Level 3 checks for the businesses you manage",
		icon: "building",
		keywords: ["kyb", "business verification", "company registration", "level 3"],
		surface: "status-escalate",
		anchor: "business-verification",
	},
	// Integrations
	{
		key: "integrations.storage",
		section: "integrations",
		label: "Cloud storage",
		description: "Google Drive, Dropbox, Frame.io and S3",
		icon: "folder",
		keywords: ["google drive", "dropbox", "frame.io", "s3", "cloud storage", "files"],
		surface: "status-escalate",
		anchor: "storage",
	},
	{
		key: "integrations.calendars",
		section: "integrations",
		label: "Calendars",
		description: "Sync Google or Outlook calendars",
		icon: "calendar",
		keywords: ["google calendar", "outlook", "calendar sync", "busy times"],
		surface: "status-escalate",
		anchor: "calendars",
	},
	{
		key: "integrations.conferencing",
		section: "integrations",
		label: "Video calls",
		description: "The tool your call links are made with",
		icon: "video-camera",
		keywords: ["zoom", "google meet", "teams", "video link", "conferencing"],
		surface: "status-escalate",
		anchor: "conferencing",
	},
];
// #endregion

// #region Lookups
const SECTION_BY_KEY: ReadonlyMap<SettingsSectionKey, SettingsSectionMeta> = new Map(
	SETTINGS_SECTIONS.map((section) => [section.key, section]),
);

/** A section's metadata. Total over the key enum. */
export function sectionMeta(key: SettingsSectionKey): SettingsSectionMeta {
	return SECTION_BY_KEY.get(key) ?? SETTINGS_SECTIONS[0];
}

/** Narrow an untrusted value to a section key, falling back to the default section. */
export function resolveSectionKey(value: unknown): SettingsSectionKey {
	return isSettingsSectionKey(value) ? value : DEFAULT_SETTINGS_SECTION;
}

export { DEFAULT_SETTINGS_SECTION, isSettingsSectionKey };

/** Every section key in display order (the enum's order, which the sections array mirrors). */
export const SETTINGS_SECTION_KEYS: readonly SettingsSectionKey[] = SectionKeyEnum.options;

/** Whether a gate admits a context. An ungated item is for everyone signed in. */
function admits(gate: SettingsGate | undefined, ctx: UserContext | null): boolean {
	return !gate || (ctx !== null && gate(ctx));
}

/** The sections a context may see, in order. */
export function visibleSections(ctx: UserContext | null): SettingsSectionMeta[] {
	return SETTINGS_SECTIONS.filter((section) => admits(section.gate, ctx));
}

/** A section's entries a context may see, in order. */
export function sectionEntries(
	key: SettingsSectionKey,
	ctx: UserContext | null,
): SettingsRegistryEntry[] {
	return SETTINGS_REGISTRY.filter((entry) => entry.section === key && admits(entry.gate, ctx));
}

/** Look an entry up by its anchor. */
export function entryByAnchor(anchor: string): SettingsRegistryEntry | null {
	return SETTINGS_REGISTRY.find((entry) => entry.anchor === anchor) ?? null;
}

/** The DOM id an entry's block carries — prefixed so a bare word never collides with the host page. */
export function anchorId(anchor: string): string {
	return `stg-${anchor}`;
}
// #endregion

// #region Addresses
/** The console page of a section, optionally deep-linked to an entry's anchor. */
export function settingsHref(section: SettingsSectionKey, anchor?: string | null): string {
	return `/settings/${section}${anchor ? `#${anchor}` : ""}`;
}

/**
 * What a `/settings…` pathname addresses: `"index"` for the console root, a section key, or `null`
 * when the path is not under `/settings` (or names no section). Trailing slashes are ignored.
 */
export function sectionOfPath(pathname: string): SettingsSectionKey | "index" | null {
	const path = pathname.replace(/\/+$/, "");
	if (path === "/settings") return "index";
	const match = /^\/settings\/([^/]+)/.exec(path);
	if (!match) return null;
	return isSettingsSectionKey(match[1]) ? match[1] : null;
}
// #endregion

// #region Search
/** Lower-case, strip diacritics and punctuation, collapse whitespace. */
export function normalizeQuery(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9.]+/g, " ")
		.trim();
}

/** One section in a search result, with the entries that matched (all of them when the section did). */
export interface SettingsSearchHit {
	section: SettingsSectionMeta;
	entries: SettingsRegistryEntry[];
	score: number;
}

/**
 * Score a haystack against a normalised query: a phrase hit (the whole query inside one keyword or
 * the label) beats every token landing on a word prefix, which beats nothing. Zero means no match —
 * EVERY token must match, so "dark mode" never matches a setting that is merely "dark".
 */
function scoreText(
	query: string,
	label: string,
	description: string,
	keywords: readonly string[],
): number {
	const fields = [label, description, ...keywords].map(normalizeQuery);
	const nLabel = fields[0];
	if (keywords.some((keyword) => normalizeQuery(keyword) === query)) return 120;
	if (nLabel === query) return 110;
	if (keywords.some((keyword) => normalizeQuery(keyword).includes(query))) return 90;
	if (nLabel.includes(query)) return 80;
	const words = fields.join(" ").split(" ");
	const tokens = query.split(" ").filter(Boolean);
	const every = tokens.every((token) => words.some((word) => word.startsWith(token)));
	if (!every) return 0;
	const inLabel = tokens.every((token) => nLabel.split(" ").some((word) => word.startsWith(token)));
	return inLabel ? 50 : 20;
}

/**
 * Search the registry the way the lane and the modal filter their trees: sections ordered by their
 * best score (ties keep display order), each carrying the entries that matched. A section whose OWN
 * label matched keeps every visible entry, so "notifications" shows the whole page. An empty query
 * returns every visible section with every visible entry.
 */
export function searchSettings(query: string, ctx: UserContext | null): SettingsSearchHit[] {
	const q = normalizeQuery(query);
	const sections = visibleSections(ctx);
	if (!q) {
		return sections.map((section) => ({
			section,
			entries: sectionEntries(section.key, ctx),
			score: 0,
		}));
	}
	const hits: SettingsSearchHit[] = [];
	for (const section of sections) {
		const all = sectionEntries(section.key, ctx);
		const own = scoreText(q, section.label, section.description, section.keywords);
		const scored = all
			.map((entry) => ({
				entry,
				score: scoreText(q, entry.label, entry.description, entry.keywords),
			}))
			.filter((hit) => hit.score > 0);
		if (own === 0 && scored.length === 0) continue;
		const best = Math.max(own, ...scored.map((hit) => hit.score));
		hits.push({ section, entries: own >= 80 ? all : scored.map((hit) => hit.entry), score: best });
	}
	return hits
		.map((hit, order) => ({ hit, order }))
		.sort((a, b) => b.hit.score - a.hit.score || a.order - b.order)
		.map(({ hit }) => hit);
}

/** The best single destination for a query — what Enter in the search field opens. */
export function topSearchTarget(
	query: string,
	ctx: UserContext | null,
): { section: SettingsSectionKey; anchor: string | null } | null {
	const [best] = searchSettings(query, ctx);
	if (!best) return null;
	const q = normalizeQuery(query);
	const entry = q ? best.entries[0] ?? null : null;
	return { section: best.section.key, anchor: entry?.anchor ?? null };
}
// #endregion

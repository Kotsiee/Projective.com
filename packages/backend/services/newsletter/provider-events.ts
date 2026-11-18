import { z } from "zod";
import {
	NEWSLETTER_PARAM_KEYS,
	NEWSLETTER_TOPICS,
	type NewsletterProviderEventKind,
	type NewsletterProviderEventOutcome,
	NewsletterProviderEventRpcResultSchema,
	type NewsletterTopic,
} from "@projective/types/community";
import { getServiceClient, isNewsletterBackendLive } from "../../core/supabase.ts";
import { communityRpc } from "../community/community-source.ts";

/**
 * provider-events — what the mail provider's own events mean for the newsletter list (Decision #480
 * Q1 A and flag (b), CD1 step 5). Resend posts them to the one signed webhook NT3 built
 * (`POST /api/comms/webhooks/resend`, `DeliveryEventService`): after the event's Svix signature is
 * checked and it is claimed in `comms.delivery_events`, this module turns the newsletter's share of
 * it into one call of `community.record_newsletter_provider_event`:
 *
 * - `contact.created` / `contact.updated` → `unsubscribed` when the contact is unsubscribed there,
 *   else `present` (a contact exists: recorded, so a stray one is deleted by the next sync);
 * - `contact.deleted` → `deleted`;
 * - `contact.topics.updated` → `topics`, each Resend topic id mapped to its newsletter topic through
 *   `newsletter_provider_topic_ids` (an unknown id is ignored);
 * - `email.complained` → `complaint`: a spam complaint about any mail to the address takes it off the
 *   newsletter, beside the Marketing-only suppression NT3 writes.
 *
 * Anything else is not the newsletter's. The door is idempotent and refuses a delivery older than
 * the address's last confirmation, so a redelivered or replayed event is safe to apply again: the
 * webhook applies this whether its claim was new or a replay, and answers 503 (Resend redelivers)
 * when the door could not be reached. Logs carry the event's id, its type and the outcome, never the
 * address.
 */

// #region Mapping
/** The arguments of `community.record_newsletter_provider_event`. */
export interface NewsletterProviderEventArgs {
	p_email: string;
	p_event: NewsletterProviderEventKind;
	p_occurred_at: string | null;
	p_contact_ref: string | null;
	p_opted_out: NewsletterTopic[] | null;
	p_opted_in: NewsletterTopic[] | null;
}

/** Each newsletter topic's Resend topic id, as `newsletter_provider_topic_ids` holds them. */
export type TopicIds = Partial<Record<NewsletterTopic, string>>;

const address = z.string().trim().min(3).max(320).regex(/^[^\s@]+@[^\s@]+$/);
const contactId = z.string().trim().min(1).max(128);

/** The fields of a Resend event this module reads; the rest of the payload is ignored. */
const EventSchema = z.object({
	type: z.string().min(1).max(64),
	created_at: z.string().max(64).optional(),
	data: z.object({
		id: z.string().max(128).optional(),
		email: z.string().max(320).optional(),
		to: z.union([z.array(z.string().max(320)), z.string().max(320)]).optional(),
		unsubscribed: z.boolean().optional(),
		topics: z.array(
			z.object({
				id: z.string().max(128),
				subscription: z.enum(["opt_in", "opt_out"]),
			}).passthrough(),
		).max(64).optional(),
	}).passthrough(),
}).passthrough();

/** The event types this module reads. */
export const NEWSLETTER_EVENT_TYPES = Object.freeze([
	"contact.created",
	"contact.updated",
	"contact.deleted",
	"contact.topics.updated",
	"email.complained",
]);

/**
 * The door's arguments for one Resend event, or null when the event is not the newsletter's (or
 * cannot be read). `topicIds` is needed only for `contact.topics.updated`; without it that event is
 * ignored, since no topic could be named.
 */
export function newsletterEventArgs(
	raw: unknown,
	topicIds: TopicIds | null,
): NewsletterProviderEventArgs | null {
	const parsed = EventSchema.safeParse(raw);
	if (!parsed.success || !NEWSLETTER_EVENT_TYPES.includes(parsed.data.type)) return null;
	const { type, created_at: createdAt, data } = parsed.data;
	const occurred = createdAt && !Number.isNaN(Date.parse(createdAt))
		? new Date(createdAt).toISOString()
		: null;

	const recipient = type === "email.complained"
		? (Array.isArray(data.to) ? data.to[0] : data.to)
		: data.email;
	const email = address.safeParse(recipient);
	if (!email.success) return null;
	const base = {
		p_email: email.data.toLowerCase(),
		p_occurred_at: occurred,
		p_opted_out: null,
		p_opted_in: null,
	};

	if (type === "email.complained") return { ...base, p_event: "complaint", p_contact_ref: null };

	if (type === "contact.topics.updated") {
		if (!topicIds || !data.topics) return null;
		const byId = new Map<string, NewsletterTopic>();
		for (const topic of NEWSLETTER_TOPICS) if (topicIds[topic]) byId.set(topicIds[topic]!, topic);
		const out: NewsletterTopic[] = [];
		const into: NewsletterTopic[] = [];
		for (const entry of data.topics) {
			const topic = byId.get(entry.id);
			if (topic) (entry.subscription === "opt_out" ? out : into).push(topic);
		}
		if (out.length === 0 && into.length === 0) return null;
		return { ...base, p_event: "topics", p_contact_ref: null, p_opted_out: out, p_opted_in: into };
	}

	const id = contactId.safeParse(data.id);
	if (!id.success) return null;
	if (type === "contact.deleted") return { ...base, p_event: "deleted", p_contact_ref: id.data };
	return {
		...base,
		p_event: data.unsubscribed ? "unsubscribed" : "present",
		p_contact_ref: id.data,
	};
}
// #endregion

// #region Applying
/** Everything {@link applyNewsletterProviderEvent} reads from its surroundings. */
export interface NewsletterEventDeps {
	/** `NEWSLETTER_BACKEND_LIVE`: off, the list is not stored here and nothing is applied. */
	live: boolean;
	/** The topic ids (`newsletter_provider_topic_ids`), read only for a topic event. */
	topicIds: () => Promise<TopicIds | null>;
	/** `community.record_newsletter_provider_event`. */
	record: (
		args: NewsletterProviderEventArgs,
	) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
	log: (line: string) => void;
}

const TOPIC_IDS_TTL_MS = 60_000;
let topicIdsCache: { value: TopicIds | null; at: number } | null = null;

/** The topic ids from `security.platform_params`, reused for a minute; null when unset or unreadable. */
async function readTopicIds(): Promise<TopicIds | null> {
	if (topicIdsCache && Date.now() - topicIdsCache.at < TOPIC_IDS_TTL_MS) return topicIdsCache.value;
	const { data, error } = await getServiceClient().schema("security").from("platform_params")
		.select("value").eq("key", NEWSLETTER_PARAM_KEYS.topicIds).maybeSingle();
	const parsed = z.record(z.string(), z.string().min(1).max(128).nullable()).safeParse(
		(data as { value?: unknown } | null)?.value,
	);
	const value = error || !parsed.success
		? null
		: Object.fromEntries(Object.entries(parsed.data).filter(([, id]) => id)) as TopicIds;
	topicIdsCache = { value, at: Date.now() };
	return value;
}

const liveDeps = (): NewsletterEventDeps => ({
	live: isNewsletterBackendLive(),
	topicIds: readTopicIds,
	record: (args) =>
		communityRpc(getServiceClient(), "record_newsletter_provider_event", { ...args }),
	log: (line) => console.info(line),
});

/**
 * Apply the newsletter's share of one verified Resend event. Answers the door's outcome, or null when
 * the event is not the newsletter's or the list is not stored here. Throws when the door could not be
 * reached or answered an unknown shape, so the webhook answers 503 and Resend sends the event again.
 */
export async function applyNewsletterProviderEvent(
	eventId: string,
	raw: unknown,
	overrides: Partial<NewsletterEventDeps> = {},
): Promise<NewsletterProviderEventOutcome | null> {
	const d = { ...liveDeps(), ...overrides };
	const type = (raw as { type?: unknown } | null)?.type;
	if (!d.live || typeof type !== "string" || !NEWSLETTER_EVENT_TYPES.includes(type)) return null;
	const args = newsletterEventArgs(
		raw,
		type === "contact.topics.updated" ? await d.topicIds() : null,
	);
	if (!args) return null;

	const { data, error } = await d.record(args);
	if (error) {
		throw new Error(
			`community.record_newsletter_provider_event failed (${error.code ?? "no code"})`,
		);
	}
	const answer = NewsletterProviderEventRpcResultSchema.safeParse(data);
	if (!answer.success) {
		throw new Error("community.record_newsletter_provider_event answered an unknown outcome");
	}
	d.log(`[newsletter:provider] ${eventId} ${type} → ${answer.data.outcome}`);
	return answer.data.outcome;
}
// #endregion

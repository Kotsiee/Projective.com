/**
 * resend-contacts — the newsletter's one reach into the mail provider's contact list (Resend
 * Contacts, Segments and Topics; Decision #480 Q1 A, CD1 step 5). Read 2026-11-18: contacts are
 * global to the account, a Segment groups them for a Broadcast, and each Topic holds a per-contact
 * `opt_in` / `opt_out` the contact can change on Resend's preference page.
 *
 * Reached with one `fetch` per call, like the mail transport, so there is no dependency to carry. A
 * call answers a {@link ContactCall}, never throws, and never names the address in what it reports:
 * an error carries the HTTP status only. The address goes in exactly two places, the body of a create
 * and the path of a lookup, and nothing else about the subscriber is ever sent.
 *
 * Resend's Idempotency-Key covers its email endpoints, not these. Every call here is idempotent by
 * shape instead: a create of an existing address is answered by a lookup, the topic and segment
 * calls set state, and a delete of a missing contact counts as done.
 */

// #region Shapes
/** One topic's subscription, as Resend takes it. */
export interface TopicSubscription {
	id: string;
	subscription: "opt_in" | "opt_out";
}

/**
 * What one call came to. `rate_limited` (429) and `unavailable` (a 5xx, a timeout, no network) end a
 * sync pass, to be retried on the next one; `not_found` (404) and `exists` (409) steer the caller;
 * `refused` is any other 4xx, which the same request would meet again.
 */
export type ContactCall =
	| { ok: true; id: string | null }
	| {
		ok: false;
		kind: "rate_limited" | "unavailable" | "not_found" | "exists" | "refused";
		status: number;
	};

/** The contact calls the sync makes. Each is one HTTP request. */
export interface ContactsClient {
	/** `POST /contacts`: a new contact, subscribed, in `segmentId`, with every topic set. */
	create(
		email: string,
		segmentId: string,
		topics: readonly TopicSubscription[],
	): Promise<ContactCall>;
	/** `GET /contacts/{email}`: the existing contact's id. */
	find(email: string): Promise<ContactCall>;
	/** `PATCH /contacts/{id}` `{ unsubscribed: false }`: lift its provider-side opt-out. */
	resubscribe(id: string): Promise<ContactCall>;
	/** `POST /contacts/{id}/segments/{segmentId}`: make sure it is in the segment. */
	addToSegment(id: string, segmentId: string): Promise<ContactCall>;
	/** `PATCH /contacts/{id}/topics`: set every topic's subscription. */
	setTopics(id: string, topics: readonly TopicSubscription[]): Promise<ContactCall>;
	/** `DELETE /contacts/{id}`: remove it; a contact already gone answers `ok`. */
	remove(id: string): Promise<ContactCall>;
}
// #endregion

// #region Resend
const API = "https://api.resend.com";

/** How long one call may take, so a slow provider cannot hold a sync pass open. */
const CALL_TIMEOUT_MS = 10_000;

/** A call's outcome from its HTTP status. */
export function classify(status: number): ContactCall {
	if (status >= 200 && status < 300) return { ok: true, id: null };
	if (status === 429) return { ok: false, kind: "rate_limited", status };
	if (status === 404) return { ok: false, kind: "not_found", status };
	if (status === 409) return { ok: false, kind: "exists", status };
	if (status >= 500) return { ok: false, kind: "unavailable", status };
	return { ok: false, kind: "refused", status };
}

/** Resend's contacts API with `apiKey`. `send` is injectable for tests. */
export function resendContacts(apiKey: string, send: typeof fetch = fetch): ContactsClient {
	async function call(method: string, path: string, body?: unknown): Promise<ContactCall> {
		let res: Response;
		try {
			res = await send(`${API}${path}`, {
				method,
				headers: {
					authorization: `Bearer ${apiKey}`,
					...(body === undefined ? {} : { "content-type": "application/json" }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
			});
		} catch {
			return { ok: false, kind: "unavailable", status: 0 };
		}
		const outcome = classify(res.status);
		if (!outcome.ok) {
			await res.body?.cancel();
			return outcome;
		}
		const json = await res.json().catch(() => null) as { id?: unknown } | null;
		return { ok: true, id: typeof json?.id === "string" && json.id.length > 0 ? json.id : null };
	}

	const contact = (id: string) => `/contacts/${encodeURIComponent(id)}`;
	return {
		create: (email, segmentId, topics) =>
			call("POST", "/contacts", {
				email,
				unsubscribed: false,
				segments: [{ id: segmentId }],
				topics: topics.map(({ id, subscription }) => ({ id, subscription })),
			}),
		find: (email) => call("GET", contact(email)),
		resubscribe: (id) => call("PATCH", contact(id), { unsubscribed: false }),
		addToSegment: (id, segmentId) =>
			call("POST", `${contact(id)}/segments/${encodeURIComponent(segmentId)}`),
		setTopics: (id, topics) =>
			call(
				"PATCH",
				`${contact(id)}/topics`,
				topics.map(({ id: topic, subscription }) => ({ id: topic, subscription })),
			),
		async remove(id) {
			const outcome = await call("DELETE", contact(id));
			return !outcome.ok && outcome.kind === "not_found" ? { ok: true, id } : outcome;
		},
	};
}

/**
 * The same client with at least `gapMs` between the start of two calls, so a sync pass stays well
 * under Resend's team-wide 10 requests a second, which the transactional mail shares.
 */
export function pacedContacts(
	client: ContactsClient,
	gapMs: number,
	sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
	now: () => number = Date.now,
): ContactsClient {
	let last = -Infinity;
	const pace = async <T>(run: () => Promise<T>): Promise<T> => {
		const wait = last + gapMs - now();
		if (wait > 0) await sleep(wait);
		last = now();
		return await run();
	};
	return {
		create: (...a) => pace(() => client.create(...a)),
		find: (...a) => pace(() => client.find(...a)),
		resubscribe: (...a) => pace(() => client.resubscribe(...a)),
		addToSegment: (...a) => pace(() => client.addToSegment(...a)),
		setTopics: (...a) => pace(() => client.setTopics(...a)),
		remove: (...a) => pace(() => client.remove(...a)),
	};
}
// #endregion

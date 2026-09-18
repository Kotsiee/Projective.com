import { getMessaging, postMessaging } from "./api.ts";
import type {
	AddConversationMembers,
	ContactSuggestionParams,
	ConversationMembersAdded,
	CreateConversation,
	CreatedConversation,
	RankedContactList,
} from "../types/messaging-types.ts";
import type { MessagingResult } from "../types/results.ts";

/**
 * ContactsService — the THIN client controller for the people picker and the two conversation
 * writes it feeds: the ranked suggestions/search read, starting a conversation, and adding members
 * to one. A dumb object of named methods beside {@link MessagingService}; each builds a query string
 * or payload and forwards to `/api/messaging/*`, returning a soft {@link MessagingResult}. No
 * ranking, no id derivation — the fat `MessagingBackendService` owns both.
 */
export const ContactsService = {
	/**
	 * The ranked people picker. No `q` → the viewer's relationship-ranked suggestions; a `q` → the
	 * same people narrowed plus directory hits. `exclude` leaves out people already present.
	 */
	suggestions(
		params: ContactSuggestionParams = {},
	): Promise<MessagingResult<{ contacts: RankedContactList }>> {
		const qs = new URLSearchParams();
		if (params.q) qs.set("q", params.q);
		for (const id of params.exclude ?? []) qs.append("exclude", id);
		if (params.limit) qs.set("limit", String(params.limit));
		const query = qs.toString();
		return getMessaging<{ contacts: RankedContactList }>(
			`/api/messaging/suggestions${query ? `?${query}` : ""}`,
		);
	},

	/**
	 * Start a conversation from picked contacts — one → a DM (reopened if it exists), several or a
	 * named group → a group. `message` is posted in the same act, so a first message to somebody
	 * creates the thread and lands the question together (Decision #79).
	 */
	createConversation(payload: CreateConversation): Promise<MessagingResult<CreatedConversation>> {
		return postMessaging<CreatedConversation>("/api/messaging/conversations", payload);
	},

	/** Add people to a conversation the viewer is in; a DM becomes a group when a third person joins. */
	addMembers(
		payload: AddConversationMembers,
	): Promise<MessagingResult<ConversationMembersAdded>> {
		return postMessaging<ConversationMembersAdded>("/api/messaging/conversations/members", payload);
	},
};

import type {
	ContactList,
	ConversationDetail,
	ConversationListPage,
	ConversationListParams,
	MessagingRole,
	MessagingSettings,
} from "@projective/types/messaging";
import type { MessagePage } from "@projective/types/projects";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isMessagingBackendLive } from "../../core/supabase.ts";
import {
	findContacts,
	findConversationDetail,
	findConversations,
} from "./conversation-fixtures.ts";
import {
	type ConversationMessageParams,
	findConversationMessagePage,
} from "./messages-fixtures.ts";
import { findSettings } from "./settings-fixtures.ts";

/**
 * MessagingBackendService — the FAT half of the global inbox (`/messages`) read layer (thin-routes /
 * fat-services, root CLAUDE.md §10 / SYSTEM_ARCHITECTURE §Backend Services). It owns the conversation
 * LIST, single-conversation metadata, per-conversation message page (unified with project channels by
 * `chatId`), the contact picker, and the Message Settings projection — returning a transport-agnostic
 * {@link ServiceResult}. The thin `/api/messaging/*` routes parse + guard + delegate here; islands never
 * reach it.
 *
 * Gated by {@link isMessagingBackendLive} (`MESSAGING_BACKEND_LIVE`, default off): until the RLS-scoped
 * `messages.*` tables land, every method answers from the deterministic fixtures. The LIVE branch is a
 * documented placeholder that currently falls back to the same fixtures with zero shape churn (the
 * projections are already the Zod SSOT), exactly like {@link ProjectBackendService}.
 */
export class MessagingBackendService {
	/** A filtered, paged page of the viewer's conversations (the inbox sidebar list). */
	static conversations(
		params: ConversationListParams,
	): ServiceResult<{ page: ConversationListPage }> {
		if (!isMessagingBackendLive()) return ok({ page: findConversations(params) });
		// LIVE: read RLS-scoped `messages.conversations` — not yet implemented; fall back to fixtures.
		return ok({ page: findConversations(params) });
	}

	/** The single-conversation metadata for the conversation view header + Members tab. */
	static conversation(id: string): ServiceResult<{ detail: ConversationDetail }> {
		const detail = findConversationDetail(id);
		if (!detail) return fail(404, { message: "No such conversation." });
		return ok({ detail });
	}

	/** A bottom-anchored page of a conversation's messages (the chat feed). */
	static messages(params: ConversationMessageParams): ServiceResult<{ page: MessagePage }> {
		const page = findConversationMessagePage(params);
		if (!page) return fail(404, { message: "No such conversation." });
		return ok({ page });
	}

	/** The pickable contacts for New Conversation / Add Members. */
	static contacts(role?: MessagingRole, q?: string): ServiceResult<{ contacts: ContactList }> {
		return ok({ contacts: findContacts(role, q) });
	}

	/** The Message Settings projection (auto-responses + notification preferences) for the acting view. */
	static settings(role: MessagingRole): ServiceResult<{ settings: MessagingSettings }> {
		return ok({ settings: findSettings(role) });
	}
}

import type { ConversationContext, ConversationSummary } from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import { getUserClient } from "../../core/supabase.ts";
import type { SupabaseClient } from "supabaseClient";
import { buildConversationContext, type EngagementContextRow } from "./context-model.ts";

/**
 * live-context — the conversation context drawer's live read: the counterpart of a DM and what the
 * two are negotiating, from `projects.get_engagement_context(counterpart)` (a definer read scoped to
 * the pair — a pending invitee cannot otherwise read a private project's brief). The mapping is the
 * shared, pure {@link buildConversationContext}.
 */
export async function fetchConversationContext(
	actor: ReadActor & { accessToken: string },
	summary: ConversationSummary,
	now: number,
): Promise<ConversationContext> {
	const other = summary.kind === "group" ? null : summary.participants[0] ?? null;
	const counterpart = other
		? { id: other.id, name: other.name, handle: other.handle, avatar: other.avatar }
		: null;
	if (!counterpart) {
		return buildConversationContext({
			conversationId: summary.id,
			kind: summary.kind,
			counterpart,
			raw: null,
			now,
		});
	}

	const db = getUserClient(actor.accessToken).schema("projects") as unknown as SupabaseClient;
	const { data, error } = await db.rpc("get_engagement_context", { p_counterpart: counterpart.id });
	if (error) throw new Error(`projects.get_engagement_context failed: ${error.message}`);
	const raw = (data ?? null) as EngagementContextRow | null;
	return buildConversationContext({
		conversationId: summary.id,
		kind: summary.kind,
		counterpart,
		raw: raw
			? {
				standing: raw.standing ?? null,
				invitations: raw.invitations ?? [],
				applications: raw.applications ?? [],
				milestones: raw.milestones ?? [],
			}
			: null,
		now,
	});
}

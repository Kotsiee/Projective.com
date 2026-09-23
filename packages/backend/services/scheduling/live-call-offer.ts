import type { SupabaseClient } from "supabaseClient";
import { ConferencingProviderSchema, type PublicCallOffer } from "@projective/types/scheduling";
import type { ProfileOwnerType } from "@projective/types/profile";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { type CallRow, CALL_COLUMNS, scheduleOwnerType, toCallSettings } from "./live-owner-availability.ts";

/**
 * live-call-offer — a profile owner's PUBLIC discovery-call offer, read live from their published
 * schedule (`scheduling.schedules` + `call_settings` + `call_platforms`).
 *
 * The ONE reader every surface that offers a call uses — the profile's "Book consultation" row, a
 * listing's Contact menu and the discovery-call slot grid — so the three cannot disagree about which
 * call flavours exist, how long they run or what they cost. It needs no session: the "View call
 * settings" policy lets anyone read the settings of a PUBLISHED schedule, so the anonymous client
 * answers a guest and a member identically (a signed-in owner additionally sees their own draft, but
 * this reader ignores an unpublished schedule either way — a draft offers nothing).
 *
 * Returns `null` when the owner takes no calls (no published schedule, calls switched off, or no
 * flavour on offer — a paid call with no fee is no offer), and `undefined` when the database could
 * not answer. The consultation row is ABSENT for `null`, never disabled: the capability does not
 * exist.
 *
 * `platforms` is the owner's declared allow-list in their order. It is not yet intersected with the
 * owner's connected conferencing accounts — a visitor cannot read those — so an empty list reads as
 * "the host arranges the room".
 */

// #region By owner

/** The public offer of a known owner, through whichever client the caller holds. */
export async function readPublicCallOffer(
	client: SupabaseClient,
	owner: { type: ProfileOwnerType; id: string },
): Promise<PublicCallOffer | null | undefined> {
	try {
		const schedule = await client.schema("scheduling").from("schedules")
			.select("id, is_published")
			.eq("owner_type", scheduleOwnerType(owner.type))
			.eq("owner_id", owner.id)
			.maybeSingle();
		if (schedule.error) return undefined;
		const row = schedule.data as { id: string; is_published: boolean } | null;
		if (!row || !row.is_published) return null;
		const [call, platforms] = await Promise.all([
			client.schema("scheduling").from("call_settings")
				.select(CALL_COLUMNS)
				.eq("schedule_id", row.id)
				.maybeSingle(),
			client.schema("scheduling").from("call_platforms")
				.select("provider_slug, position")
				.eq("schedule_id", row.id)
				.order("position"),
		]);
		if (call.error || platforms.error) return undefined;
		if (!call.data) return null;
		const settings = toCallSettings(call.data as CallRow);
		const priced = settings.paidEnabled && settings.feeAmountMinor !== null && settings.feeAmountMinor > 0 &&
			settings.feeCurrency !== null;
		if (!settings.acceptsCalls || (!settings.courtesyEnabled && !priced)) return null;
		return {
			acceptsCalls: true,
			courtesyEnabled: settings.courtesyEnabled,
			courtesyDurationMinutes: settings.courtesyDurationMinutes,
			paidEnabled: priced,
			paidDurationMinutes: settings.paidDurationMinutes,
			feeAmountMinor: priced ? settings.feeAmountMinor : null,
			feeCurrency: priced ? settings.feeCurrency : null,
			agendaRequired: settings.agendaRequired,
			platforms: ((platforms.data ?? []) as Array<{ provider_slug: string }>)
				.map((p) => ConferencingProviderSchema.safeParse(p.provider_slug))
				.flatMap((r) => (r.success ? [r.data] : [])),
		};
	} catch {
		return undefined;
	}
}

// #endregion

// #region By handle

/**
 * The public offer of the owner a `@handle` names. The handle is resolved through
 * `org.get_profile_owner`, which answers only for a profile the caller may see — a private profile
 * offers nobody a call.
 */
export async function fetchPublicCallOffer(
	handle: string,
	actor: ReadActor,
): Promise<PublicCallOffer | null | undefined> {
	try {
		const client = canReadLive(actor) ? getUserClient(actor.accessToken) : getAnonClient();
		const { data, error } = await client.schema("org").rpc("get_profile_owner", { p_handle: handle });
		if (error) return undefined;
		const owner = data as { owner_type: ProfileOwnerType; owner_id: string } | null;
		if (!owner) return null;
		return await readPublicCallOffer(client, { type: owner.owner_type, id: owner.owner_id });
	} catch {
		return undefined;
	}
}

// #endregion

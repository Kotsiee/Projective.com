import type { UserContext } from "@projective/types/auth";
import type {
	SettingsAttentionFacts,
	SettingsSectionData,
	SettingsSectionEnvelope,
	SettingsSectionKey,
} from "@projective/types/settings";
import type { ReadActor } from "@server/services/read-actor.ts";
import { SettingsBackendService } from "@server/services/user/SettingsBackendService.ts";
import { UserBackendService } from "@server/services/user/UserBackendService.ts";
import { EmailsBackendService } from "@server/services/user/EmailsBackendService.ts";
import { NotificationCenterBackendService } from "@server/services/user/NotificationCenterBackendService.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";
import { defaultMessagingRole } from "@features/messaging/core/conversation-model.ts";
import { DEFAULT_MESSAGING_SETTINGS } from "@features/messaging/core/messaging-defaults.ts";
import { resolveConnections } from "@features/files/core/integrations-ssr.ts";
import type { A11yOverlays } from "@web/utils/a11y-context.ts";

/**
 * settings-ssr — the server-only composer behind every Settings surface (Decision #150): ONE read per
 * section, answered both to the console page (server-rendered) and to the contextual modal
 * (`GET /api/settings/[section]`), so the two can never show different data for the same section.
 *
 * It composes the fat services that already own each section's data and adds no logic of its own
 * beyond "what does this section need" — the same role `integrations-ssr.ts` and
 * `conversations-ssr.ts` play for their pages. A part that cannot be read becomes `null` plus a
 * reason; a section renders what it has and says what it lacks.
 */

// #region Inputs
/** Everything a section read needs from the request. */
export interface SettingsReadInput {
	context: UserContext;
	actor: ReadActor;
	/** The device's own overlays (the `pj.a11y` cookie) — the appearance fallback. */
	a11y?: A11yOverlays | null;
}
// #endregion

// #region Sections
/** Read one section's payload. Total: never throws, never 500s a page. */
export async function resolveSettingsSection(
	key: SettingsSectionKey,
	input: SettingsReadInput,
): Promise<SettingsSectionEnvelope> {
	try {
		return await readSection(key, input);
	} catch {
		return { data: emptySection(key, input), error: "This section couldn't be loaded just now." };
	}
}

async function readSection(
	key: SettingsSectionKey,
	input: SettingsReadInput,
): Promise<SettingsSectionEnvelope> {
	const { actor, context } = input;
	switch (key) {
		case "account": {
			const [identity, emails] = await Promise.all([
				SettingsBackendService.identity(actor),
				EmailsBackendService.list(actor),
			]);
			const data: SettingsSectionData = {
				section: "account",
				identity: identity.data?.identity ?? null,
				emails: emails.ok && emails.data ? emails.data.emails : null,
			};
			const error = !emails.ok
				? emails.message ?? "Your email addresses couldn't be loaded."
				: null;
			return { data, error };
		}
		case "profile": {
			const handle = await personHandle(actor);
			if (!handle) {
				return {
					data: emptySection(key, input),
					error: "Your profile couldn't be loaded just now.",
				};
			}
			const res = await ProfileBackendService.editModel(handle, actor);
			const model = res.ok && res.data ? res.data.model : null;
			return {
				data: {
					section: "profile",
					handle,
					visibility: model?.visibility ?? null,
					settings: model?.settings ?? null,
				},
				error: model ? null : res.message ?? "Your profile couldn't be loaded just now.",
			};
		}
		case "workspaces":
			return { data: { section: "workspaces" }, error: null };
		case "language": {
			const res = await UserBackendService.preferences({ context, accessToken: actor.accessToken });
			if (!res.ok || !res.data) {
				return { data: emptySection(key, input), error: res.message ?? null };
			}
			return { data: { section: "language", preferences: res.data.preferences }, error: null };
		}
		case "appearance": {
			const res = await SettingsBackendService.appearance({ actor, device: input.a11y });
			const look = res.data ?? { appearance: emptyAppearance(input), live: false };
			return {
				data: { section: "appearance", appearance: look.appearance, live: look.live },
				error: null,
			};
		}
		case "notifications": {
			const res = await NotificationCenterBackendService.center(actor);
			return {
				data: { section: "notifications", center: res.ok && res.data ? res.data.center : null },
				error: res.ok
					? res.message && res.data?.center.live === false ? res.message : null
					: res.message ?? null,
			};
		}
		case "messaging": {
			const res = await MessagingBackendService.settings(defaultMessagingRole(context), actor);
			return {
				data: {
					section: "messaging",
					settings: res.ok && res.data ? res.data.settings : DEFAULT_MESSAGING_SETTINGS,
				},
				error: res.ok ? null : res.message ?? "Your messaging settings couldn't be loaded.",
			};
		}
		case "scheduling": {
			const handle = await personHandle(actor);
			const res = handle ? await ProfileBackendService.availability(handle, actor) : null;
			const availability = res?.ok && res.data ? res.data.availability : null;
			return {
				data: { section: "scheduling", handle, availability },
				error: availability ? null : res?.message ?? "Your schedule couldn't be loaded just now.",
			};
		}
		case "billing":
			return { data: { section: "billing" }, error: null };
		case "verification": {
			const res = await PaymentBackendService.verificationStatus(actor);
			return {
				data: { section: "verification", status: res.ok && res.data ? res.data : null },
				error: res.ok ? null : res.message ?? "We couldn't read your verification just now.",
			};
		}
		case "integrations": {
			const { view, error } = await resolveConnections(actor);
			return { data: { section: "integrations", view: error ? null : view }, error };
		}
	}
}

/** A section's payload with nothing read — what an outage renders as. */
function emptySection(key: SettingsSectionKey, input: SettingsReadInput): SettingsSectionData {
	switch (key) {
		case "account":
			return { section: "account", identity: null, emails: null };
		case "profile":
			return { section: "profile", handle: null, visibility: null, settings: null };
		case "workspaces":
			return { section: "workspaces" };
		case "language":
			return {
				section: "language",
				preferences: {
					displayCurrency: input.context.displayCurrency,
					locale: input.context.locale,
					layoutDirection: "auto",
				},
			};
		case "appearance":
			return { section: "appearance", appearance: emptyAppearance(input), live: false };
		case "notifications":
			return { section: "notifications", center: null };
		case "messaging":
			return { section: "messaging", settings: DEFAULT_MESSAGING_SETTINGS };
		case "scheduling":
			return { section: "scheduling", handle: null, availability: null };
		case "billing":
			return { section: "billing" };
		case "verification":
			return { section: "verification", status: null };
		case "integrations":
			return { section: "integrations", view: null };
	}
}

function emptyAppearance(input: SettingsReadInput) {
	return {
		theme: "system" as const,
		contrast: input.a11y?.contrast ?? "standard",
		font: input.a11y?.font ?? "sans",
		cvd: input.a11y?.cvd ?? "none",
		motion: input.a11y?.motion ?? "standard",
	};
}

/**
 * The PERSON's handle — never `UserContext.handle`, which is the acting ENTITY's slug while acting as
 * a team or business (the Decision #149(A) trap). Read from the person's own `users_public` row.
 */
async function personHandle(actor: ReadActor): Promise<string | null> {
	const res = await SettingsBackendService.identity(actor);
	return res.data?.identity?.username ?? null;
}
// #endregion

// #region Attention facts
const factsMemo = new WeakMap<object, Promise<SettingsAttentionFacts>>();

/**
 * The attention facts for the request, read once per request no matter how many callers ask (the
 * lane and the dashboard page both do). Memoised on the request's `ctx.state` object, which Fresh
 * shares between a page's handler and its layout.
 */
export function attentionFactsFor(
	state: object,
	actor: ReadActor,
): Promise<SettingsAttentionFacts> {
	const cached = factsMemo.get(state);
	if (cached) return cached;
	const pending = readAttentionFacts(actor);
	factsMemo.set(state, pending);
	return pending;
}

async function readAttentionFacts(actor: ReadActor): Promise<SettingsAttentionFacts> {
	const [verification, connections, emails] = await Promise.all([
		PaymentBackendService.verificationStatus(actor).catch(() => null),
		IntegrationsBackendService.connections(actor).catch(() => null),
		EmailsBackendService.list(actor).catch(() => null),
	]);
	const v = verification?.ok && verification.data ? verification.data : null;
	return {
		verification: v
			? {
				isFreelancer: v.isFreelancer,
				kycStatus: v.kycStatus,
				payoutReady: v.payoutReady,
				payoutStatus: v.payoutAccount?.status ?? null,
				processorConnected: v.processorConnected,
				businessesNeedingKyb: v.businesses
					.filter((b) => b.kybStatus !== "verified")
					.map((b) => ({ id: b.id, name: b.name, canManage: b.canManage })),
			}
			: null,
		connections: connections?.ok && connections.data
			? connections.data.connections.map((c) => ({
				id: c.id,
				label: c.providerLabel,
				status: c.status,
			}))
			: null,
		unverifiedEmails: emails?.ok && emails.data
			? emails.data.emails.filter((e) => !e.verifiedAt).length
			: null,
	};
}
// #endregion

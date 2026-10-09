import {
	type ConnectedAccounts,
	type ConnectedIdentity,
	isLinkableProvider,
	SignInProvider,
} from "@projective/types/auth";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import {
	CookieStore,
	getOAuthClient,
	getUserClient,
	isAuthBackendLive,
} from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";

/**
 * IdentitiesBackendService — the FAT service behind Settings → Account → Connected accounts: the
 * GoTrue identities a person signs in with, which providers this environment offers, linking a new
 * one and disconnecting one.
 *
 * GoTrue owns every identity; this service never touches `auth.identities` directly. Reads and
 * unlinks run on the caller's own access token. A link is a PKCE handshake like sign-in: the session
 * is loaded into a {@link CookieStore}-backed client so `linkIdentity` can mint the provider URL, and
 * ONLY the code-verifier it writes leaves this process (as a short-lived cookie for the callback).
 *
 * The safeguard: an identity may be disconnected only while another sign-in method remains, and the
 * email identity — the address-and-password sign-in — is never disconnected from here. GoTrue
 * refuses the last identity too; this answers first, with a sentence.
 */

// #region Shapes
/** A started link: where to send the person, and the verifier cookie to set. */
export interface LinkStart {
	url: string;
	store: CookieStore;
}

interface GoTrueIdentity {
	identity_id?: string;
	id?: string;
	provider?: string;
	identity_data?: Record<string, unknown> | null;
	created_at?: string;
	last_sign_in_at?: string;
}
// #endregion

// #region Provider availability
const AVAILABILITY_TTL_MS = 5 * 60_000;
let availability: { at: number; providers: SignInProvider[] } | null = null;

/**
 * The providers switched on in this environment, from GoTrue's own `/settings` (cached for five
 * minutes). An unreachable GoTrue offers nothing rather than offering what may not work.
 */
async function availableProviders(): Promise<SignInProvider[]> {
	if (availability && Date.now() - availability.at < AVAILABILITY_TTL_MS) {
		return availability.providers;
	}
	const env = serverEnv();
	if (!env.supabaseUrl || !env.supabaseAnonKey) return [];
	const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, {
		headers: { apikey: env.supabaseAnonKey },
	});
	if (!res.ok) {
		throw new Error(`GoTrue /settings answered ${res.status}`);
	}
	const body = await res.json() as { external?: Record<string, unknown> };
	const external = body.external ?? {};
	const providers = SignInProvider.options.filter((provider) =>
		isLinkableProvider(provider) && external[provider] === true
	);
	availability = { at: Date.now(), providers };
	return providers;
}
// #endregion

// #region Guards
function sessionToken(actor: ReadActor): string | ServiceResult<never> {
	if (!actor.userId) return fail(401, { message: "Sign in to manage how you sign in." });
	if (!isAuthBackendLive()) {
		return fail(503, { message: "Sign-in methods can't be managed in this environment." });
	}
	if (!canReadLive(actor)) {
		return fail(401, { message: "Your session has expired. Please sign in again." });
	}
	return actor.accessToken;
}

function unreachable(error: unknown): ServiceResult<never> {
	return fail(503, {
		message: "We couldn't reach the sign-in service. Try again in a moment.",
		details: { reason: error instanceof Error ? error.message : String(error) },
	});
}
// #endregion

// #region Mapping
/** GoTrue identities → the SSOT shape, dropping providers the settings list does not draw. */
export function toConnectedIdentities(raw: readonly GoTrueIdentity[]): ConnectedIdentity[] {
	const out: ConnectedIdentity[] = [];
	for (const identity of raw) {
		const provider = SignInProvider.safeParse(identity.provider);
		const id = identity.identity_id ?? identity.id;
		if (!provider.success || !id) continue;
		const email = identity.identity_data?.email;
		out.push({
			id,
			provider: provider.data,
			email: typeof email === "string" ? email : null,
			connectedAt: identity.created_at ?? null,
			lastSignInAt: identity.last_sign_in_at ?? null,
		});
	}
	return out;
}
// #endregion

export class IdentitiesBackendService {
	/** The caller's identities and the providers this environment offers. */
	static async list(actor: ReadActor): Promise<ServiceResult<ConnectedAccounts>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const [user, available] = await Promise.all([
				getUserClient(token).auth.getUser(token),
				availableProviders(),
			]);
			if (user.error || !user.data.user) {
				return fail(401, { message: "Your session has expired. Please sign in again." });
			}
			const raw = (user.data.user.identities ?? []) as GoTrueIdentity[];
			return ok({
				identities: toConnectedIdentities(raw),
				available,
				canDisconnect: raw.length > 1,
			});
		} catch (error) {
			return unreachable(error);
		}
	}

	/**
	 * Begin linking a provider to the caller's account. Answers the provider's authorize URL and the
	 * store holding the PKCE verifier; the route sets ONLY the verifier as a cookie and 303s.
	 */
	static async startLink(
		actor: ReadActor,
		input: { provider: SignInProvider; refreshToken: string | null; callbackUrl: string },
	): Promise<ServiceResult<LinkStart>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		if (!isLinkableProvider(input.provider)) {
			return fail(422, { message: "That sign-in provider can't be connected." });
		}
		try {
			const available = await availableProviders();
			if (!available.includes(input.provider)) {
				return fail(409, { message: "That sign-in provider isn't available yet." });
			}
			const store = new CookieStore();
			const client = getOAuthClient(store);
			const session = await client.auth.setSession({
				access_token: token,
				refresh_token: input.refreshToken ?? "",
			});
			if (session.error) {
				return fail(401, { message: "Your session has expired. Please sign in again." });
			}
			const link = await client.auth.linkIdentity({
				provider: input.provider as Exclude<SignInProvider, "email" | "amazon">,
				options: { redirectTo: input.callbackUrl, skipBrowserRedirect: true },
			});
			if (link.error || !link.data?.url) {
				return fail(409, {
					message: "That provider couldn't be connected right now.",
					details: { reason: link.error?.message ?? "no authorize url" },
				});
			}
			return ok({ url: link.data.url, store });
		} catch (error) {
			return unreachable(error);
		}
	}

	/** Disconnect one identity — never the email one, and never the last way to sign in. */
	static async unlink(
		actor: ReadActor,
		identityId: string,
	): Promise<ServiceResult<ConnectedAccounts>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		const current = await IdentitiesBackendService.list(actor);
		if (!current.ok || !current.data) return current;
		const target = current.data.identities.find((identity) => identity.id === identityId);
		if (!target) return fail(404, { message: "That sign-in method isn't on your account." });
		if (target.provider === "email") {
			return fail(409, {
				message: "Your email sign-in is managed under Email addresses and Password.",
			});
		}
		if (!current.data.canDisconnect) {
			return fail(409, {
				message: "This is your only way to sign in. Connect another before disconnecting it.",
				details: { refusal: "last_sign_in_method" },
			});
		}
		try {
			const env = serverEnv();
			const res = await fetch(
				`${env.supabaseUrl}/auth/v1/user/identities/${encodeURIComponent(identityId)}`,
				{
					method: "DELETE",
					headers: { apikey: env.supabaseAnonKey ?? "", authorization: `Bearer ${token}` },
				},
			);
			if (!res.ok) {
				const body = await res.json().catch(() => null) as
					| { msg?: string; message?: string }
					| null;
				return fail(res.status === 422 ? 409 : 503, {
					message: "That sign-in method couldn't be disconnected.",
					details: { reason: body?.msg ?? body?.message ?? `GoTrue answered ${res.status}` },
				});
			}
		} catch (error) {
			return unreachable(error);
		}
		const after = await IdentitiesBackendService.list(actor);
		if (!after.ok || !after.data) return after;
		return ok(after.data, { message: "Disconnected." });
	}
}

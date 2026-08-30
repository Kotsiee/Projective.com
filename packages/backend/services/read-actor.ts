import type { UserContext } from "@projective/types/auth";
import type { CacheTenant } from "../core/cache.ts";

/**
 * read-actor — who a read is performed AS, for the projects and messaging read layer.
 *
 * ## Why this exists at all
 *
 * Every fat method in these two domains was previously a pure function of its params: `list(params)`,
 * `detail(slug)`. That is exactly right for a fixture corpus, which answers every caller identically,
 * and exactly wrong for a database, where the answer to "which projects are there" is a function of
 * who is asking. So the live path needs an identity, and this is the shape of it — introduced as a
 * separate module rather than a fourth field on the params so that a Zod-validated REQUEST shape
 * (which a client supplies) can never be confused with a SESSION-derived identity (which it must
 * not).
 *
 * ## The rule: the actor is derived, never accepted
 *
 * Nothing here is parsed from a request body or query string. The route resolves an actor from the
 * session cookie the middleware already hydrated and hands it in; a client that sends
 * `?userId=someone-else` is sending a value with no reader. This mirrors
 * `services/files/acting-principal.ts`, which established the pattern for the asset hub, and is why
 * both modules keep the identity type deliberately narrow — three facts plus a token, not the whole
 * {@link UserContext}, so a service cannot quietly branch on a chrome field like `isFreelancer` and
 * turn an identity decision into a capability one.
 *
 * ## The access token is the authority; the context is a hint
 *
 * `accessToken` is the only field with teeth: it is what {@link getUserClient} binds, so it is what
 * RLS evaluates. `userId`/`contextId` come from an UNVERIFIED decode of that same token (the global
 * middleware does not verify signatures — it resolves chrome), so they are safe to key a cache with
 * and to shape a query with, and unsafe to authorise with. A forged context can only ever address
 * rows the real, signed token still cannot read.
 *
 * That division is what makes {@link ReadActor.tenant} sound: a tamperer can poison their OWN cache
 * partition and nobody else's, because their partition is named by the value they tampered with.
 */

// #region The actor

/** The identity a read runs under. */
export interface ReadActor {
	/**
	 * The signed-in user's id, or `""` for an anonymous caller.
	 *
	 * Empty is a real, modelled value rather than an error: these routes sit outside the
	 * `(dashboard)` group, so a signed-out caller reaches them and must get a coherent refusal from
	 * the service rather than a thrown null.
	 */
	userId: string;
	/** The entity being acted as (`""` in a personal context) — a distinct read scope. */
	contextId: string;
	/** The kind of entity being acted as, straight from the chrome context. */
	contextType: UserContext["contextType"];
	/**
	 * The raw `sb-access-token` for this request, when there is one.
	 *
	 * Absent for a guest, and absent when the session has expired but not yet been refreshed. A live
	 * read with no token cannot be RLS-scoped at all, which is why {@link isAuthenticated} is derived
	 * from this rather than from the cookie's mere presence.
	 */
	accessToken?: string;
}

/** The anonymous caller. Frozen and shared so "no session" is one identity, not a fresh object. */
export const ANONYMOUS_READER: ReadActor = Object.freeze({
	userId: "",
	contextId: "",
	contextType: "personal" as const,
});

/**
 * Whether this actor can perform an RLS-scoped read.
 *
 * Deliberately requires BOTH a user id and a token. A token with no decodable user is a token we
 * cannot key a cache with; a user id with no token is an identity we cannot prove to Postgres.
 * Either alone is half an identity, which is the shape that authorises something by accident.
 */
export function canReadLive(actor: ReadActor): actor is ReadActor & { accessToken: string } {
	return actor.userId.length > 0 && typeof actor.accessToken === "string" &&
		actor.accessToken.length > 0;
}

/**
 * The cache partition this actor's answers belong to.
 *
 * The token is deliberately NOT part of the key. It rotates on every refresh, and keying on it would
 * make the cache miss every time a session renews — while adding no isolation, since the user id and
 * context it decodes to are already both present.
 */
export function tenantOf(actor: ReadActor): CacheTenant {
	return { userId: actor.userId, contextId: actor.contextId };
}

/**
 * Map a chrome {@link UserContext} plus a token onto a {@link ReadActor}.
 *
 * A context with no `userId` collapses to {@link ANONYMOUS_READER} even when a token was supplied:
 * a token we could not decode an identity out of is not an identity, and carrying it forward would
 * produce an actor that passes `canReadLive` while being keyed on `""`.
 *
 * `personal` keeps `contextId` as the user's own id so that "my personal feed" and "my team's feed"
 * are two different cache partitions rather than one partition and one empty string.
 */
export function actorFrom(
	context: UserContext | null | undefined,
	accessToken?: string,
): ReadActor {
	if (!context?.userId) return ANONYMOUS_READER;
	return {
		userId: context.userId,
		contextType: context.contextType,
		contextId: context.contextType === "personal" ? context.userId : context.contextId,
		accessToken,
	};
}

// #endregion

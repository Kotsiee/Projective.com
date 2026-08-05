import type { AssetOwnerType } from "@projective/types/files";
import type { UserContext } from "@projective/types/auth";
import { HUB_OWNER_ID, HUB_OWNER_TYPE } from "./assets-fixtures.ts";

/**
 * acting-principal — who is calling, and which library a write may be attributed to.
 *
 * Every mutation in the asset hub and the connector subsystem names an OWNER: the library a file lands
 * in, the principal a folder belongs to, the allowance an upload is metered against. Before this
 * module that owner arrived in the request payload, which means the answer to "whose library is this?"
 * was supplied by the party asking. This module makes it a server decision instead.
 *
 * **The rule: a client-supplied owner is a REQUEST to act as that principal, never the answer.** The
 * route derives a {@link FilesActor} from the session it already hydrates, hands it to the fat service,
 * and the service resolves the owner it will actually write. A payload owner is only ever an input to
 * that decision.
 *
 * **This is identity, not capability.** It answers "who is calling" and "may they act as this
 * principal" — it does NOT ask whether their persona, plan or role permits the operation. A capability
 * bounce on these routes would make every Dev Context Switcher axis inert, because the switcher is a
 * CLIENT seam the server cannot see (Decision #53(b)); identity has no such problem, since it is read
 * from a cookie the client cannot forge into a different user without the signing key.
 *
 * **The active context claim IS the membership evidence**, so authorising a team/business/organisation
 * write needs no database round trip: `security.custom_access_token_hook` resolves membership at token
 * issue and stamps the acting context into the JWT (Decision #17), and the global middleware decodes it
 * onto `ctx.state.userContext` (Decision #16). What the middleware decodes is UNVERIFIED — it is chrome
 * resolution, not an access decision — which is why {@link authoriseOwner} is a *narrowing* check that
 * runs in front of RLS rather than instead of it. A forged context can only ever address a principal
 * whose rows the caller's real JWT still cannot read.
 */

// #region The principal

/**
 * The acting principal, derived server-side from the session.
 *
 * Deliberately NOT the whole {@link UserContext}: a fat service should not be able to branch on chrome
 * fields like `handle` or `isFreelancer`, and reducing to the three identity facts here is what keeps
 * an authority decision from quietly becoming a capability one.
 */
export interface FilesActor {
	/**
	 * The signed-in user's id, or `""` when the session resolved none.
	 *
	 * Empty is a REAL value meaning anonymous — a share-link recipient with no account is a first-class
	 * caller here — so it is modelled rather than treated as an error.
	 */
	userId: string;
	/** The entity the caller is currently ACTING AS, mapped onto the files owner vocabulary. */
	contextType: AssetOwnerType;
	/** That entity's id; `""` in a personal context, where {@link userId} is the owner. */
	contextId: string;
}

/** An owner reference — the principal a stored row is attributed to. */
export interface AssetOwnerRef {
	ownerType: AssetOwnerType;
	ownerId: string;
}

/**
 * The caller with no resolved session.
 *
 * Frozen and shared so an anonymous actor is one identity across the process rather than a fresh
 * object per request that could drift field by field.
 */
export const ANONYMOUS_ACTOR: FilesActor = Object.freeze({
	userId: "",
	contextType: "user",
	contextId: "",
});

// #endregion

// #region Resolution

/**
 * Map an auth {@link UserContext} onto the acting principal.
 *
 * `personal` collapses to the `user` owner because a person's own library is owned by their user id,
 * not by a separate personal-entity id — the auth vocabulary and the files owner vocabulary describe
 * the same thing under two names, and this is the single place they are reconciled.
 *
 * A guest context yields {@link ANONYMOUS_ACTOR} rather than a partially-filled actor: half an identity
 * is the shape that authorises something by accident.
 *
 * Takes the RAW `ctx.state.userContext`, not `asAuthenticatedContext()`. That helper exists to decide
 * which shell to paint and substitutes a placeholder personal context for a guest — useful for chrome,
 * wrong here, because it would discard a real user id along the way. This function does its own
 * null-handling for exactly that reason, so a route never has to choose.
 */
export function actorFromContext(context: UserContext | null | undefined): FilesActor {
	if (!context || !context.userId) return ANONYMOUS_ACTOR;
	const contextType: AssetOwnerType = context.contextType === "personal"
		? "user"
		: context.contextType;
	return {
		userId: context.userId,
		contextType,
		// A personal context's `contextId` is the user id; every other context carries the entity's.
		contextId: contextType === "user" ? context.userId : context.contextId,
	};
}

/**
 * The owner a write is attributed to while `FILES_BACKEND_LIVE` is off.
 *
 * The fixture corpus expresses exactly ONE library, so a stubbed write lands there whoever is calling.
 * The point of routing through this function anyway is that the owner is DERIVED at the boundary
 * instead of copied out of the payload — so when the gate flips, the payload has never been trusted
 * and there is no call site to go back and re-audit.
 *
 * `actor` is accepted and unused on purpose: the signature is the one the live path needs, and a stub
 * that took no actor would have to grow one everywhere the day it starts mattering.
 */
export function fixtureOwner(actor: FilesActor): AssetOwnerRef {
	void actor;
	return { ownerType: HUB_OWNER_TYPE, ownerId: HUB_OWNER_ID };
}

/**
 * Authorise a requested owner against the acting principal, returning it when the session evidences
 * the claim and `null` when it does not.
 *
 * Two principals are reachable and no others: the caller's OWN library, and the entity they are
 * currently acting as. An entity they are merely a member of but not currently acting as is refused —
 * switching context is an explicit, JWT-re-stamping act (`security.switch_session_context`, Decision
 * #61), and honouring a payload that names a different entity would make that switch decorative.
 *
 * A `null` return is a 403, never a 404: the caller named a principal that exists and asked to act as
 * it, and pretending the principal is absent would be a different (and false) statement.
 */
export function authoriseOwner(
	actor: FilesActor,
	requested: AssetOwnerRef,
): AssetOwnerRef | null {
	if (requested.ownerType === "user") {
		// An anonymous caller owns no library, so `""` can never match `""` into a real one.
		if (!actor.userId) return null;
		return requested.ownerId === actor.userId ? requested : null;
	}
	if (!actor.contextId || actor.contextType !== requested.ownerType) return null;
	return actor.contextId === requested.ownerId ? requested : null;
}

// #endregion

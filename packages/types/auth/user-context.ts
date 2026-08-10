import { z } from "zod";
import { DEFAULT_LOCALE, PLATFORM_BASE_CURRENCY, toDisplayCurrency } from "../finance/fx.ts";

/**
 * auth/user-context — the Zod SSOT for the **User Context Hydration** shape.
 *
 * This is the lightweight, chrome-only description of *who the request is acting as* — resolved once
 * on the server (from the session JWT's claims) and shipped into SSR so the correct navigation shell
 * and skeletons render in the very first byte of HTML, with no client-side round-trip.
 *
 * It is deliberately **non-authoritative**: like the app's `hasSessionCookie` presence check, it only
 * decides *chrome* (which sidebar/skeleton to paint). It grants no access — RLS and the `(dashboard)`
 * guard remain the real gates, and every state change must re-validate server-side. A user who tampers
 * with the hydrated HTML only changes what their own browser draws, never what the backend permits.
 *
 * Only regex/min/max/enum/array/boolean primitives are used, so the schema is stable across Zod
 * majors (matching the convention in `@projective/types/org`).
 */

// #region Enums
/**
 * The structural context the user is currently acting within. `personal` is the individual's own
 * space (and the neutral default for guests); `team`/`business`/`organisation` are the multi-tenant
 * entities a user can switch into.
 */
export const ContextType = z.enum(["personal", "team", "business", "organisation"]);
export type ContextType = z.infer<typeof ContextType>;

/**
 * The actor's authority *within the active context*, collapsed to the three levels the chrome needs.
 * Guests are unauthenticated; `member` is the standard authenticated actor; `admin` unlocks
 * management chrome. Richer entity roles (e.g. an organisation `owner`) collapse to `admin` here —
 * see {@link normaliseRole} — because the shell only needs "can this actor see admin controls".
 */
export const ContextRole = z.enum(["guest", "member", "admin"]);
export type ContextRole = z.infer<typeof ContextRole>;
// #endregion

// #region Shape
/**
 * The resolved user context injected into `ctx.state` and passed to layouts/islands as a read-only
 * visual guide. See the module doc: hydration decides chrome, never access.
 */
export const UserContextSchema = z.object({
	/** The structural space the request is acting within. */
	contextType: ContextType,
	/**
	 * The active entity id for a `team`/`business`/`organisation` context (the tenant id), or the
	 * user's own id for `personal`. Empty string for guests / when unresolved.
	 */
	contextId: z.string().max(64),
	/** The actor's authority within {@link contextType}. */
	role: ContextRole,
	/** Whether the actor can hire/buy (client/buyer capability). Organisations are always clients. */
	isClient: z.boolean(),
	/** Whether the actor can offer/sell services (freelancer/seller capability). */
	isFreelancer: z.boolean(),
	/** The acting handle (`@handle`), when resolved — drives switcher + profile links. */
	handle: z.string().max(40).nullable(),
	/** The authenticated user's id (`sub`), or `null` for guests. */
	userId: z.string().max(64).nullable(),
	/**
	 * The ISO-4217 currency this viewer's money figures are **formatted** in
	 * (`org.user_preferences.preferred_display_currency`, stamped into the JWT by the access-token
	 * hook). Always a supported display currency — an unknown or absent claim resolves to the platform
	 * base, never to a code the rate table cannot price.
	 *
	 * Presentation only, and in the strongest sense: it changes the symbol a figure is drawn with and
	 * nothing else. Origin amounts stay in their origin currency on every row, and settlement always
	 * reproduces the `(fx_rate, fx_base, fx_as_of)` snapshot committed with the transaction. A viewer
	 * who tampers with this claim changes what their own browser draws, never what they are charged.
	 */
	displayCurrency: z.string().min(3).max(3),
	/** The BCP-47 locale (`org.user_preferences.locale`) `Intl` formats dates and money with. */
	locale: z.string().max(20),
});
export type UserContext = z.infer<typeof UserContextSchema>;
// #endregion

// #region Claims contract
/**
 * The subset of a Supabase access-token (GoTrue JWT) payload we read to resolve context. The token
 * carries app-controlled claims in `app_metadata` (set server-side / via an access-token auth hook)
 * and onboarding metadata in `user_metadata`. All fields are optional — the resolver tolerates a
 * partial or unfamiliar token and falls back to safe personal defaults.
 */
export interface AccessTokenClaims {
	/** The user id. */
	sub?: string;
	/** App-controlled claims — the authoritative source of the active context, when present. */
	app_metadata?: Record<string, unknown>;
	/** Onboarding/profile metadata (e.g. `objective: "freelancer" | "client"`). */
	user_metadata?: Record<string, unknown>;
}

/**
 * The active-context claim the backend stamps into `app_metadata.active_context` via the Supabase
 * custom access-token hook (`public.custom_access_token_hook`, migration
 * `20260715120000_access_token_context_hook.sql`). Documented here so the producer (Postgres) and
 * this consumer never drift. All parts are optional so an un-stamped/legacy token still resolves.
 *
 * `isClient`/`isFreelancer` are the **authoritative** capability flags resolved server-side from
 * `org.users_public` (`is_freelancer`/`is_operator`) and the active context — preferred over the
 * onboarding `objective` when present (which can go stale after a freelancer conversion).
 */
export interface ActiveContextClaim {
	type?: string;
	id?: string;
	role?: string;
	handle?: string;
	isClient?: boolean;
	isFreelancer?: boolean;
	/** `org.user_preferences.preferred_display_currency` — the viewer's money FORMATTING target. */
	displayCurrency?: string;
	/** `org.user_preferences.locale` — the BCP-47 locale `Intl` formats with. */
	locale?: string;
}
// #endregion

// #region Defaults
/** The context for an unauthenticated request — the neutral guest chrome. */
export const GUEST_CONTEXT: UserContext = Object.freeze({
	contextType: "personal",
	contextId: "",
	role: "guest",
	isClient: false,
	isFreelancer: false,
	handle: null,
	userId: null,
	displayCurrency: PLATFORM_BASE_CURRENCY,
	locale: DEFAULT_LOCALE,
});

/**
 * The fallback for an authenticated request whose token could not be decoded to real claims (the
 * skeleton/dev case where `sb-access-token` is an opaque non-JWT). Populates a sensible personal,
 * buyer-capable member space so the authed shell is never empty. Superseded the moment a real,
 * claim-bearing JWT is present. Use via {@link asAuthenticatedContext}.
 */
export const PERSONAL_MEMBER_CONTEXT: UserContext = Object.freeze({
	contextType: "personal",
	contextId: "",
	role: "member",
	isClient: true,
	isFreelancer: false,
	handle: null,
	userId: null,
	displayCurrency: PLATFORM_BASE_CURRENCY,
	locale: DEFAULT_LOCALE,
});

/**
 * Coerce a resolved context into one safe to render the *authenticated* shell from: a real
 * (non-guest) context passes through; a `guest`/absent context (opaque dev cookie) becomes
 * {@link PERSONAL_MEMBER_CONTEXT}. Call this at the layout boundary, gated on the authenticated flag.
 */
export function asAuthenticatedContext(context: UserContext | undefined | null): UserContext {
	return context && context.role !== "guest" ? context : PERSONAL_MEMBER_CONTEXT;
}
// #endregion

// #region Pure resolver
/** Coerce an unknown value to a trimmed non-empty string, else undefined. */
function str(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Narrow a raw claim string to a known {@link ContextType}, else `personal`. */
function normaliseContextType(raw: string | undefined): ContextType {
	const parsed = ContextType.safeParse(raw);
	return parsed.success ? parsed.data : "personal";
}

/**
 * Collapse a raw entity role to a chrome {@link ContextRole}. `owner` (organisations) and any
 * admin-equivalent map to `admin`; an unauthenticated/unknown value stays `member` for an
 * authenticated actor (callers pass `guest` explicitly for no session).
 */
function normaliseRole(raw: string | undefined): ContextRole {
	switch ((raw ?? "").toLowerCase()) {
		case "owner":
		case "admin":
			return "admin";
		case "member":
			return "member";
		default:
			return "member";
	}
}

/**
 * Resolve a {@link UserContext} from decoded access-token claims. Pure and total: `null` (no/expired
 * session) yields {@link GUEST_CONTEXT}; a present token resolves the active context from
 * `app_metadata.active_context`, capability flags from the onboarding `objective`, and falls back to
 * a `personal`/`member` space keyed on the user id when claims are sparse.
 *
 * Capability rules (chrome only — the server re-derives authoritatively):
 *  - Individuals: `objective: "freelancer"` → seller; `"client"` → buyer.
 *  - Organisations are **client/buyer-only** (root CLAUDE.md Decision #9/#10) → always `isClient`.
 */
export function resolveUserContext(claims: AccessTokenClaims | null | undefined): UserContext {
	if (!claims || !str(claims.sub)) return GUEST_CONTEXT;

	const userId = str(claims.sub)!;
	const app = claims.app_metadata ?? {};
	const user = claims.user_metadata ?? {};

	const active =
		(typeof app.active_context === "object" && app.active_context !== null
			? app.active_context
			: {}) as ActiveContextClaim;

	const contextType = normaliseContextType(str(active.type));
	// The active tenant id for an entity context; the user's own id for a personal space.
	const contextId = str(active.id) ?? (contextType === "personal" ? userId : "");
	const role = normaliseRole(str(active.role));

	// Capability flags. Prefer the authoritative booleans the access-token hook stamps (resolved
	// server-side from org.users_public + the active context); fall back to the onboarding objective
	// for legacy/un-stamped tokens. An organisation context is always buyer-only by product rule.
	const isOrganisation = contextType === "organisation";
	const objective = (str(user.objective) ?? "").toLowerCase();
	const isFreelancer = typeof active.isFreelancer === "boolean"
		? active.isFreelancer && !isOrganisation
		: !isOrganisation && objective === "freelancer";
	const isClient = typeof active.isClient === "boolean"
		? active.isClient || isOrganisation
		: isOrganisation || objective === "client" || !isFreelancer;

	const handle = str(active.handle) ?? str(user.username) ?? null;

	// Presentation preferences. `toDisplayCurrency` is total: an absent, malformed or unsupported
	// claim collapses to the platform base rather than to a code the FX table cannot price — the one
	// failure that would render an unconverted amount under the wrong symbol.
	const displayCurrency = toDisplayCurrency(str(active.displayCurrency));
	const locale = str(active.locale) ?? str(user.locale) ?? DEFAULT_LOCALE;

	return {
		contextType,
		contextId,
		role,
		isClient,
		isFreelancer,
		handle,
		userId,
		displayCurrency,
		locale,
	};
}
// #endregion

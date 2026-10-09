import { z } from "zod";

/**
 * Connected sign-in accounts — the Zod SSOT for the GoTrue identities a person can sign in with
 * (Settings → Account → Connected accounts). GoTrue owns the identities (`auth.identities`); this
 * module only carries what `GET /api/user/identities` answers.
 */

// #region Providers
/**
 * Every provider the settings list draws, in display order. `email` is the address-and-password
 * identity (managed under Email addresses and Password, never disconnected here). `amazon` has no
 * GoTrue provider, so it is always reported unavailable rather than offered.
 */
export const SignInProvider = z.enum([
	"email",
	"google",
	"apple",
	"facebook",
	"linkedin_oidc",
	"azure",
	"amazon",
]);
export type SignInProvider = z.infer<typeof SignInProvider>;

/** The providers a person can connect or disconnect from Settings (everything but `email`). */
export const LINKABLE_PROVIDERS: readonly SignInProvider[] = SignInProvider.options.filter(
	(provider) => provider !== "email",
);

/** Whether a value names a provider that can be linked from Settings. */
export function isLinkableProvider(value: unknown): value is SignInProvider {
	return typeof value === "string" && (LINKABLE_PROVIDERS as readonly string[]).includes(value);
}
// #endregion

// #region Identities
/** One identity on the account. */
export const ConnectedIdentitySchema = z.object({
	/** GoTrue's `identity_id` — what an unlink names. */
	id: z.string(),
	provider: SignInProvider,
	/** The address the provider reported, when it reported one. */
	email: z.string().nullable(),
	connectedAt: z.string().nullable(),
	lastSignInAt: z.string().nullable(),
});
export type ConnectedIdentity = z.infer<typeof ConnectedIdentitySchema>;

/** `GET /api/user/identities`. */
export const ConnectedAccountsSchema = z.object({
	identities: z.array(ConnectedIdentitySchema),
	/** Providers switched on in this environment (GoTrue `/settings`), `email` excluded. */
	available: z.array(SignInProvider),
	/** `false` when only one sign-in method is left, so none may be disconnected. */
	canDisconnect: z.boolean(),
});
export type ConnectedAccounts = z.infer<typeof ConnectedAccountsSchema>;
// #endregion

/**
 * profile.reserved — the reserved-handle denylist safeguard for the `/[handle]` wildcard namespace.
 *
 * Fresh file-based routing already resolves static routes (`/explore`, `/login`, `/help/*`) BEFORE the
 * top-level `[handle]` dynamic segment, so a real static route can never be shadowed. This denylist is
 * the second line of defence (ROUTING.md §Reserved-handle precedence): it stops a BARE word that has
 * no static route (`/availability`, `/files`) from being fabricated into a profile, and it is the rule
 * a future "claim your handle" flow validates against so a user can never register a colliding handle.
 *
 * Both the fat {@link ProfileBackendService} (which fabricates the stub profile) and the app's
 * `[handle]/_middleware.ts` (which 404s before painting chrome) read this one list, so the two never
 * drift. Kept in the SSOT types package because it is domain vocabulary shared across the boundary.
 */

// #region Normalisation
/** Normalise a route/handle token to its comparison key: strip a leading `@`, lower-case, trim. */
export function normalizeHandle(handle: string): string {
	return handle.replace(/^@+/, "").trim().toLowerCase();
}
// #endregion

// #region Planned segments
/**
 * Top-level words reserved AHEAD of a route file, which the namespace guard cannot see: words a source
 * doc names as a page that does not exist yet, paths something other than a route serves, and words
 * the namespace will plausibly need (marked "speculative"). Each line names its source (Decision #444
 * flag (c), ruled 2026-11-18; ROUTING.md §Reserved-handle precedence).
 *
 * Every word is in {@link RESERVED_HANDLES} and in `org.fn_is_reserved_handle`, and
 * `workspace.contract.test.ts` fails when one is missing from either. When a word's route ships, the
 * same test asks for it to move out of this list: the route then reserves it.
 */
export const PLANNED_SEGMENTS: readonly string[] = [
	"analytics", // PRODUCT_SPEC §Sitemap `/analytics` (no route file, #444 (c))
	"connections", // PRODUCT_SPEC §Sitemap `/connections` (no route file, #444 (c))
	"disputes", // PRODUCT_SPEC §Sitemap `/disputes`; ROUTING: a party's dispute pages are unbuilt (#212)
	"reset", // PRODUCT_SPEC §Sitemap `/reset`; ROUTING: in `AUTH_PATHS` only, as `register` is
	"vendor", // `/vendor/<lib>/<version>/…`, served by `vendorAssets()` (vite.config.ts, #161)
	"email", // `apps/web/static/email/`, served at `/email/*`
	"root", // the sign-up form's own list (#257 flag (d)), now this one
	"support", // the sign-up form's own list (#257 flag (d)); speculative: a help or support desk
	"projective", // the sign-up form's own list (#257 flag (d)); the platform's own name
	"www", // the sign-up form's own list (#257 flag (d)); a host name
	"mail", // the sign-up form's own list (#257 flag (d)); a host name
	"security", // speculative: platform voice (ROUTING: the reason `share` and `exit` are held)
	"trust", // speculative: platform voice (trust and safety)
	"safety", // speculative: platform voice (trust and safety)
	"abuse", // speculative: platform voice (reporting abuse)
	"report", // speculative: platform voice (the report flow, #148)
	"official", // speculative: platform voice
	"staff", // speculative: platform voice
	"system", // speculative: platform voice (system notices)
	"moderator", // speculative: platform voice
	"operator", // speculative: platform voice (the operator desk, #212)
	"press", // speculative: platform voice (a press page)
	"docs", // speculative: surface (product or API documentation)
	"developers", // speculative: surface (a developer portal)
	"integrations", // speculative: surface (an integrations directory)
	"marketplace", // speculative: surface (the asset marketplace)
	"account", // speculative: surface (account settings)
	"profile", // speculative: ROUTING: profiles live at `/@handle`, never `/profile/[handle]`
	"profiles", // speculative: a brief once asked for `/profiles/[id]` (decision log)
	"enterprise", // speculative: surface (the fourth handle table has no top-level page)
	"enterprises", // speculative: surface (the fourth handle table has no top-level page)
	"community", // speculative: surface (community and member posts)
	"partners", // speculative: surface (a partner programme)
	"jobs", // speculative: surface (a job board)
	"talent", // speculative: surface (talent discovery)
	"hire", // speculative: surface (a hiring entry point)
	"reports", // speculative: surface (reporting)
	"insights", // speculative: surface (analytics insights)
	"standing", // speculative: surface (Standing, the reputation score)
	"verification", // speculative: surface (identity and business verification)
	"subscriptions", // speculative: surface (SaaS tiers)
	"plans", // speculative: surface (SaaS tiers, beside `/pricing`)
	"upgrade", // speculative: surface (a plan upgrade flow)
	"referrals", // speculative: surface (a referral programme)
	"templates", // speculative: surface (stage and project templates)
	"guides", // speculative: surface (editorial guides)
	"events", // speculative: surface (community events)
	"auth", // speculative: infrastructure (auth callbacks)
	"oauth", // speculative: infrastructure (an OAuth provider or consent page)
	"sso", // speculative: infrastructure (SSO1, Identity §5)
	"webhooks", // speculative: infrastructure
	"cdn", // speculative: infrastructure
	"media", // speculative: infrastructure (media delivery)
	"uploads", // speculative: infrastructure
	"images", // speculative: infrastructure
	"fonts", // speculative: infrastructure
	"health", // speculative: infrastructure (health checks)
	"healthz", // speculative: infrastructure (health checks)
	"metrics", // speculative: infrastructure
	"graphql", // speculative: infrastructure
	"rpc", // speculative: infrastructure
	"null", // speculative: placeholder word a broken link renders
	"undefined", // speculative: placeholder word a broken link renders
	"anonymous", // speculative: placeholder word for an unnamed actor
	"guest", // speculative: placeholder word for a signed-out viewer
	"everyone", // speculative: placeholder word for an audience
	"user", // speculative: placeholder word
	"users", // speculative: placeholder word
];
// #endregion

// #region Reserved handles
/**
 * Every top-level path segment reserved against handle registration. Covers the real static/group
 * routes (public + dashboard), the API + framework paths, the task's explicit safeguards (`explore`,
 * `projects`, `files`, `settings`, `about`, `login`, `availability`) and every
 * {@link PLANNED_SEGMENTS} word.
 *
 * The namespace guard (Teams P1): every top-level segment under `apps/web/routes/` (route groups
 * descended, `[params]` and `_`-files skipped) must be listed here AND in its SQL twin
 * `org.fn_is_reserved_handle` — `workspace.contract.test.ts` fails the build otherwise. The sign-up
 * form, the workspace create forms and every SQL door that mints a handle read this one list.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
	...PLANNED_SEGMENTS,
	// Public / marketing / auth
	"about",
	"explore",
	"help",
	"view",
	"join",
	"login",
	"register",
	"signin",
	"signup",
	"logout",
	"forgot-password",
	"reset-password",
	"verify",
	"index",
	"home",
	"pricing",
	"terms",
	"privacy",
	"legal",
	"contact",
	"blog",
	"careers",
	"status",
	// The public editorial routes (`/changelog`, `/feedback`) and the landing track's `/features`.
	"changelog",
	"feedback",
	"features",
	// The newsletter link pages (`/newsletter/confirm`, `/newsletter/unsubscribe`; PRD-E11, #480).
	"newsletter",
	// Dashboard / app surfaces
	"dashboard",
	"projects",
	"project",
	"business",
	"businesses",
	"teams",
	"team",
	"messages",
	"inbox",
	"files",
	"file",
	// The shell-free file inspector (`/inspect/[fileId]`, Decision #161(G)).
	"inspect",
	"share",
	// The outbound-link interstitial: a handle shadowing the page that vouches for leaving the platform
	// would be a phishing primitive, the reason `share` is listed.
	"exit",
	"wallet",
	"billing",
	"settings",
	"services",
	"service",
	"products",
	"portfolio",
	"reviews",
	"articles",
	"members",
	"departments",
	"education",
	"experience",
	"availability",
	"become-partner",
	"onboarding",
	"notifications",
	"basket",
	"cart",
	"checkout",
	"catalogue",
	"orders",
	"order",
	"pay",
	"payment",
	"payments",
	"invoice",
	"invoices",
	"create",
	"new",
	"search",
	"files",
	"submissions",
	"attachments",
	"board",
	"tasks",
	"calendar",
	"meet",
	// The stage invite-link landing (`/invite/[token]`, Decision #145) and the saved page (`/saved`,
	// Decision #180) — real top-level routes, held by the namespace guard (Teams P1).
	"invite",
	// A guest's invitation (`/rsvp/[token]`, Decision #391).
	"rsvp",
	"saved",
	// Framework / infra
	"api",
	"assets",
	"static",
	"public",
	"_app",
	"_middleware",
	"_layout",
	"favicon.ico",
	"robots.txt",
	"sitemap.xml",
	"admin",
	"internal",
]);

/** Whether a handle collides with a reserved top-level route segment (denylist safeguard). */
export function isReservedHandle(handle: string): boolean {
	return RESERVED_HANDLES.has(normalizeHandle(handle));
}
// #endregion

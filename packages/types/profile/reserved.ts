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

/** Normalise a route/handle token to its comparison key: strip a leading `@`, lower-case, trim. */
export function normalizeHandle(handle: string): string {
	return handle.replace(/^@+/, "").trim().toLowerCase();
}

/**
 * Every top-level path segment reserved against handle registration. Covers the real static/group
 * routes (public + dashboard), the API + framework paths, and the task's explicit safeguards
 * (`explore`, `projects`, `files`, `settings`, `about`, `login`, `availability`).
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
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
	"create",
	"new",
	"search",
	"files",
	"submissions",
	"attachments",
	"board",
	"tasks",
	"calendar",
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

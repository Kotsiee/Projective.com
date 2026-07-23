/**
 * `@projective/types/user` — the Zod SSOT for the acting user's account projection (the header
 * account popover's data shape). See {@link current-user}. A derived read projection over the Supabase
 * `auth.users` + `org.users_public` records; no DB table of its own, so it lands with no migration.
 */
export {
	type AccountBadge,
	AccountRole,
	type ActiveWorkspace,
	ActiveWorkspaceSchema,
	type CurrentUser,
	CurrentUserSchema,
	resolveAccountRole,
	WorkspaceKind,
} from "./current-user.ts";

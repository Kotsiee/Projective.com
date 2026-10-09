/**
 * `@projective/types/user` — the Zod SSOT for the acting user's account projection (the header
 * account popover's data shape). See {@link current-user}. A derived read projection over the Supabase
 * `auth.users` + `org.users_public` records; no DB table of its own, so it lands with no migration.
 * Also the one avatar-resolution rule every person picture follows ({@link avatar}), and the
 * profile-completeness rule behind the popover's completion ring ({@link profile-setup}), and the
 * "Become a Partner" freelancer unlock ({@link freelancer-conversion}).
 */
export {
	type AvatarSources,
	type AvatarTier,
	avatarTierFor,
	DEFAULT_AVATAR_URL,
	isOAuthProvider,
	OAUTH_AVATAR_HOSTS,
	oauthAvatarFromMetadata,
	type OAuthAvatarSource,
	OAuthAvatarSourceSchema,
	oauthProviderLabel,
	resolveAvatarUrl,
	safeOAuthAvatarUrl,
} from "./avatar.ts";
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
export {
	type EnableFreelancerInput,
	EnableFreelancerInputSchema,
	type FreelancerConversionResult,
	FreelancerConversionResultSchema,
	MAX_STARTER_SKILLS,
	SkillSlugSchema,
	type StarterSkillOption,
	StarterSkillOptionSchema,
} from "./freelancer-conversion.ts";
export { type AccountSetup, AccountSetupSchema } from "./profile-setup.ts";

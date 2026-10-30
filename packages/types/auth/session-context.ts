import { z } from "zod";

/**
 * security.session_context — the Zod mirror of the acting-context row (`00000012_tables_security.sql`,
 * IDENTITY_AND_WORKSPACES audit IW-M9). One row per person, written only by the context-switch
 * definer; {@link UserContext} in `user-context.ts` is the projection the app reads.
 * `identity-tables.contract.test.ts` holds it to the migration, column for key.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");

/** `public.profile_type`: the profile kinds a context slot can name. */
export const ProfileType = z.enum(["freelancer", "business"]);
export type ProfileType = z.infer<typeof ProfileType>;

/**
 * A row of `security.session_context`. One acting context at a time (`ck_session_context_one_slot`):
 * personal (every slot `null`), a profile (the type and id set or cleared together), a team or an
 * enterprise. The profile and team ids are polymorphic and carry no FK; the enterprise slot is
 * `SET NULL` when its enterprise goes.
 */
export const SessionContextRowSchema = z
	.object({
		userId: uuid,
		activeProfileType: ProfileType.nullable(),
		activeProfileId: uuid.nullable(),
		activeTeamId: uuid.nullable(),
		updatedAt: z.string(),
		activeEnterpriseId: uuid.nullable(),
	})
	.refine(
		(row) =>
			[row.activeProfileId, row.activeTeamId, row.activeEnterpriseId].filter((id) => id !== null)
					.length <= 1 &&
			(row.activeProfileType === null) === (row.activeProfileId === null),
		{ message: "One acting context at a time." },
	);
export type SessionContextRow = z.infer<typeof SessionContextRowSchema>;

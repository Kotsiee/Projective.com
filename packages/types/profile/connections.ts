import { z } from "zod";
import { ProfileKind } from "./profile.ts";

/**
 * A profile's followers / following lists — the people behind the counts on the profile header. A
 * follow is a public edge (`org.profile_follows`), so the lists are public too; a profile the viewer
 * may not see is left out (`org.get_profile_cards`).
 */

/** Which side of the follow graph to list. Only a person follows, so `following` is a person's list. */
export const FollowDirection = z.enum(["followers", "following"]);
export type FollowDirection = z.infer<typeof FollowDirection>;

/** `GET /api/profile/[handle]/connections` query. `cursor` is the last row's follow instant. */
export const ProfileConnectionsParamsSchema = z.object({
	direction: FollowDirection,
	cursor: z.string().datetime({ offset: true }).optional(),
});
export type ProfileConnectionsParams = z.infer<typeof ProfileConnectionsParamsSchema>;

/** One person or entity in a followers / following list. */
export const ProfileConnectionSchema = z.object({
	handle: z.string(),
	name: z.string(),
	kind: ProfileKind,
	/** `null` = the default picture. */
	avatar: z.string().nullable(),
});
export type ProfileConnection = z.infer<typeof ProfileConnectionSchema>;

/** One page of a followers / following list. */
export const ProfileConnectionsSchema = z.object({
	items: z.array(ProfileConnectionSchema),
	nextCursor: z.string().nullable(),
});
export type ProfileConnections = z.infer<typeof ProfileConnectionsSchema>;

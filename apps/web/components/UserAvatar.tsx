import type { JSX } from "preact";
import {
	Avatar,
	type AvatarProps,
	AvatarStack,
	type AvatarStackProps,
} from "@projective/ui/display";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";

// #region Types

/**
 * Props for {@link UserAvatar}: `Avatar`'s, with the person's name REQUIRED (it is the accessible name
 * and the initials beneath the default picture) and the stand-in picture fixed by the platform.
 */
export type UserAvatarProps = Omit<AvatarProps, "fallbackImage" | "label"> & {
	/** The person's display name. */
	label: string;
};

// #endregion

/**
 * UserAvatar — THE way the app draws a person's profile picture.
 *
 * The picture's source is chosen on the server by the one avatar rule (`@projective/types/user`
 * avatar.ts): the uploaded photo at the surface's tier, else the OAuth provider's picture, else `null`.
 * This component adds the last rung: for a `null` picture, AND for one that fails to load, it paints
 * {@link DEFAULT_AVATAR_URL}, with the person's initials beneath should that fail too.
 *
 * Use it for PEOPLE only. An organisation, team, workspace or group chat is drawn with `Avatar`
 * directly (or `EntityMark`), because a stranger's face is the wrong stand-in for a company.
 */
export function UserAvatar(props: UserAvatarProps): JSX.Element {
	return <Avatar {...props} fallbackImage={DEFAULT_AVATAR_URL} />;
}

/**
 * The owner kinds that are a PERSON across the app's projections (`ProfileKind`, the explore owner,
 * the review author, the wallet scope). Everything else — `team`, `business`, `organisation` — is an
 * entity.
 */
const PERSON_KINDS: ReadonlySet<string> = new Set(["user", "client", "freelancer", "personal"]);

/**
 * `Avatar`'s `fallbackImage` for a surface that draws EITHER a person or an entity: the default
 * picture for a person, nothing (initials) for an entity. Such a surface keeps `Avatar` — its shape
 * already varies by kind — and passes this, so its people follow the same chain as {@link UserAvatar}.
 */
export function personFallbackImage(kind: string | null | undefined): string | undefined {
	return kind && PERSON_KINDS.has(kind) ? DEFAULT_AVATAR_URL : undefined;
}

/** {@link AvatarStack} for a roster of people — every face with {@link UserAvatar}'s stand-in. */
export function UserAvatarStack(
	props: Omit<AvatarStackProps, "fallbackImage">,
): JSX.Element | null {
	return <AvatarStack {...props} fallbackImage={DEFAULT_AVATAR_URL} />;
}

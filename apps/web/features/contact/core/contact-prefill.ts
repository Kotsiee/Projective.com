import { CONTACT_LIMITS } from "@projective/types/contact";
import type { AccessTokenClaims } from "@projective/types/auth";

/**
 * contact-prefill — what a signed-in reader's form opens with (Decision #276): their name and address
 * from the session they already have, so a person who is signed in is not asked to type who they are.
 * Read from the access token's own claims (`user_metadata.full_name` / `name`, else a first and last
 * name; `user_metadata.email`, else the top-level `email` GoTrue stamps), exactly as `/join` re-builds
 * its pre-fill. Both stay editable — the reply may belong at a different address — and nothing here
 * decides who the request is from: the writer stamps `auth.uid()` itself. Pure.
 */

/** The two sender fields a form may open with; empty strings when the session does not say. */
export interface ContactPrefill {
	name: string;
	email: string;
}

/** The empty prefill — a guest's, or a session that carries neither. */
export const NO_PREFILL: Readonly<ContactPrefill> = { name: "", email: "" };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().replace(/\s+/g, " ");
	return trimmed === "" ? null : trimmed;
}

/** The sender fields a session's claims imply. Total: anything unusable is left empty. */
export function contactPrefillFromClaims(
	claims: AccessTokenClaims | null | undefined,
): ContactPrefill {
	if (!claims) return { ...NO_PREFILL };
	const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
	const joined = [
		text(meta.first_name) ?? text(meta.given_name),
		text(meta.last_name) ?? text(meta.family_name),
	]
		.filter((part): part is string => part !== null)
		.join(" ");
	const name = text(meta.full_name) ?? text(meta.name) ?? (joined === "" ? null : joined);
	const email = (text(meta.email) ?? text(claims.email) ?? "").toLowerCase();
	return {
		name: name && name.length <= CONTACT_LIMITS.name ? name : "",
		email: email.length <= CONTACT_LIMITS.email && EMAIL_SHAPE.test(email) ? email : "",
	};
}

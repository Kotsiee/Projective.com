import type { ProfileEditModel } from "@projective/types/profile";
import type { State } from "@web/utils/state.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import { type OwnerEdit, ownerEditFor } from "./owner-edit.ts";

/** The owner's rights and stored model, as the page's in-place editors take them. */
export interface OwnerContext {
	edit: OwnerEdit;
	model: ProfileEditModel;
}

/**
 * The owner context for a `/[handle]` request (Decision #439): present only when the database says
 * the viewer owns the profile AND their edit model could be read (`ctx.state.profileEdit`, resolved
 * by the namespace middleware). An under-18 owner's rights carry no availability block (Decision #208).
 */
export function ownerOf(
	ctx: { req: Request; state: Pick<State, "profile" | "profileEdit" | "userContext"> },
): OwnerContext | null {
	const { profile, profileEdit } = ctx.state;
	if (!profile || !profileEdit) return null;
	const edit = ownerEditFor(profile, {
		scheduling: !isRestrictedRequest(ctx.req, ctx.state.userContext),
	});
	return edit ? { edit, model: profileEdit } : null;
}

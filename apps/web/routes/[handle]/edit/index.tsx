import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import type { ProfileEditModel } from "@projective/types/profile";
import { resolveEditModel } from "@features/profile/core/profile-ssr.ts";
import ProfileEditor from "@features/profile/islands/ProfileEditor.island.tsx";

/**
 * `/[handle]/edit` — the owner's **Edit profile & settings** page.
 *
 * Owner-only, and the refusal is real on the server: a guest is sent to sign in with a way back here,
 * anyone else who can see the profile is sent to the profile itself (303), and a profile that does
 * not exist — or that the viewer may not see — is the layout's 404. The ownership answer is the
 * DATABASE's (`profile.viewer.isOwner`, read under the viewer's own session by the namespace
 * middleware), and the edit model is read the same way, so the form is never seeded with a profile
 * the viewer does not manage.
 *
 * The redirects are returned from `define.handlers`, never from the page component — a `Response`
 * returned by a component is dead code (root CLAUDE.md §8 Decision #61).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const profile = ctx.state.profile;
		if (!profile) return page({ model: null, userId: "" });
		const self = `/${profile.handle}/edit`;
		if (!ctx.state.accessToken && !ctx.state.isAuthenticated) {
			return new Response(null, {
				status: 303,
				headers: { location: `/login?redirectTo=${encodeURIComponent(self)}` },
			});
		}
		if (!profile.viewer?.isOwner) {
			return new Response(null, { status: 303, headers: { location: `/${profile.handle}` } });
		}
		const actor = readActor(ctx);
		const { model, status } = await resolveEditModel(profile.handle, actor);
		if (!model) {
			if (status === 401) {
				return new Response(null, {
					status: 303,
					headers: { location: `/login?redirectTo=${encodeURIComponent(self)}` },
				});
			}
			if (status === 403) {
				return new Response(null, { status: 303, headers: { location: `/${profile.handle}` } });
			}
			return page({ model: null, userId: actor.userId }, { status: 503 });
		}
		ctx.state.title = `Edit profile · ${profile.name} · Projective`;
		return page({ model, userId: actor.userId });
	},
});

export default define.page<typeof handler>(function ProfileEditPage(ctx) {
	const { model, userId } = ctx.data as { model: ProfileEditModel | null; userId: string };
	if (!ctx.state.profile) return null; // the layout renders the not-found body
	if (!model) {
		return (
			<p class="pf-empty__note" role="alert">
				Your profile can't be loaded for editing right now. Try again in a moment.
			</p>
		);
	}
	return <ProfileEditor model={model} userId={userId} />;
});

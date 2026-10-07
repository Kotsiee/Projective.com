import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readCookies, SB_ACCESS_COOKIE } from "@web/utils/auth-cookies.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { UserBackendService } from "@server/services/user/UserBackendService.ts";
import BecomePartnerWizard from "../islands/BecomePartnerWizard.island.tsx";
import { profileSetupPath } from "../core/partner-service.ts";

/**
 * `/become-partner` — the "Become a Partner" conversion page (`PRODUCT_SPEC.md` §Additive, Unlockable
 * Personas): a person who onboarded as a Client/Operator unlocks the freelancer suite on the same
 * identity by choosing their starter skills.
 *
 * Thin controller (the route file re-exports it): resolve the session, read the person's setup (is a
 * seller profile already there, and their `@handle`) and the `org.skills` taxonomy through the fat
 * {@link UserBackendService}, and hand plain props to the island. A person who already sells is shown
 * where to go instead of a form that would do nothing. The guest bounce is the `(dashboard)`
 * middleware's job.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		const accessToken = ctx.state.accessToken ?? readCookies(ctx.req)[SB_ACCESS_COOKIE];

		const [setupResult, skillsResult] = await Promise.all([
			UserBackendService.setup({ context, accessToken }),
			UserBackendService.starterSkills(),
		]);
		const setup = setupResult.ok ? setupResult.data?.setup ?? null : null;

		// The stored profile is the authority; the token's claim answers only when the read could not.
		const alreadySeller = setup ? setup.seller : context.isFreelancer;
		const personalHandle = setup?.handle ??
			(context.contextType === "personal" ? context.handle : null);

		ctx.state.title = "Become a Partner · Projective";
		return page({
			alreadySeller,
			editPath: personalHandle ? profileSetupPath(personalHandle) : null,
			skills: skillsResult.ok ? skillsResult.data?.skills ?? [] : [],
			skillsError: skillsResult.ok
				? null
				: skillsResult.message ?? "We couldn't load the skills list.",
		});
	},
});

export default define.page<typeof handler>(function BecomePartnerScreen({ data }) {
	return (
		<BecomePartnerWizard
			alreadySeller={data.alreadySeller}
			editPath={data.editPath}
			skills={data.skills}
			skillsError={data.skillsError}
		/>
	);
});

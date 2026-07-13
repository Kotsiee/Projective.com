import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { AuthShell } from "@features/auth/components/AuthShell.tsx";
import { SceneAside } from "@features/auth/components/SceneAside.tsx";
import LoginForm from "@features/auth/islands/LoginForm.island.tsx";
import { readRedirect } from "@features/auth/core/redirect.ts";

/**
 * `/login` — email/password + Google OAuth sign-in. Parses the captured return path (and an optional
 * `notice`, e.g. after a password reset) and delegates the interactive flow to the LoginForm island.
 */
export const handler = define.handlers({
	GET(ctx) {
		ctx.state.title = "Sign in · Projective";
		ctx.state.description = "Sign in to your Projective account.";
		return page({
			redirectTo: readRedirect(ctx.url.searchParams),
			notice: ctx.url.searchParams.get("notice"),
		});
	},
});

export default define.page<typeof handler>(function LoginRoute({ data }) {
	return (
		<AuthShell aside={<SceneAside variant="login" />}>
			<LoginForm redirectTo={data.redirectTo} notice={data.notice} />
		</AuthShell>
	);
});

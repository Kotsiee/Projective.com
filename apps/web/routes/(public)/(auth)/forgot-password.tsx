import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { AuthShell } from "@features/auth/components/AuthShell.tsx";
import { SceneAside } from "@features/auth/components/SceneAside.tsx";
import ForgotPasswordForm from "@features/auth/islands/ForgotPasswordForm.island.tsx";
import { readRedirect } from "@features/auth/core/redirect.ts";

/**
 * `/forgot-password` — two-step password recovery (request a code by email → enter the 6-digit code
 * + a new password). Thin controller; the ForgotPasswordForm island drives both steps and returns
 * the user to sign in, preserving the captured return path.
 */
export const handler = define.handlers({
	GET(ctx) {
		ctx.state.title = "Reset password · Projective";
		ctx.state.description = "Reset your Projective password.";
		return page({
			redirectTo: readRedirect(ctx.url.searchParams),
			email: ctx.url.searchParams.get("email") ?? undefined,
		});
	},
});

export default define.page<typeof handler>(function ForgotPasswordRoute({ data }) {
	return (
		<AuthShell aside={<SceneAside variant="forgot" />}>
			<ForgotPasswordForm redirectTo={data.redirectTo} email={data.email} />
		</AuthShell>
	);
});

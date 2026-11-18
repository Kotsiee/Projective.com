import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { AuthShell } from "@features/auth/components/AuthShell.tsx";
import { SceneAside } from "@features/auth/components/SceneAside.tsx";
import ForgotPasswordForm from "@features/auth/islands/ForgotPasswordForm.island.tsx";
import { readRedirect } from "@features/auth/core/redirect.ts";
import { captchaSiteKeyFor } from "@features/auth/core/captcha.ts";

/**
 * `/forgot-password` — two-step password recovery (request a code by email → enter the 6-digit code
 * + a new password). Thin controller; the ForgotPasswordForm island drives both steps and returns
 * the user to sign in, preserving the captured return path. `?step=reset` (the recovery email's
 * link) opens on the code step. An address in the query is dropped with a 303, so it never lingers
 * in history or a Referer.
 */
export const handler = define.handlers({
	GET(ctx) {
		if (ctx.url.searchParams.has("email")) {
			const clean = new URL(ctx.url);
			clean.searchParams.delete("email");
			return new Response(null, {
				status: 303,
				headers: { location: `${clean.pathname}${clean.search}` },
			});
		}
		ctx.state.title = "Reset password · Projective";
		ctx.state.description = "Reset your Projective password.";
		return page({
			redirectTo: readRedirect(ctx.url.searchParams),
			codeSent: ctx.url.searchParams.get("step") === "reset",
			captchaSiteKey: captchaSiteKeyFor(ctx.req),
		});
	},
});

export default define.page<typeof handler>(function ForgotPasswordRoute({ data }) {
	return (
		<AuthShell aside={<SceneAside variant="forgot" />}>
			<ForgotPasswordForm
				redirectTo={data.redirectTo}
				codeSent={data.codeSent}
				captchaSiteKey={data.captchaSiteKey}
			/>
		</AuthShell>
	);
});

import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { AuthShell } from "@features/auth/components/AuthShell.tsx";
import { SceneAside } from "@features/auth/components/SceneAside.tsx";
import VerifyForm from "@features/auth/islands/VerifyForm.island.tsx";
import { readRedirect } from "@features/auth/core/redirect.ts";

/**
 * `/verify` — email confirmation via a 6-digit code (individual digit boxes). Thin controller: it
 * passes the emailed address and captured return path to the VerifyForm island, which handles code
 * entry, resend throttling, and the return-to-origin redirect on success.
 */
export const handler = define.handlers({
	GET(ctx) {
		ctx.state.title = "Verify your email · Projective";
		ctx.state.description = "Confirm your email to finish setting up Projective.";
		return page({
			redirectTo: readRedirect(ctx.url.searchParams),
			email: ctx.url.searchParams.get("email") ?? undefined,
		});
	},
});

export default define.page<typeof handler>(function VerifyRoute({ data }) {
	return (
		<AuthShell aside={<SceneAside variant="verify" />}>
			<VerifyForm redirectTo={data.redirectTo} email={data.email} />
		</AuthShell>
	);
});

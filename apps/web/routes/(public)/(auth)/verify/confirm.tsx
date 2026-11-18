import { define } from "@web/utils/state.ts";
import { AuthShell } from "@features/auth/components/AuthShell.tsx";
import { SceneAside } from "@features/auth/components/SceneAside.tsx";
import ConfirmEmailForm from "@features/auth/islands/ConfirmEmailForm.island.tsx";
import { handler } from "@features/auth/routes/confirm-handler.ts";

/**
 * `/verify/confirm?token_hash=&type=email` — where the confirmation email's button lands
 * (Decision #445). The token is spent only when the person presses Confirm.
 */
export { handler };

export default define.page<typeof handler>(function ConfirmEmailRoute({ data }) {
	return (
		<AuthShell aside={<SceneAside variant="confirm" />}>
			<ConfirmEmailForm tokenHash={data.tokenHash} type={data.type} throttled={data.throttled} />
		</AuthShell>
	);
});

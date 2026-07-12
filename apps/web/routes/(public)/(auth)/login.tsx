import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function LoginPage() {
	return (
		<PagePlaceholder
			title="Log in"
			path="/login"
			note="MVP auth: Google OAuth + Email/Password (SYSTEM_ARCHITECTURE §Authentication)."
		/>
	);
});

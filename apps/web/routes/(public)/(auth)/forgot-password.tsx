import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function ForgotPasswordPage() {
	return <PagePlaceholder title="Forgot password" path="/forgot-password" />;
});

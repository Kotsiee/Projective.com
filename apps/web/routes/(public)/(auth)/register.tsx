import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function RegisterPage() {
	return <PagePlaceholder title="Register" path="/register" />;
});

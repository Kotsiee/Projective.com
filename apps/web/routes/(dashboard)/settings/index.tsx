import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function SettingsPage() {
	return <PagePlaceholder title="Settings" path="/settings" note="Account settings." />;
});

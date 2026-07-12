import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function MessagesPage() {
	return <PagePlaceholder title="Messages" path="/messages" note="All conversations." />;
});

import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function WalletPage() {
	return (
		<PagePlaceholder
			title="Wallet"
			path="/wallet"
			note="Multi-wallet overview: personal · team vault · business · escrow ledger."
		/>
	);
});

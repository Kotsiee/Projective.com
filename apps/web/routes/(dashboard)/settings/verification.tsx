import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { returnNotice } from "@web/features/settings/core/verification-model.ts";
import VerificationConsole from "@web/features/settings/islands/VerificationConsole.island.tsx";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";
import { TaxReportingService } from "@server/services/finance/TaxReportingService.ts";

/**
 * `/settings/verification` — Verification & payouts (root CLAUDE.md §8 Decision #126): the freelancer's
 * Level-2 identity check, the payout account withdrawals go to, the seller's tax documents (LEGAL LG6,
 * Decision #527), and the Level-3 KYB of every client business the person belongs to. The wallet's
 * verification gate links here.
 *
 * Thin controller: resolve the acting user from the SESSION, read the verification picture through the
 * fat service (`finance.my_verification_status`, statuses only) and the tax documents
 * (`finance.list_tax_documents`), and hand both to the island — with the reason when one could not be
 * read, so an outage is never shown as "not verified" or "no documents". The notice a return out of a
 * Stripe-hosted flow carries (`?identity=`, `?payouts=`, `?kyb=`) is resolved here so it paints in the
 * first byte. The guest bounce is the `(dashboard)` middleware's job.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		const [result, taxDocs] = await Promise.all([
			PaymentBackendService.verificationStatus(actor),
			TaxReportingService.listTaxDocuments(actor),
		]);
		ctx.state.title = "Verification & payouts · Settings · Projective";
		return page({
			initial: result.ok && result.data ? result.data : null,
			error: result.ok ? null : result.message ?? "We couldn't read your verification just now.",
			notice: returnNotice(ctx.url.searchParams),
			taxDocuments: taxDocs.ok && taxDocs.data ? taxDocs.data : null,
			taxError: taxDocs.ok ? null : taxDocs.message ?? "We couldn't read your tax documents just now.",
		});
	},
});

export default define.page<typeof handler>(function VerificationSettingsPage({ data }) {
	return (
		<VerificationConsole
			initial={data.initial}
			error={data.error}
			notice={data.notice}
			taxDocuments={data.taxDocuments}
			taxError={data.taxError}
		/>
	);
});

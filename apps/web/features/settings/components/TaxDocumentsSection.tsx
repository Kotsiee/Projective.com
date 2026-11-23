import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Alert } from "@projective/ui/feedback";
import { Button, FileUpload, FormControl, Select } from "@projective/ui/fields";
import type { UploadControls, UploadFile } from "@projective/ui/fields";
import { formatBytes } from "@projective/types/contact";
import type { TaxDocument, TaxDocuments } from "@projective/types/finance";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import { uploadForProject } from "@features/projects/core/upload.ts";
import { AccountService } from "@web/features/shell/core/AccountService.ts";
import { anchorId } from "../core/settings-registry.ts";

/** Where a seller signs in to their Stripe Express dashboard directly (no platform link needed). */
const STRIPE_EXPRESS_LOGIN = "https://connect.stripe.com/express_login";

/** The largest certificate the section takes. */
const MAX_CERTIFICATE_BYTES = 10 * 1024 * 1024;

const ADDED = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Props for {@link TaxDocumentsSection}. */
export interface TaxDocumentsSectionProps {
	/** The route's read; `null` when it could not be made (with `error` saying why). */
	initial: TaxDocuments | null;
	error: string | null;
	/** Whether the seller has a payout account, so Stripe Express has something to show. */
	hasPayoutAccount: boolean;
}

/**
 * TaxDocumentsSection — Settings → Verification & payouts → Tax documents (LEGAL LG6, Decision #527,
 * ruling A: Stripe first). Two things, and nothing Projective files itself:
 *
 * 1. **Stripe's forms** stay in Stripe: any tax form Stripe makes available for the payout account is
 *    in the seller's Stripe Express dashboard, reached at Stripe's own sign-in page (a v2 dashboard link
 *    needs a newer Stripe API version; #527 flag (c)).
 * 2. **A tax residence certificate**: a private upload to the seller's own library
 *    (`uploadForProject`, then `finance.mark_tax_document`), shown to one project's client at a time
 *    (`finance.share_tax_document`), or to nobody.
 *
 * Every change goes through the thin {@link PaymentsService}; the list re-renders from each answer.
 */
export function TaxDocumentsSection(props: TaxDocumentsSectionProps): JSX.Element {
	const docs = useSignal(props.initial?.documents ?? []);
	const failure = useSignal<string | null>(props.error);
	const busy = useSignal<string | null>(null);
	const choice = useSignal<Record<string, string>>({});
	const uploadKey = useSignal(0);
	const targets = props.initial?.targets ?? [];

	const replace = (doc: TaxDocument) => {
		const rest = docs.value.filter((d) => d.fileId !== doc.fileId);
		docs.value = [doc, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	};

	const upload = async (file: UploadFile, controls: UploadControls): Promise<void> => {
		busy.value = "upload";
		failure.value = null;
		controls.setStatus("uploading");
		try {
			const owner = (await AccountService.current())?.userId;
			if (!owner) {
				controls.setStatus("error", "Sign in again to upload a certificate.");
				return;
			}
			const out = await uploadForProject([file.file], { ownerType: "user", ownerId: owner });
			const id = out.assetIds[0];
			if (!id) {
				controls.setStatus("error", out.failures[0]?.message ?? "The file couldn't be uploaded.");
				return;
			}
			const res = await PaymentsService.markTaxDocument(id);
			if (!res.ok || !res.data) {
				controls.setStatus("error", res.message ?? "The certificate couldn't be saved.");
				return;
			}
			replace(res.data);
			controls.setProgress(100);
			controls.setStatus("complete");
			uploadKey.value++;
		} finally {
			busy.value = null;
		}
	};

	const share = async (doc: TaxDocument, projectId: string | null) => {
		busy.value = doc.fileId;
		failure.value = null;
		const res = await PaymentsService.shareTaxDocument(doc.fileId, { projectId });
		busy.value = null;
		if (res.ok && res.data) replace(res.data);
		else failure.value = res.message ?? "That couldn't be changed just now.";
	};

	return (
		<section class="vrf__group" id={anchorId("tax-documents")} aria-labelledby="vrf-tax">
			<h2 id="vrf-tax" class="vrf__h">Tax documents</h2>
			<p class="vrf__sub">For sellers</p>
			<p class="vrf__detail">
				{props.hasPayoutAccount
					? "Any tax form Stripe makes available for your payout account is in your Stripe Express dashboard. Projective doesn't file tax forms for you."
					: "Once you've added a payout account, any tax form Stripe makes available for it is in your Stripe Express dashboard. Projective doesn't file tax forms for you."}
			</p>
			{props.hasPayoutAccount && (
				<p class="vrf__detail">
					<a class="vrf__link" href={STRIPE_EXPRESS_LOGIN} target="_blank" rel="noopener noreferrer">
						Open Stripe Express
					</a>
				</p>
			)}

			<h3 class="vrf__h vrf__h--minor">Tax residence certificate</h3>
			<p class="vrf__detail">
				If a client asks for proof of where you're resident for tax, upload the certificate here. It
				stays private to you until you show it to the client of one of your projects, and you can make
				it private again at any time.
			</p>
			{failure.value && <Alert severity="danger" description={failure.value} class="vrf__banner" />}

			{docs.value.length > 0 && (
				<ul class="vrf__list vrf__list--tight">
					{docs.value.map((doc) => {
						const picked = choice.value[doc.fileId] ?? targets[0]?.projectId ?? "";
						const isBusy = busy.value === doc.fileId;
						return (
							<li key={doc.fileId} class="vrf__row vrf__doc">
								<p class="vrf__doc-name">{doc.name}</p>
								<p class="vrf__meta">
									{formatBytes(doc.sizeBytes)} · Added {ADDED.format(new Date(doc.createdAt))} ·{" "}
									{doc.shared
										? `Shown to ${doc.shared.clientName || "a client"}${
											doc.shared.projectTitle ? ` · ${doc.shared.projectTitle}` : ""
										}`
										: "Private"}
								</p>
								<div class="vrf__actions">
									{targets.length > 0 && (
										<FormControl label="Show it to the client of">
											{({ id }) => (
												<Select
													id={id ?? `vrf-tax-${doc.fileId}`}
													options={targets.map((t) => ({
														label: `${t.projectTitle} · ${t.clientName || "Client"}`,
														value: t.projectId,
													}))}
													value={picked}
													disabled={isBusy}
													onValueChange={(v) => (choice.value = { ...choice.value, [doc.fileId]: v })}
												/>
											)}
										</FormControl>
									)}
									{targets.length > 0 && (
										<Button
											severity="neutral"
											variant="outlined"
											label={doc.shared ? "Show to this client instead" : "Show to this client"}
											loading={isBusy}
											disabled={isBusy || !picked || doc.shared?.projectId === picked}
											onClick={() => void share(doc, picked)}
										/>
									)}
									{doc.shared && (
										<Button
											severity="secondary"
											variant="text"
											label="Make private"
											disabled={isBusy}
											onClick={() => void share(doc, null)}
										/>
									)}
								</div>
							</li>
						);
					})}
				</ul>
			)}
			{targets.length === 0 && docs.value.length > 0 && (
				<p class="vrf__meta">You can show a certificate once you're working on a client's project.</p>
			)}

			<div class="vrf__actions">
				<FileUpload
					key={uploadKey.value}
					mode="basic"
					multiple={false}
					auto
					accept="application/pdf,image/png,image/jpeg"
					maxFileSize={MAX_CERTIFICATE_BYTES}
					chooseLabel={docs.value.length > 0 ? "Upload another certificate" : "Upload a certificate"}
					customUpload={upload}
					disabled={busy.value !== null}
					aria-label="Upload a tax residence certificate"
				/>
			</div>
		</section>
	);
}

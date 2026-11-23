import type { JSX } from "preact";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { MetaLine } from "@projective/ui/display";
import { CLIENT_TRUST_WARN_BELOW } from "@projective/types/reviews";
import {
	acknowledgeClientTrust,
	cancelClientTrust,
	clientTrustAsk,
	clientTrustBusy,
	clientTrustError,
	clientTrustOpen,
} from "../core/client-trust.ts";
import "../styles/reviews.css";

/**
 * ClientTrustDialog — the Informed Consent before a freelancer applies to, or accepts a hire on, a
 * warned client's project (Decision #486 (C); DESIGN_SYSTEM §C.1). It states the client's Client Trust
 * Score and how many freelancer reviews stand behind it, links those reviews, and lets the freelancer go
 * on only by acknowledging it, which the platform records with the project. One filled control; a
 * bottom sheet below `--bp-md`, as every Dialog is. Rendered once by the island that asked
 * (`ensureClientTrustConsent`), which opens its own dialog only after this one closes.
 */
export function ClientTrustDialog(): JSX.Element {
	const ask = clientTrustAsk.value;
	const warning = ask?.warning;
	const score = warning?.score != null ? warning.score.toFixed(2) : "";
	const count = warning?.reviewCount ?? 0;

	return (
		<Dialog
			visible={clientTrustOpen}
			header="Before you go on"
			width="32rem"
			class="ct-dialog"
			onVisibleChange={(open) => {
				if (!open) cancelClientTrust();
			}}
			footer={
				<div class="rv-dialog__actions">
					<Button
						label="Cancel"
						severity="secondary"
						variant="text"
						disabled={clientTrustBusy.value}
						onClick={cancelClientTrust}
					/>
					<Button
						label="Acknowledge and continue"
						loading={clientTrustBusy.value}
						onClick={() => void acknowledgeClientTrust()}
					/>
				</div>
			}
		>
			<div class="rv-dialog__body">
				<p class="ct-dialog__score" aria-label={`Client Trust Score ${score} out of 5`}>
					<span class="ct-dialog__figure">{score}</span>
					<span class="ct-dialog__unit">Client Trust Score</span>
				</p>
				<MetaLine
					items={[
						{
							text: `${count} ${count === 1 ? "review" : "reviews"} from freelancers`,
							tabular: true,
						},
						{ text: `Warned below ${CLIENT_TRUST_WARN_BELOW.toFixed(2)}`, tabular: true },
					]}
				/>
				<p class="rv-dialog__lead">
					Freelancers who worked with this client rated them low. Read what they said before you
					send a proposal or join the project.
				</p>
				{warning?.reviewsHref && (
					<a class="ct-dialog__link" href={warning.reviewsHref} target="_blank" rel="noopener">
						Read this client's reviews
					</a>
				)}
				<p class="rv-dialog__note">
					Continuing records that you saw this score for this project. You are asked once per
					project.
				</p>
				{clientTrustError.value && (
					<Message severity="danger" variant="subtle" size="sm">{clientTrustError.value}</Message>
				)}
			</div>
		</Dialog>
	);
}

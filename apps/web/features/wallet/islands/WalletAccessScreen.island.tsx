import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Avatar } from "@projective/ui/display";
import { Checkbox } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Band, BandHead, EmptyBand, PageHead } from "../components/band-parts.tsx";
import { CapsRoster } from "../components/CapsRoster.tsx";
import { Money } from "../components/Money.tsx";
import { WalletService } from "../core/WalletService.ts";
import { can } from "../core/capability.ts";
import { currentWalletContext, notifyWalletChanged } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type {
	AccessView,
	VaultCapability,
	WalletScope as VaultScope,
} from "../types/wallet-types.ts";

/**
 * WalletAccessScreen — vault governance (`/wallet/access`, team/business).
 *
 * Three bands: who may do what, what is waiting on a second approver, and what has already happened.
 * The audit trail is append-only by design and carries no edit or delete affordance — a money log a
 * participant can rewrite is not a control, and offering the control would imply we allow it.
 *
 * The matrix is a full-bleed table with no max-width: it is read across, and cropping it defeats it.
 * Capability toggles are only rendered for a viewer who holds `manage_members`; everyone else sees
 * the same grid as a read-only record of the arrangement they are part of.
 */
export interface WalletAccessScreenProps {
	initial: AccessView;
	wallet: string;
	display: string;
}

const CAPS: readonly VaultCapability[] = [
	"view",
	"add_funds",
	"spend",
	"distribute",
	"withdraw",
	"manage_members",
	"manage_billing",
];

const CAP_LABEL: Record<VaultCapability, string> = {
	view: "View",
	add_funds: "Add funds",
	spend: "Spend",
	distribute: "Distribute",
	withdraw: "Withdraw",
	manage_members: "Members",
	manage_billing: "Billing",
};

export default function WalletAccessScreen(props: WalletAccessScreenProps): JSX.Element {
	const view = useSignal<AccessView>(props.initial);
	const busy = useSignal<string | null>(null);

	const refetch = async () => {
		const res = await WalletService.access(currentWalletContext());
		if (res.ok && res.data) view.value = res.data.access;
	};
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: refetch });
	useWalletRefresh(refetch);

	const a = view.value;
	const canManage = can(a.viewerCapabilities, "manage_members");
	const canDecide = can(a.viewerCapabilities, "manage_billing") ||
		can(a.viewerCapabilities, "distribute");

	if (a.members.length === 0) {
		return (
			<main class="wlt" aria-label="Access">
				<div class="wlt__stack">
					<Band tone="head" index={0} label="Access">
						<PageHead title="Access" />
					</Band>
					<Band tone="page" index={1} label="Members">
						<EmptyBand
							text="This wallet has no shared members."
							hint="Governance applies to a team vault or a business wallet."
						/>
					</Band>
				</div>
			</main>
		);
	}

	const decide = async (id: string, decision: "approve" | "reject") => {
		busy.value = id;
		const target = currentWalletContext();
		const res = await WalletService.decideSpend({
			scope: (target.wallet?.split(":")[0] ?? "personal") as VaultScope,
			contextId: target.wallet?.split(":")[1] ?? "",
			approvalId: id,
			decision,
		});
		busy.value = null;
		if (res.ok) {
			notifyWalletChanged();
			await refetch();
		}
	};

	return (
		<main class="wlt" aria-label="Access">
			<div class="wlt__stack">
				<Band tone="head" index={0} label="Access">
					<PageHead
						title="Access"
						meta={
							<>
								<span>{a.members.length} members</span>
								{a.approvals.length > 0 && <span>{a.approvals.length} awaiting approval</span>}
							</>
						}
					/>
				</Band>

				<Band tone="intel" index={1} titleId="wlt-acc-matrix">
					<BandHead id="wlt-acc-matrix" title="Capabilities" />
					<div class="wlt-matrix__scroll">
						<table class="wlt-matrix">
							<caption class="ui-visually-hidden">
								Vault capabilities granted to each member
							</caption>
							<thead>
								<tr>
									<th scope="col" class="wlt-matrix__memberhead">Member</th>
									{CAPS.map((c) => (
										<th scope="col" class="wlt-matrix__caphead" key={c}>{CAP_LABEL[c]}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{a.members.map((m) => (
									<tr key={m.userId}>
										<th scope="row" class="wlt-matrix__member">
											<Avatar
												image={m.avatar ?? undefined}
												label={m.name}
												size="sm"
												shape="circle"
											/>
											<span class="wlt-matrix__name">
												{m.handle
													? <a class="wlt-link" href={`/@${m.handle}`}>{m.name}</a>
													: m.name}
											</span>
											<span class="wlt-matrix__role">{m.role}</span>
										</th>
										{CAPS.map((c) => {
											const granted = m.capabilities.includes(c);
											// `view` is implied by membership and is never revocable.
											const editable = canManage && c !== "view";
											return (
												<td class="wlt-matrix__cell" key={c}>
													{editable
														? (
															<Checkbox
																value={granted}
																aria-label={`${CAP_LABEL[c]} for ${m.name}`}
																onValueChange={() => {/* persistence lands with the live path */}}
															/>
														)
														: (
															<Tooltip
																content={`${granted ? "Granted" : "Not granted"}: ${CAP_LABEL[c]}`}
																placement="top"
															>
																<span
																	class="wlt-matrix__mark"
																	data-on={granted ? "true" : "false"}
																	aria-label={granted ? "Granted" : "Not granted"}
																	role="img"
																>
																	{granted ? "●" : "–"}
																</span>
															</Tooltip>
														)}
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Band>

				{a.caps.length > 0 && (
					<Band tone="flow" index={2} titleId="wlt-acc-caps">
						<BandHead id="wlt-acc-caps" title="Spending caps" />
						<CapsRoster caps={a.caps} invoicesDue={0} invoicesDueAmount={null} />
					</Band>
				)}

				<Band tone="intel" index={3} titleId="wlt-acc-appr">
					<BandHead id="wlt-acc-appr" title="Awaiting approval" />
					{a.approvals.length === 0
						? <EmptyBand text="Nothing awaiting approval." />
						: (
							<ul class="wlt-rows wlt-rows--ledger" role="list">
								{a.approvals.map((ap) => (
									<li class="wlt-rows__row" key={ap.id}>
										<span class="wlt-rows__title">
											{ap.requesterHandle
												? (
													<a class="wlt-link" href={`/@${ap.requesterHandle}`}>
														{ap.requesterName}
													</a>
												)
												: ap.requesterName}
										</span>
										<span class="wlt-rows__meta">{ap.reason}</span>
										<span class="wlt-rows__amount">
											<Money value={ap.amount} size="body" showFx={false} />
										</span>
										<span class="wlt-rows__meta">{ap.dateLabel}</span>
										{canDecide && ap.status === "pending" && (
											<span class="wlt-rows__actions">
												<button
													type="button"
													class="wlt-btn wlt-btn--ghost"
													disabled={busy.value === ap.id}
													onClick={() => void decide(ap.id, "reject")}
												>
													Decline
												</button>
												<button
													type="button"
													class="wlt-btn wlt-btn--primary"
													disabled={busy.value === ap.id}
													onClick={() => void decide(ap.id, "approve")}
												>
													Approve {ap.amount.display}
												</button>
											</span>
										)}
									</li>
								))}
							</ul>
						)}
				</Band>

				<Band tone="ledger" index={4} titleId="wlt-acc-audit">
					<BandHead
						id="wlt-acc-audit"
						title="Audit trail"
						meta={<span class="wlt-rows__tag" data-tone="muted">Append-only</span>}
					/>
					{a.audit.length === 0
						? <EmptyBand text="No vault activity recorded yet." />
						: (
							<ul class="wlt-rows wlt-rows--ledger" role="list">
								{a.audit.map((r) => (
									<li class="wlt-rows__row" key={r.id}>
										<span class="wlt-rows__title">{r.label}</span>
										<span class="wlt-rows__meta">{r.action.replace(/_/g, " ")}</span>
										<span class="wlt-rows__amount">
											<Money value={r.amount} size="body" tone="muted" showFx={false} />
										</span>
										<span class="wlt-rows__meta">{r.dateLabel}</span>
									</li>
								))}
							</ul>
						)}
				</Band>
			</div>
		</main>
	);
}

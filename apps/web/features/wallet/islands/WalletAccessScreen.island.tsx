import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Meter, Money, SectionCard } from "../components/wallet-bits.tsx";
import { WalletService } from "../core/WalletService.ts";
import { currentWalletContext, notifyWalletChanged } from "../core/wallet-state.ts";
import { useWalletRefresh, useWalletSeam } from "../core/wallet-seam.ts";
import type {
	AccessView,
	SpendApprovalView,
	VaultCapability,
	VaultMember,
} from "../types/wallet-types.ts";

/**
 * WalletAccessScreen — `/wallet/access` (team/business): the capability matrix (members × the seven vault
 * capabilities), spending caps, the pending-approvals queue, and the money audit log. Every
 * capability-gated control is hidden/disabled per the viewer's grants (`viewerCapabilities`) — the server
 * re-checks under RLS. Matrix edits + approvals are optimistic stubs until the live path lands. THIN: SSR
 * + refetch on dev axis / mutation. The matrix scrolls horizontally inside its own container.
 */
export interface WalletAccessScreenProps {
	initial: AccessView;
	wallet: string;
	display: string;
}

const CAPS: VaultCapability[] = [
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
	async function reload(): Promise<void> {
		const res = await WalletService.access(currentWalletContext());
		if (res.ok && res.data) view.value = res.data.access;
	}
	useWalletSeam({ display: props.display, wallet: props.wallet, onRefetch: reload });
	useWalletRefresh(reload);

	const a = view.value;
	const canManage = a.viewerCapabilities.includes("manage_members");
	const canApprove = a.viewerCapabilities.includes("manage_billing") ||
		a.viewerCapabilities.includes("distribute");
	const empty = a.members.length === 0;

	async function decide(id: string, decision: "approve" | "reject"): Promise<void> {
		const ctx = currentWalletContext();
		const [scope, contextId] = (ctx.wallet ?? "personal").includes(":")
			? (ctx.wallet ?? "personal").split(":")
			: ["personal", ""];
		const res = await WalletService.decideSpend({
			scope: scope as never,
			contextId,
			approvalId: id,
			decision,
			display: ctx.display ?? undefined,
		});
		if (res.ok) {
			notifyWalletChanged();
			void reload();
		}
	}

	if (empty) {
		return (
			<div class="wallet-page wallet-access">
				<header class="wallet-page__head">
					<h1 class="wallet-page__title">Access</h1>
				</header>
				<p class="wallet-empty-note" role="status">
					Vault access controls are available on team and business wallets.
				</p>
			</div>
		);
	}

	return (
		<div class="wallet-page wallet-access">
			<header class="wallet-page__head">
				<h1 class="wallet-page__title">Access</h1>
				{canManage && <span class="wallet-badge" data-tone="info">You manage this vault</span>}
			</header>

			<SectionCard title="Capability matrix">
				<div class="wallet-matrix__scroll">
					<table class="wallet-matrix" aria-label="Vault capability matrix">
						<thead>
							<tr>
								<th class="wallet-matrix__memberhead" scope="col">Member</th>
								{CAPS.map((c) => (
									<th key={c} class="wallet-matrix__caphead" scope="col">
										<span>{CAP_LABEL[c]}</span>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{a.members.map((m) => <MatrixRow key={m.userId} member={m} canManage={canManage} />)}
						</tbody>
					</table>
				</div>
			</SectionCard>

			{a.approvals.length > 0 && (
				<SectionCard title={`Approvals · ${a.approvals.length}`} class="wallet-access__approvals">
					<ul class="wallet-approvals">
						{a.approvals.map((ap) => (
							<ApprovalRow key={ap.id} approval={ap} canApprove={canApprove} onDecide={decide} />
						))}
					</ul>
				</SectionCard>
			)}

			{a.caps.length > 0 && (
				<SectionCard title="Spending caps" class="wallet-access__caps">
					<ul class="wallet-caps__list">
						{a.caps.map((c) => (
							<li key={c.id} class="wallet-caps__row">
								<span class="wallet-caps__name">{c.memberName}</span>
								<Meter
									ratioBp={c.utilizationBp}
									label={`${c.memberName} cap`}
									class="wallet-caps__meter"
								/>
								<span class="wallet-caps__amt">
									<Money value={c.spent} />{" "}
									<span class="wallet-caps__of">
										/ <Money value={c.cap} muted />
									</span>
								</span>
							</li>
						))}
					</ul>
				</SectionCard>
			)}

			<SectionCard title="Audit log" class="wallet-access__audit">
				<ul class="wallet-audit">
					{a.audit.map((row) => (
						<li key={row.id} class="wallet-audit__row">
							<span class="wallet-audit__action" data-action={row.action}>
								{row.action.replace("_", " ")}
							</span>
							<span class="wallet-audit__label">{row.label}</span>
							<Money value={row.amount} class="wallet-audit__amt" />
							<span class="wallet-audit__date">{row.dateLabel}</span>
						</li>
					))}
				</ul>
			</SectionCard>
		</div>
	);
}

function MatrixRow(
	{ member, canManage }: { member: VaultMember; canManage: boolean },
): JSX.Element {
	// Optimistic local grants (stub — the live path persists via a manage-members mutation).
	const grants = useSignal<Set<VaultCapability>>(new Set(member.capabilities));
	function toggle(cap: VaultCapability): void {
		if (!canManage || cap === "view") return;
		const next = new Set(grants.value);
		if (next.has(cap)) next.delete(cap);
		else next.add(cap);
		grants.value = next;
	}
	return (
		<tr class="wallet-matrix__row">
			<th class="wallet-matrix__member" scope="row">
				<Avatar image={member.avatar ?? undefined} label={member.name} size={24} alt="" />
				<span class="wallet-matrix__name">{member.name}</span>
				<span class="wallet-matrix__role" data-role={member.role}>{member.role}</span>
			</th>
			{CAPS.map((cap) => {
				const has = grants.value.has(cap);
				return (
					<td key={cap} class="wallet-matrix__cell">
						{canManage && cap !== "view"
							? (
								<button
									type="button"
									class="wallet-matrix__toggle"
									data-on={has ? "true" : undefined}
									aria-pressed={has}
									aria-label={`${CAP_LABEL[cap]} for ${member.name}`}
									onClick={() => toggle(cap)}
								>
									{has ? "✓" : ""}
								</button>
							)
							: (
								<span
									class="wallet-matrix__mark"
									data-on={has ? "true" : undefined}
									aria-label={has ? "granted" : "not granted"}
								>
									{has ? "✓" : "—"}
								</span>
							)}
					</td>
				);
			})}
		</tr>
	);
}

function ApprovalRow(
	{ approval, canApprove, onDecide }: {
		approval: SpendApprovalView;
		canApprove: boolean;
		onDecide: (id: string, decision: "approve" | "reject") => void;
	},
): JSX.Element {
	return (
		<li class="wallet-approvals__row">
			<span class="wallet-approvals__meta">
				<span class="wallet-approvals__reason">{approval.reason}</span>
				<span class="wallet-approvals__who">
					{approval.requesterHandle
						? <a href={`/@${approval.requesterHandle}`}>{approval.requesterName}</a>
						: approval.requesterName} · {approval.dateLabel}
				</span>
			</span>
			<Money value={approval.amount} class="wallet-approvals__amt" />
			{canApprove
				? (
					<span class="wallet-approvals__actions">
						<button
							type="button"
							class="wallet-btn wallet-btn--ghost"
							onClick={() => onDecide(approval.id, "reject")}
						>
							Reject
						</button>
						<button
							type="button"
							class="wallet-btn wallet-btn--primary"
							onClick={() => onDecide(approval.id, "approve")}
						>
							Approve
						</button>
					</span>
				)
				: (
					<Tooltip content="You don't have approval rights on this vault" placement="top">
						<span class="wallet-badge" data-tone="muted">Pending</span>
					</Tooltip>
				)}
		</li>
	);
}

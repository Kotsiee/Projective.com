import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Money, SectionCard } from "./wallet-bits.tsx";
import type { TeamExtras } from "../types/wallet-types.ts";

/**
 * TeamSplitCard — the team-vault Overview's variant block: the active split ruleset (Co-op / Finder's
 * Fee / Benevolent Dictator) visualising how the NEXT payout divides — 5% platform fee → the Team Vault
 * cut → the template's member shares — plus the member roster with each member's stake. The division is
 * computed server-side (finance-model.md §5); the card only renders the resulting {@link MoneyView}s.
 * Member names link to the canonical `/@handle` (Decision #3).
 */
export interface TeamSplitCardProps {
	data: TeamExtras;
}

/** Canonical profile href for a member handle (`/@handle`, Decision #3). */
function profileHref(handle: string | null): string | undefined {
	return handle ? `/@${handle.replace(/^@/, "")}` : undefined;
}

export function TeamSplitCard({ data }: TeamSplitCardProps): JSX.Element {
	const { splitRule, members } = data;
	return (
		<div class="wallet-extras">
			<SectionCard
				title="Payout split"
				class="wallet-split"
				action={<span class="wallet-badge" data-tone="info">{splitRule.label}</span>}
			>
				{splitRule.previewGross && (
					<div class="wallet-split__preview" aria-label="Next payout preview">
						<div class="wallet-split__waterfall">
							<span class="wallet-split__step">
								<span class="wallet-split__step-label">Gross</span>
								<Money value={splitRule.previewGross} />
							</span>
							{splitRule.previewFee && (
								<span class="wallet-split__step" data-neg>
									<span class="wallet-split__step-label">Platform fee 5%</span>
									<Money value={splitRule.previewFee} muted />
								</span>
							)}
							{splitRule.previewVault && (
								<span class="wallet-split__step">
									<span class="wallet-split__step-label">
										Team Vault {(splitRule.vaultBp / 100).toFixed(0)}%
									</span>
									<Money value={splitRule.previewVault} muted />
								</span>
							)}
						</div>
						{splitRule.previewShares.length > 0 && (
							<ul class="wallet-split__shares">
								{splitRule.previewShares.map((s) => (
									<li key={s.handle ?? s.name} class="wallet-split__share">
										<span class="wallet-split__share-name">{s.name}</span>
										<span class="wallet-split__share-bp">{(s.shareBp / 100).toFixed(0)}%</span>
										<Money value={s.amount} class="wallet-split__share-amt" />
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</SectionCard>

			<SectionCard title={`Members · ${members.length}`} class="wallet-roster">
				<ul class="wallet-roster__list">
					{members.map((m) => (
						<li key={m.handle ?? m.userId} class="wallet-roster__row">
							<a class="wallet-roster__who" href={profileHref(m.handle)}>
								<Avatar image={m.avatar ?? undefined} label={m.name} size={28} alt="" />
								<span class="wallet-roster__name">{m.name}</span>
							</a>
							<Tooltip content={`Vault role: ${m.role}`} placement="top">
								<span class="wallet-roster__role" data-role={m.role}>{m.role}</span>
							</Tooltip>
							{m.stakeBp > 0 && (
								<span class="wallet-roster__stake">{(m.stakeBp / 100).toFixed(0)}%</span>
							)}
						</li>
					))}
				</ul>
			</SectionCard>
		</div>
	);
}

import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { styleVars } from "@ui/core/style.ts";
import { Money } from "./Money.tsx";
import type { MoneyView, TeamExtras } from "../types/wallet-types.ts";

/**
 * MemberStakes — who holds what share of this vault, in basis points.
 *
 * Basis points rather than a rounded percentage because a stake is a contractual quantity: 33.33%
 * and 33.34% are different agreements, and a display that rounds them together hides the difference
 * that matters. The micro-bar is a secondary channel only; the number is authoritative.
 */
export interface MemberStakesProps {
	members: TeamExtras["members"];
	vaultBalance: MoneyView;
}

export function MemberStakes(props: MemberStakesProps): JSX.Element {
	const max = props.members.reduce((m, x) => Math.max(m, x.stakeBp), 0);

	return (
		<section class="wlt-stakes" aria-labelledby="wlt-stakes-title">
			<header class="wlt-stakes__head">
				<h3 class="wlt-stakes__title wlt-label" id="wlt-stakes-title">
					Members · {props.members.length}
				</h3>
				<span class="wlt-stakes__vault">
					<span class="wlt-stakes__vault-label">Vault</span>
					<Money value={props.vaultBalance} size="figure" showFx={false} />
				</span>
			</header>

			<ul class="wlt-stakes__list" role="list">
				{props.members.map((m) => (
					<li class="wlt-stakes__row" key={m.userId}>
						<span class="wlt-stakes__who">
							<Avatar image={m.avatar ?? undefined} label={m.name} size="sm" shape="circle" />
							<span class="wlt-stakes__name">
								{m.handle ? <a class="wlt-link" href={`/@${m.handle}`}>{m.name}</a> : m.name}
							</span>
							<span class="wlt-stakes__role">{m.role}</span>
						</span>
						<span class="wlt-stakes__bp wlt-num">
							{m.stakeBp > 0 ? `${(m.stakeBp / 100).toFixed(2)}%` : "—"}
						</span>
						<span
							class="wlt-stakes__bar"
							style={styleVars({ "--wlt-fill": max > 0 ? `${(m.stakeBp / max) * 100}%` : "0%" })}
							aria-hidden="true"
						>
							<span class="wlt-stakes__fill" />
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

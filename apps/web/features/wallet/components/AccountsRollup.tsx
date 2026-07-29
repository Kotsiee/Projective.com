import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { styleVars } from "@ui/core/style.ts";
import { Money } from "./Money.tsx";
import type { MoneyView, WalletRef } from "../types/wallet-types.ts";

/**
 * AccountsRollup — the read-only "All accounts" band.
 *
 * The aggregate has no variant extras to show, because a split rule or a budget belongs to one
 * vault. What it can answer is "where does this total actually sit", so each row is an account,
 * its share of the rollup, and a link that SWITCHES to it.
 *
 * There is no mutating affordance anywhere in this component: money is moved from the wallet that
 * holds it, never from a summary of several.
 */
export interface AccountsRollupProps {
	accounts: WalletRef[];
	total: MoneyView;
	display: string;
}

export function AccountsRollup(props: AccountsRollupProps): JSX.Element {
	const total = props.total.minor;

	return (
		<ul class="wlt-accounts" role="list">
			{props.accounts.map((a) => {
				const share = total > 0 ? (a.available.minor / total) * 100 : 0;
				const param = a.scope === "personal" ? "personal" : `${a.scope}:${a.id}`;
				const href = `/wallet?w=${encodeURIComponent(param)}&display=${props.display}`;
				return (
					<li class="wlt-accounts__row" key={`${a.scope}:${a.id}`}>
						<a class="wlt-accounts__link" href={href}>
							<span class="wlt-accounts__who">
								<Avatar image={a.avatar ?? undefined} label={a.name} size="sm" shape="circle" />
								<span class="wlt-accounts__name">{a.name}</span>
								{a.role && <span class="wlt-accounts__role">{a.role}</span>}
							</span>
							<span class="wlt-accounts__available">
								<Money value={a.available} size="body" showFx={false} />
							</span>
							<span class="wlt-accounts__share wlt-num">{share.toFixed(1)}%</span>
							<span
								class="wlt-accounts__bar"
								style={styleVars({ "--wlt-fill": `${share}%` })}
								aria-hidden="true"
							>
								<span class="wlt-accounts__fill" />
							</span>
						</a>
					</li>
				);
			})}
		</ul>
	);
}

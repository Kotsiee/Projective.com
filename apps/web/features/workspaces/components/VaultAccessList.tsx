import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { Link } from "@projective/ui/navigation";
import type { VaultAccess } from "@projective/types/workspace";
import { vaultAccessItems } from "../core/payout-model.ts";

/**
 * VaultAccessList — the Payouts module's "Who can move money": each active member and their Team Vault
 * capabilities (view · distribute · withdraw …), read-only.
 *
 * The rows are `org.fn_vault_capabilities_for`'s projection from the workspace capabilities — the set
 * `finance.vault_permissions` holds and every money door enforces (TEAMS_AUDIT §4.4) — so what a
 * reader sees here is what the vault will let each member do. Capabilities are changed where they come
 * from, the roles and overrides, so the one action is a text link to Roles (tier 5), offered only to a
 * reader who may open it.
 */

// #region Props
export interface VaultAccessListProps {
	rows: readonly VaultAccess[];
	/** The Roles module's address, or `null` when the reader may not open it. */
	rolesHref: string | null;
}
// #endregion

// #region Component
export function VaultAccessList(props: VaultAccessListProps): JSX.Element {
	return (
		<section class="wsp-payout__section" aria-labelledby="wsp-payout-access">
			<div class="wsp-payout__head">
				<h2 class="wsp-band__title" id="wsp-payout-access">Who can move money</h2>
				<p class="wsp-payout__meta">
					Each member's access to the Team Vault, from their role and overrides.
				</p>
			</div>

			{props.rows.length === 0
				? <p class="wsp-payout__meta">Vault access couldn't be read just now.</p>
				: (
					<ul class="wsp-access">
						{props.rows.map((row) => (
							<li class="wsp-access__row" key={row.memberId}>
								<span class="wsp-access__name">{row.name}</span>
								<MetaLine as="span" items={vaultAccessItems(row)} />
							</li>
						))}
					</ul>
				)}

			{props.rolesHref && (
				<Link class="wsp-payout__link" href={props.rolesHref}>
					Edit in Roles
				</Link>
			)}
		</section>
	);
}
// #endregion

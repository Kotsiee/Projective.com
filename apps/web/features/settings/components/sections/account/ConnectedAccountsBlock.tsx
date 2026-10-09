import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import {
	type ConnectedAccounts,
	type ConnectedIdentity,
	LINKABLE_PROVIDERS,
	type SignInProvider,
	SignInProvider as ProviderEnum,
} from "@projective/types/auth";
import { IDLE, type SaveState, SaveStatus, SettingsBlock } from "../../SettingsParts.tsx";
import { SettingsService } from "../../../core/SettingsService.ts";
import { PROVIDER_LABEL, ProviderGlyph } from "./provider-glyphs.tsx";

/** Props for {@link ConnectedAccountsBlock}. */
export interface ConnectedAccountsBlockProps {
	connected: ConnectedAccounts | null;
}

/** Read and strip the `?connect=` outcome a provider round-trip lands back with. */
function takeConnectOutcome(): SaveState | null {
	if (typeof location === "undefined") return null;
	const url = new URL(location.href);
	const value = url.searchParams.get("connect");
	if (!value) return null;
	url.searchParams.delete("connect");
	const state = history.state && typeof history.state === "object" ? history.state : {};
	history.replaceState(
		{ ...state, fClientNav: false },
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
	const provider = ProviderEnum.safeParse(value);
	if (provider.success) {
		return {
			tone: "saved",
			text: `${PROVIDER_LABEL[provider.data]} is connected. You can sign in with it now.`,
		};
	}
	return {
		tone: "error",
		text:
			"That account couldn't be connected. It may already belong to another Projective account.",
	};
}

/**
 * Connected accounts — the providers a person can sign in with. Each row is connected (with its
 * address and a Disconnect), offered (Connect, which leaves for the provider and comes back here), or
 * not available in this environment (said plainly, never a dead button). The last way to sign in can
 * never be disconnected — the row says why — and the email sign-in is managed above, not here.
 */
export function ConnectedAccountsBlock(props: ConnectedAccountsBlockProps): JSX.Element {
	const accounts = useSignal<ConnectedAccounts | null>(props.connected);
	const busy = useSignal<string | null>(null);
	const confirming = useSignal<string | null>(null);
	const status = useSignal<SaveState>(IDLE);

	useEffect(() => {
		const outcome = takeConnectOutcome();
		if (outcome) status.value = outcome;
	}, []);

	async function disconnect(identity: ConnectedIdentity): Promise<void> {
		busy.value = identity.id;
		status.value = { tone: "busy", text: "Disconnecting…" };
		const res = await SettingsService.disconnectIdentity(identity.id);
		busy.value = null;
		confirming.value = null;
		if (!res.ok) {
			status.value = { tone: "error", text: res.message };
			return;
		}
		accounts.value = {
			identities: res.data.identities,
			available: res.data.available,
			canDisconnect: res.data.canDisconnect,
		};
		status.value = { tone: "saved", text: `${PROVIDER_LABEL[identity.provider]} is disconnected.` };
	}

	const list = accounts.value;
	const byProvider = new Map<SignInProvider, ConnectedIdentity>(
		(list?.identities ?? []).map((identity) => [identity.provider, identity]),
	);
	const emailIdentity = byProvider.get("email");

	return (
		<SettingsBlock
			anchor="connected-accounts"
			title="Connected accounts"
			description="Sign in with another account as well as, or instead of, your email and password."
		>
			{list === null
				? <InlineNotice align="start" text="Your sign-in methods couldn't be loaded just now." />
				: (
					<ul class="stg-providers" aria-label="Sign-in providers">
						{emailIdentity
							? (
								<li class="stg-provider">
									<ProviderGlyph provider="email" />
									<div class="stg-provider__text">
										<span class="stg-provider__name">{PROVIDER_LABEL.email}</span>
										<span class="stg-provider__meta">
											{emailIdentity.email ?? "Your sign-in address"} · managed above
										</span>
									</div>
								</li>
							)
							: null}
						{LINKABLE_PROVIDERS.map((provider) => {
							const identity = byProvider.get(provider);
							const offered = list.available.includes(provider);
							const name = PROVIDER_LABEL[provider];
							return (
								<li
									key={provider}
									class="stg-provider"
									data-state={identity ? "on" : offered ? "off" : "na"}
								>
									<ProviderGlyph provider={provider} />
									<div class="stg-provider__text">
										<span class="stg-provider__name">{name}</span>
										<span class="stg-provider__meta">
											{identity
												? `Connected${identity.email ? ` · ${identity.email}` : ""}`
												: offered
												? "Not connected"
												: "Not available yet"}
										</span>
									</div>
									<div class="stg-provider__actions">
										{identity
											? confirming.value === identity.id
												? (
													<div
														class="stg-emails__confirm"
														role="group"
														aria-label={`Disconnect ${name}?`}
													>
														<span class="stg-emails__ask">Disconnect {name}?</span>
														<Button
															size="sm"
															severity="danger"
															label="Disconnect"
															loading={busy.value === identity.id}
															onClick={() => disconnect(identity)}
														/>
														<Button
															size="sm"
															variant="text"
															severity="secondary"
															label="Keep"
															onClick={() => (confirming.value = null)}
														/>
													</div>
												)
												: list.canDisconnect
												? (
													<Button
														size="sm"
														variant="text"
														severity="danger"
														label="Disconnect"
														aria-label={`Disconnect ${name}`}
														onClick={() => (confirming.value = identity.id)}
													/>
												)
												: <span class="stg-provider__lock">Your only way to sign in</span>
											: offered
											? (
												<a
													class="ui-button ui-button--primary ui-button--outlined ui-button--size-sm"
													href={SettingsService.connectIdentityHref(provider)}
												>
													<span class="ui-button__label">Connect</span>
													<span class="ui-visually-hidden">{name}</span>
												</a>
											)
											: null}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			<SaveStatus state={status.value} />
		</SettingsBlock>
	);
}

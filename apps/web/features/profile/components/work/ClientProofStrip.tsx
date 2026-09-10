import type { JSX } from "preact";
import { profileHref } from "@features/explore/core/routing.ts";
import type { NotableClient } from "../../types/profile-types.ts";

/**
 * ClientProofStrip — the "worked with" logo row that leads the Work section. A single horizontal
 * rail of grayscale marks (§B.11: a client is a fact about the profile, never a chip), unboxed, that
 * scrolls sideways when the rail overflows. A client that is itself a Projective entity links to its
 * `/@handle`; a client with no logo falls back to its name in the meta register rather than a broken
 * image. Renders nothing for an empty list, so the section stack never carries an empty rail.
 */
export function ClientProofStrip(
	{ clients }: { clients: readonly NotableClient[] },
): JSX.Element | null {
	if (!clients.length) return null;
	return (
		<ul class="pf-proof" role="list" aria-label="Clients worked with">
			{clients.map((client, i) => (
				<li class="pf-proof__item" key={`${i}:${client.handle ?? client.name}`}>
					{client.handle
						? (
							<a class="pf-proof__link" href={profileHref(client.handle)}>
								<ClientMark client={client} />
							</a>
						)
						: <ClientMark client={client} />}
				</li>
			))}
		</ul>
	);
}

function ClientMark({ client }: { client: NotableClient }): JSX.Element {
	if (!client.logo) return <span class="pf-proof__name">{client.name}</span>;
	return (
		<img
			class="pf-proof__logo"
			src={client.logo}
			alt={client.name}
			loading="lazy"
			decoding="async"
		/>
	);
}

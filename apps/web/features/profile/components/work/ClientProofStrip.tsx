import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { profileHref } from "@features/explore/core/routing.ts";
import type { NotableClient } from "../../types/profile-types.ts";

/**
 * ClientProofStrip — the "worked with" row that leads the Work section. A single horizontal rail,
 * unboxed, that scrolls sideways when it overflows. Each client is its MARK and its NAME together:
 * the brandmark alone asks the reader to recognise a logo they may never have seen, and the name
 * alone throws away the one thing a logo is good for. A client that is itself a Projective entity
 * links to its `/@handle`; a client with no logo renders its name alone rather than a broken image.
 *
 * A platform-VERIFIED working relationship carries the trust crest after the name — an earned
 * signal (§B.11.3), spoken as its own image and explained by a portal `Tooltip`, never a chip.
 * Renders nothing for an empty list, so the section stack never carries an empty rail.
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
						: (
							<span class="pf-proof__mark">
								<ClientMark client={client} />
							</span>
						)}
				</li>
			))}
		</ul>
	);
}

function ClientMark({ client }: { client: NotableClient }): JSX.Element {
	return (
		<>
			{client.logo && (
				<img
					class="pf-proof__logo"
					src={client.logo}
					alt=""
					loading="lazy"
					decoding="async"
				/>
			)}
			<span class="pf-proof__name">{client.name}</span>
			{client.verified && (
				<Tooltip content="Verified client" placement="top">
					<span class="pf-proof__crest" role="img" aria-label="Verified client">
						<Icon name="verified" filled size="xs" />
					</span>
				</Tooltip>
			)}
		</>
	);
}

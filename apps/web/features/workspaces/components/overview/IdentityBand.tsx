import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { kindCopy, type WorkspaceDetail } from "@projective/types/workspace";
import { EntityMark } from "../EntityMark.tsx";

/** Props for {@link IdentityBand}. */
export interface IdentityBandProps {
	workspace: WorkspaceDetail;
	/** The band's place in the entrance stagger. */
	i: number;
}

/**
 * The Overview's identity band: the banner, the entity mark, the name, the handle (which resolves to
 * the canonical public profile, never a console page), the tagline, the earned Standing line, and the
 * acting chip while the session acts as this entity.
 */
export function IdentityBand({ workspace: ws, i }: IdentityBandProps): JSX.Element {
	const copy = kindCopy(ws.kind);
	return (
		<section class="wsp-band wsp-band--head" data-i={i} aria-label={`${ws.name} header`}>
			<div class="wsp-band__inner">
				<div class="wsp-idhead">
					{ws.banner && (
						<div class="wsp-idhead__banner">
							<img
								class="wsp-idhead__banner-img"
								src={ws.banner}
								alt=""
								loading="lazy"
								decoding="async"
							/>
						</div>
					)}
					<div class="wsp-idhead__row">
						<EntityMark
							class="wsp-idhead__mark"
							kind={ws.kind}
							name={ws.name}
							handle={ws.handle}
							image={ws.avatar}
							size="lg"
						/>
						<div class="wsp-idhead__ident">
							<h1 class="wsp-idhead__name">{ws.name}</h1>
							<a class="wsp-idhead__handle" href={`/@${ws.handle}`}>@{ws.handle}</a>
							{ws.tagline && <p class="wsp-idhead__tagline">{ws.tagline}</p>}
							<MetaLine
								items={[
									ws.standing
										? {
											text: `${ws.standing} standing`,
											title: "Earned standing — it cannot be bought",
										}
										: null,
								]}
							/>
						</div>
						<div class="wsp-idhead__badges">
							{ws.isActing && (
								<Tooltip
									content={`Everything you do right now is on behalf of ${ws.name}`}
									placement="bottom"
								>
									<span class="wsp-actingchip">
										<span class="wsp-actingchip__dot" aria-hidden="true" />
										Acting as this {copy.noun}
									</span>
								</Tooltip>
							)}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

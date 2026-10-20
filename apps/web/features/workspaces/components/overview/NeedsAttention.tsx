import type { JSX, VNode } from "preact";
import { MetaLine } from "@projective/ui/display";
import type { AttentionItem, AttentionKind } from "../../core/overview-deck.ts";
import {
	ApproveGlyph,
	cloneGlyph,
	InvitationsGlyph,
	ProjectsGlyph,
} from "../../core/workspace-glyphs.tsx";

/** Props for {@link NeedsAttention}. */
export interface NeedsAttentionProps {
	items: readonly AttentionItem[];
}

const KIND_GLYPH: Readonly<Record<AttentionKind, VNode>> = {
	approvals: ApproveGlyph,
	invites: InvitationsGlyph,
	on_hold: ProjectsGlyph,
	milestone: ProjectsGlyph,
};

/**
 * NeedsAttention — what is waiting on somebody here, as a plain list of links: each row opens the
 * module (or project) where it is dealt with, its facts and that module's name as one MetaLine. A
 * keyboard reader tabs through the links in order; there is no board, no drag and no second control.
 */
export function NeedsAttention(props: NeedsAttentionProps): JSX.Element {
	if (props.items.length === 0) {
		return <MetaLine class="wsp-attn__empty" items={["Nothing needs attention right now."]} />;
	}
	return (
		<ul class="wsp-attn">
			{props.items.map((item) => (
				<li key={item.key} class="wsp-attn__item">
					<a class="wsp-attn__row" href={item.href} data-kind={item.kind}>
						<span class="wsp-attn__mark" aria-hidden="true">
							{cloneGlyph(KIND_GLYPH[item.kind])}
						</span>
						<span class="wsp-attn__body">
							<span class="wsp-attn__text">{item.text}</span>
							<MetaLine
								as="span"
								size="xs"
								items={[...item.meta, item.module].map((text) => ({ text, tabular: true }))}
							/>
						</span>
					</a>
				</li>
			))}
		</ul>
	);
}

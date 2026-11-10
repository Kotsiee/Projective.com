import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";

/**
 * OwnerEditLink — the owner's way from one block of their Preview (`/[handle]`) to the part of the
 * editor that changes it: an icon-only pencil, a tier-4 utility (`neutral` `outlined`, §B.8.1), and a
 * link, because it goes somewhere and mutates nothing. Inside a `.pf-ownerblock` it rests hidden on a
 * pointer that hovers and shows while the block is hovered or holds focus; on touch it always shows.
 * Rendered for the owner alone (`core/owner-edit.ts`), so a visitor's page carries none of it.
 */
export interface OwnerEditLinkProps {
	href: string;
	/** What it edits, as the link reads after "Edit" — e.g. `your skills`. */
	label: string;
}

export function OwnerEditLink({ href, label }: OwnerEditLinkProps): JSX.Element {
	const name = `Edit ${label}`;
	return (
		<Tooltip content={name} density="compact">
			<a
				class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm ui-button--icon-only ui-hit pf-owneredit"
				href={href}
				aria-label={name}
			>
				<span class="ui-button__icon" aria-hidden="true">
					<Icon name="edit" size="sm" />
				</span>
			</a>
		</Tooltip>
	);
}

/** A block's `.pf-h` heading, with the owner's edit link at its end when `href` is given. */
export interface OwnedHeadingProps {
	title: string;
	href: string | null;
	label: string;
}

/** The heading a visitor reads unchanged; the owner's gains its {@link OwnerEditLink}. */
export function OwnedHeading({ title, href, label }: OwnedHeadingProps): JSX.Element {
	if (!href) return <h2 class="pf-h">{title}</h2>;
	return (
		<div class="pf-ownerhead">
			<h2 class="pf-h">{title}</h2>
			<OwnerEditLink href={href} label={label} />
		</div>
	);
}

/** An empty block on the owner's Preview: its heading, what is missing, and the edit link. */
export interface OwnerStubProps {
	title: string;
	/** One line, e.g. "Visitors see none until you add some." */
	note: string;
	href: string;
	label: string;
	class?: string;
}

/**
 * OwnerStub — a block the visitor's page leaves out because it is empty, drawn for the owner so the
 * way to fill it is where it would stand. Its link is always shown: it is all the block holds.
 */
export function OwnerStub({ title, note, href, label, class: extra }: OwnerStubProps): JSX.Element {
	return (
		<div class={extra ? `pf-ownerstub ${extra}` : "pf-ownerstub"}>
			<OwnedHeading title={title} href={href} label={label} />
			<p class="pf-ownerstub__note">{note}</p>
		</div>
	);
}

import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import {
	SCREEN_SHARE_HIDDEN_LABEL,
	SCREEN_SHARE_MASK,
	useScreenShareActive,
} from "./screen-share.ts";

/** The four screen sharing treatments (DESIGN_SYSTEM.md §B.14), by how much harm a leak would do. */
export type ObscureTier = "mask" | "solid" | "blur" | "omit";

export interface ObscureProps {
	/** `mask` exact money · `solid` personal details · `blur` incidental media · `omit` secrets. */
	tier: ObscureTier;
	children?: ComponentChildren;
	/** Omit tier: the words that stand in where a sentence needs a subject ("the client"). */
	standIn?: string;
	/** The accessible name while a `mask` or `solid` value is hidden. */
	label?: string;
	/** `div` for block content (a statement, a document preview). Default `span`. */
	as?: "span" | "div";
	class?: string;
}

function hiddenBody(tier: ObscureTier, props: ObscureProps): ComponentChildren {
	const label = props.label ?? SCREEN_SHARE_HIDDEN_LABEL;
	if (tier === "mask") {
		return [
			<span key="m" class="ui-obscure__mask" aria-hidden="true">{SCREEN_SHARE_MASK}</span>,
			<span key="l" class="ui-visually-hidden">{label}</span>,
		];
	}
	if (tier === "solid") {
		return [
			<span key="p" class="ui-obscure__placeholder" aria-hidden="true" />,
			<span key="l" class="ui-visually-hidden">{label}</span>,
		];
	}
	if (tier === "blur") return props.children;
	return props.standIn ?? null;
}

/**
 * Obscure — the one way a surface hides a sensitive value while screen sharing mode is on. Server
 * rendering reads the request's `ScreenShareContext` (or the host's ambient resolver); an island
 * reads the store. Hidden `mask` / `solid` / `omit` content is never rendered, so a child island's
 * props are never serialized. Omit-tier content an island already holds in its own props is the
 * caller's to keep out (DESIGN_SYSTEM.md §B.14 D).
 */
export function ObscureMarkup(props: ObscureProps): JSX.Element {
	const { tier, as = "span" } = props;
	const active = useScreenShareActive();
	const host = useRef<HTMLElement | null>(null);
	const bind = useRef((el: HTMLElement | null) => {
		host.current = el;
	}).current;
	useEffect(() => {
		if (host.current) host.current.dataset.obscureLive = "1";
	}, []);
	const attributes = {
		ref: bind,
		class: cx("ui-obscure", `ui-obscure--${tier}`, props.class),
		"data-obscure": tier,
		"data-obscure-masked": active ? "" : undefined,
	};
	const body = active ? hiddenBody(tier, props) : props.children;
	return as === "div" ? <div {...attributes}>{body}</div> : <span {...attributes}>{body}</span>;
}

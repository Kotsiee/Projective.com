import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { FollowDirection, ProfileConnection } from "@projective/types/profile";
import { Dialog, InlineNotice, Skeleton } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { EmptyState } from "@projective/ui/utils";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { ENTITY_META } from "./profile-glyphs.tsx";
import { ProfileService } from "../core/ProfileService.ts";

/**
 * ConnectionsDialog — the people behind a profile's follower / following counts (Decision #180). Rows
 * are hairline-separated links to each profile — avatar, name, one inline meta line (`@handle · kind`)
 * — never cards; "Load more" pages by the follow instant. A profile the viewer may not see is simply
 * not in the list (the server drops it), so a count can read higher than the rows.
 */
export function ConnectionsDialog(
	{ open, direction, handle, name }: {
		open: Signal<boolean>;
		direction: FollowDirection;
		/** The profile's handle (with or without `@`). */
		handle: string;
		name: string;
	},
): JSX.Element {
	const items = useSignal<ProfileConnection[]>([]);
	const cursor = useSignal<string | null>(null);
	const phase = useSignal<"loading" | "ready" | "error">("loading");
	const failure = useSignal("");
	const more = useSignal(false);
	const bare = handle.replace(/^@+/, "");

	async function load(next: boolean): Promise<void> {
		if (next) more.value = true;
		else phase.value = "loading";
		const res = await ProfileService.connections(bare, direction, next ? cursor.value : null);
		more.value = false;
		if (!res.ok || !res.data) {
			failure.value = res.message ?? "We couldn't load this list.";
			if (!next) phase.value = "error";
			return;
		}
		items.value = next ? [...items.value, ...res.data.items] : res.data.items;
		cursor.value = res.data.nextCursor;
		failure.value = "";
		phase.value = "ready";
	}

	useEffect(() => {
		if (open.value) void load(false);
	}, [open.value, direction]);

	const title = direction === "followers" ? "Followers" : "Following";
	let body: JSX.Element;
	if (phase.value === "loading") {
		body = (
			<ul class="pf-conn__list" aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
				{[0, 1, 2].map((i) => (
					<li key={i} class="pf-conn__row" aria-hidden="true">
						<Skeleton shape="circle" class="pf-conn__ph" />
						<Skeleton lines={2} class="pf-conn__body" />
					</li>
				))}
			</ul>
		);
	} else if (phase.value === "error") {
		body = (
			<InlineNotice
				text={failure.value}
				actionLabel="Try again"
				onAction={() => void load(false)}
			/>
		);
	} else if (items.value.length === 0) {
		body = (
			<EmptyState
				size="sm"
				icon={<Icon name="members" />}
				title={direction === "followers" ? "No followers yet" : "Not following anyone yet"}
				description={direction === "followers"
					? `People who follow ${name} show up here.`
					: `Profiles ${name} follows show up here.`}
			/>
		);
	} else {
		body = (
			<>
				<ul class="pf-conn__list" role="list" aria-label={`${title} of ${name}`}>
					{items.value.map((c) => (
						<li key={c.handle} class="pf-conn__row">
							<a class="pf-conn__link" href={`/@${c.handle}`}>
								<UserAvatar label={c.name} image={c.avatar ?? undefined} size="sm" />
								<span class="pf-conn__body">
									<span class="pf-conn__name">{c.name}</span>
									<span class="pf-conn__meta">@{c.handle} · {ENTITY_META[c.kind].label}</span>
								</span>
							</a>
						</li>
					))}
				</ul>
				{failure.value && <InlineNotice text={failure.value} />}
				{cursor.value && (
					<div class="pf-conn__more">
						<Button
							variant="text"
							size="sm"
							label={more.value ? "Loading…" : "Load more"}
							disabled={more.value}
							onClick={() => void load(true)}
						/>
					</div>
				)}
			</>
		);
	}

	return (
		<Dialog visible={open} header={title} width="26rem" class="pf-conn">
			{body}
		</Dialog>
	);
}

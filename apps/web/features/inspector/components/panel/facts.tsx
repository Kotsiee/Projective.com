import type { JSX } from "preact";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import type { InspectAsset } from "@projective/types/files";
import type { DetailRow } from "../../core/inspector-model.ts";

/** Props for {@link Fact}. */
export interface FactProps {
	label: string;
	children: JSX.Element | string;
}

/** One `dt`/`dd` pair of an `.ins-facts` list. */
export function Fact({ label, children }: FactProps): JSX.Element {
	return (
		<div class="ins-facts__row">
			<dt class="ins-facts__label">{label}</dt>
			<dd class="ins-facts__value">{children}</dd>
		</div>
	);
}

/** A {@link DetailRow} as a fact, its secondary text quieter after the value. */
export function PlainFact({ row }: { row: DetailRow }): JSX.Element {
	return (
		<Fact label={row.label}>
			<span class="ins-facts__text">
				{row.value}
				{row.secondary ? <span class="ins-facts__secondary">{row.secondary}</span> : null}
			</span>
		</Fact>
	);
}

/** When the file was uploaded. */
export function UploadedFact({ asset }: { asset: InspectAsset }): JSX.Element {
	return (
		<Fact label="Uploaded">
			<time class="ins-facts__text" dateTime={asset.createdAt}>{asset.dateLabel}</time>
		</Fact>
	);
}

/** Who owns the file, with avatar and profile handle; nothing when the owner is not shown. */
export function OwnerFact({ asset }: { asset: InspectAsset }): JSX.Element | null {
	const owner = asset.owner;
	if (!owner) return null;
	return (
		<Fact label="Owner">
			<span class="ins-owner">
				<UserAvatar image={owner.avatarSrc} label={owner.name} size={24} />
				<span class="ins-owner__name">{owner.name}</span>
				{owner.handle
					? (
						<a
							class="ins-owner__handle"
							href={`/${encodeURIComponent(owner.handle)}`}
							target="_blank"
							rel="noopener noreferrer"
						>
							{`@${owner.handle}`}
						</a>
					)
					: null}
			</span>
		</Fact>
	);
}

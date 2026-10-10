import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { profileHref } from "../../core/routing.ts";
import type { SourcePaint } from "./preview-model.ts";

/** Props for {@link SourceMessage}. */
export interface SourceMessageProps {
	source: SourcePaint;
	/** Id of the section heading. */
	titleId: string;
	/** "Go to message"; omitted when nothing can reach the message. */
	onGo?: () => void;
}

/** The message a file was posted in: who sent it, where and when, what it said, and a way back to it. */
export function SourceMessage({ source, titleId, onGo }: SourceMessageProps): JSX.Element {
	const { sender } = source;
	const where = [source.channelLabel, `${source.dayLabel} ${source.timeLabel}`.trim()]
		.filter((part): part is string => !!part && part.length > 0)
		.join(" · ");
	return (
		<section class="fx-aside__section fx-source" aria-labelledby={titleId}>
			<h3 id={titleId} class="fx-aside__title">Shared in a message</h3>
			<div class="fx-source__who">
				<UserAvatar image={sender.avatarSrc} label={sender.name} size={32} alt="" />
				<div class="fx-source__id">
					{sender.handle
						? (
							<a class="fx-source__name" href={profileHref(sender.handle)}>
								{sender.name}
							</a>
						)
						: <span class="fx-source__name">{sender.name}</span>}
					<time class="fx-source__when" dateTime={source.createdAt}>{where}</time>
				</div>
			</div>
			{source.excerpt ? <p class="fx-source__excerpt">{source.excerpt}</p> : null}
			{onGo
				? (
					<div class="fx-source__go">
						<Button
							size="sm"
							severity="neutral"
							variant="outlined"
							icon={<Icon name="message" size="sm" />}
							label="Go to message"
							onClick={onGo}
						/>
					</div>
				)
				: null}
		</section>
	);
}

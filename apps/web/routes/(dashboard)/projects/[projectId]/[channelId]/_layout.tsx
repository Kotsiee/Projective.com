import { define } from "@web/utils/state.ts";

/**
 * Channel view layout — the scrolling body chrome for every channel/chat tab
 * (`/projects/[projectId]/[channelId]/{chat,files,members,submissions,calendar,tasks}`).
 *
 * Neither the contextual header NOR the Chat composer is rendered here: both are mounted by the shell
 * into the middle-nav FRAME's configurable bands (Decision #31) — the {@link ChannelHeader} into the
 * sticky `header` band (resolved by `channelHeaderFor`) and the {@link ChatComposer} into the sticky
 * `footer` band (resolved by `channelFooterFor`), both threaded through `UserShell`. So the header pins
 * to the viewport top and the composer to the viewport bottom, while THIS body simply flows in the
 * native window scroll between them. The layout owns only the tab body wrapper.
 */
export default define.page(function ChannelLayout(ctx) {
	return (
		<div class="chan-view">
			<ctx.Component />
		</div>
	);
});

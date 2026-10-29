import { assertRejects } from "@std/assert";
import { MediaRejectedError } from "./pipeline.ts";
import { VIDEO_REFUSED, writeRendition } from "./showcase-rendition.ts";

Deno.test("writeRendition: a video is refused before anything is read or written (SEC Z2)", async () => {
	await assertRejects(
		() =>
			writeRendition(
				{ type: "user", id: "u1" },
				{ userId: "u1", accessToken: "t" } as Parameters<typeof writeRendition>[1],
				{
					id: "a1",
					name: "clip.mp4",
					kind: "video",
					mimeType: "video/mp4",
					bucket: "personal",
					path: "u1/a1/clip.mp4",
					width: 1920,
					height: 1080,
					durationMs: 4000,
					metadata: null,
					tiers: {},
				},
				{ target: "showcase", position: 2 },
			),
		MediaRejectedError,
		VIDEO_REFUSED,
	);
});

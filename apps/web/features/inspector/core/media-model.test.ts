import { assertEquals } from "@std/assert";
import {
	audioFacts,
	channelLabel,
	clampRate,
	clockOf,
	formatRate,
	frameFileName,
	isSideways,
	mediaCommand,
	type MediaKeyStroke,
	nextTurn,
	PLAYER_RATES,
	preciseClock,
	seekTarget,
	stepRate,
	VIDEO_SHORTCUTS,
	videoFacts,
	waveformNote,
} from "./media-model.ts";

function stroke(key: string, mods: Partial<MediaKeyStroke> = {}): MediaKeyStroke {
	return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
}

Deno.test("clampRate: snaps to quarter steps inside 0.5–2", () => {
	assertEquals(clampRate(1.1), 1);
	assertEquals(clampRate(1.2), 1.25);
	assertEquals(clampRate(0.1), 0.5);
	assertEquals(clampRate(16), 2);
	assertEquals(clampRate(Number.NaN), 1);
});

Deno.test("stepRate: moves one step and stops at the ends", () => {
	assertEquals(stepRate(1, 1), 1.25);
	assertEquals(stepRate(1, -1), 0.75);
	assertEquals(stepRate(2, 1), 2);
	assertEquals(stepRate(0.5, -1), 0.5);
});

Deno.test("formatRate and PLAYER_RATES: normal speed first, trimmed labels", () => {
	assertEquals(PLAYER_RATES[0], 1);
	assertEquals(formatRate(1), "1×");
	assertEquals(formatRate(1.25), "1.25×");
	assertEquals(formatRate(0.5), "0.5×");
});

Deno.test("seekTarget: clamps into the media and refuses an unknown length", () => {
	assertEquals(seekTarget(5, -10, 60), 0);
	assertEquals(seekTarget(55, 10, 60), 60);
	assertEquals(seekTarget(20, 10, 60), 30);
	assertEquals(seekTarget(Number.NaN, 5, 60), 5);
	assertEquals(seekTarget(5, 5, Number.NaN), null);
	assertEquals(seekTarget(5, 5, Number.POSITIVE_INFINITY), null);
});

Deno.test("nextTurn and isSideways: quarter turns wrap both ways", () => {
	assertEquals(nextTurn(0, 1), 90);
	assertEquals(nextTurn(270, 1), 0);
	assertEquals(nextTurn(0, -1), 270);
	assertEquals(nextTurn(180, -1), 90);
	assertEquals(isSideways(90), true);
	assertEquals(isSideways(270), true);
	assertEquals(isSideways(180), false);
});

Deno.test("clockOf and preciseClock: minutes, hours and milliseconds", () => {
	assertEquals(clockOf(0), "0:00");
	assertEquals(clockOf(125.4), "2:05");
	assertEquals(clockOf(3725), "1:02:05");
	assertEquals(clockOf(Number.NaN), "0:00");
	assertEquals(preciseClock(125.0333), "2:05.033");
	assertEquals(preciseClock(3725.5), "1:02:05.500");
	assertEquals(preciseClock(-1), "0:00.000");
});

Deno.test("frameFileName: strips the extension and unsafe characters", () => {
	assertEquals(frameFileName("clip.webm", 12.345), "clip-frame-0-12-345.png");
	assertEquals(frameFileName("a/b:c?.mp4", 0), "a-b-c-frame-0-00-000.png");
	assertEquals(frameFileName(".mov", 1), "mov-frame-0-01-000.png");
	assertEquals(frameFileName("???.mp4", 1), "frame-frame-0-01-000.png");
	assertEquals(frameFileName("tab\there.mp4", 1), "tabhere-frame-0-01-000.png");
});

Deno.test("channelLabel: mono, stereo and multichannel", () => {
	assertEquals(channelLabel(1), "Mono");
	assertEquals(channelLabel(2), "Stereo");
	assertEquals(channelLabel(6), "6 channels");
});

Deno.test("videoFacts: only what Details does not already say", () => {
	const stored = { width: 1920, height: 1080, durationLabel: "0:42" };
	assertEquals(videoFacts(stored, { width: 1920, height: 1080, durationS: 42 }), []);
	assertEquals(videoFacts(stored, { width: 1280, height: 720, durationS: 42 }), [
		{ label: "Resolution", value: "1280 × 720 px" },
	]);
	const bare = { width: null, height: null, durationLabel: null };
	assertEquals(videoFacts(bare, { width: 640, height: 360, durationS: 75 }), [
		{ label: "Resolution", value: "640 × 360 px" },
		{ label: "Duration", value: "1:15" },
	]);
	assertEquals(videoFacts(bare, { width: 0, height: 0, durationS: Number.NaN }), []);
});

Deno.test("audioFacts and waveformNote: length, channels and why a waveform is flat", () => {
	assertEquals(
		audioFacts({ durationLabel: null }, { durationS: 61, channels: 2, waveform: "decode" }),
		[{ label: "Duration", value: "1:01" }, { label: "Channels", value: "Stereo" }],
	);
	assertEquals(
		audioFacts({ durationLabel: "1:01" }, { durationS: 61, channels: null, waveform: "too-large" }),
		[{ label: "Waveform", value: "Not drawn for a file this long" }],
	);
	assertEquals(waveformNote("stored"), null);
	assertEquals(waveformNote("pending"), null);
	assertEquals(waveformNote("failed"), "This browser couldn't read the waveform");
});

Deno.test("mediaCommand: playback keys for both canvases", () => {
	assertEquals(mediaCommand(stroke(" "), "audio"), { type: "toggle-play" });
	assertEquals(mediaCommand(stroke("K"), "video"), { type: "toggle-play" });
	assertEquals(mediaCommand(stroke("ArrowLeft"), "audio"), { type: "seek", delta: -5 });
	assertEquals(mediaCommand(stroke("l"), "video"), { type: "seek", delta: 10 });
	assertEquals(mediaCommand(stroke("Home"), "audio"), { type: "restart" });
	assertEquals(mediaCommand(stroke(">", { shiftKey: true }), "audio"), {
		type: "speed",
		direction: 1,
	});
	assertEquals(mediaCommand(stroke("m"), "audio"), { type: "mute" });
});

Deno.test("mediaCommand: picture keys are video-only; modified presses are ignored", () => {
	assertEquals(mediaCommand(stroke(","), "video"), { type: "frame", direction: -1 });
	assertEquals(mediaCommand(stroke(","), "audio"), null);
	assertEquals(mediaCommand(stroke("R", { shiftKey: true }), "video"), {
		type: "rotate",
		direction: -1,
	});
	assertEquals(mediaCommand(stroke("r"), "video"), { type: "rotate", direction: 1 });
	assertEquals(mediaCommand(stroke("h"), "audio"), null);
	assertEquals(mediaCommand(stroke("k", { ctrlKey: true }), "video"), null);
	assertEquals(mediaCommand(stroke("f"), "video"), null);
	assertEquals(mediaCommand(stroke("i"), "video"), null);
});

Deno.test("VIDEO_SHORTCUTS: never claims a workspace key", () => {
	const claimed = VIDEO_SHORTCUTS.flatMap((s) => s.keys).map((k) => k.toLowerCase());
	for (const key of ["f", "i", "?"]) assertEquals(claimed.includes(key), false);
});

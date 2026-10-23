// Builds the final video: intro animation (retimed to the voiceover) + demo recording.
//
//   node video/stitch.mjs --voice voiceover.m4a --demo "Screen Recording….mov" \
//     [--timing '{"goal":7.5,"conflict":13,"title":23.5,"end":26}'] [--out out/pollinator-video.mp4]
//
// Without --timing, the intro's default beats are scaled so the voiceover
// finishes about a second before the end of the title card.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.voice || !args.demo) throw new Error("--voice and --demo are required");
const outDir = join(here, "out");
const out = resolve(here, args.out ?? "out/pollinator-video.mp4");
const BG = "0x17150f"; // intro background, used for the demo's side bars

const duration = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
const ffmpeg = (...a) => execFileSync("ffmpeg", ["-y", "-v", "error", ...a], { stdio: "inherit" });

// 1. Retime and render the intro.
const voiceLen = duration(args.voice);
const DEFAULT = { situation: 0, goal: 8, conflict: 14, title: 24, end: 26.5 };
let timing = args.timing ? { ...DEFAULT, ...JSON.parse(args.timing) } : null;
if (!timing) {
  const f = (voiceLen + 1) / DEFAULT.end;
  timing = Object.fromEntries(Object.entries(DEFAULT).map(([k, v]) => [k, Math.round(v * f * 100) / 100]));
}
timing.end = Math.max(timing.end, voiceLen + 0.5);
console.log(`voiceover ${voiceLen.toFixed(2)}s -> timing ${JSON.stringify(timing)}`);
execFileSync("node", [join(here, "render.mjs"), "--out", "out/intro.mp4", "--timing", JSON.stringify(timing)], { stdio: "inherit" });

// 2. Lay the voiceover on the intro (normalised loudness, padded with silence).
const intro = join(outDir, "intro-voiced.mp4");
ffmpeg(
  "-i", join(outDir, "intro.mp4"), "-i", args.voice,
  "-filter_complex", `[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${timing.end}[a]`,
  "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", intro,
);

// 3. Fit the demo into 1920x1080 at 30 fps, keeping its own audio (cached).
const demo = join(outDir, "demo-1080.mp4");
if (!existsSync(demo) || statSync(demo).mtimeMs < statSync(args.demo).mtimeMs) {
  ffmpeg(
    "-i", args.demo,
    "-vf", `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=${BG},fps=30,format=yuv420p`,
    "-af", "aresample=48000,aformat=channel_layouts=stereo",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", demo,
  );
}

// 4. Stitch.
ffmpeg(
  "-i", intro, "-i", demo,
  "-filter_complex", "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]",
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
);
console.log(`wrote ${out} (${duration(out).toFixed(1)}s)`);

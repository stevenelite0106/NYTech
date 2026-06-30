import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

/**
 * Transcode a recorded take to MP3.
 *
 * The booth records WebM/Opus (Chrome/Firefox) or MP4/AAC (Safari/iPad)
 * depending on the device. Safari cannot decode WebM/Opus at all, so a WebM
 * recording is unplayable in the delivered email on Safari. MP3 is the one
 * audio format that plays natively in EVERY browser and webmail client, so we
 * normalise every take to it before storing — playback then works everywhere
 * regardless of where the recording was made.
 *
 * Mono / 44.1 kHz / 128 kbps: ample for a single speaking voice and keeps the
 * files small. Uses the bundled static ffmpeg binary (no system ffmpeg). This
 * is nodejs-runtime only and relies on a writable /tmp (Vercel gives 512 MB).
 */
export async function transcodeToMp3(input: Blob, srcExt: string): Promise<Blob> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found");

  const dir = await mkdtemp(join(tmpdir(), "fss-transcode-"));
  const inPath = join(dir, `in.${srcExt || "webm"}`);
  const outPath = join(dir, "out.mp3");
  try {
    await writeFile(inPath, Buffer.from(await input.arrayBuffer()));
    await runFfmpeg([
      "-i", inPath,
      "-vn", // no video stream
      "-ac", "1", // mono
      "-ar", "44100",
      "-codec:a", "libmp3lame",
      "-b:a", "128k",
      "-y",
      outPath,
    ]);
    const out = await readFile(outPath);
    if (out.length === 0) throw new Error("ffmpeg produced an empty file");
    return new Blob([out], { type: "audio/mpeg" });
  } finally {
    // Best-effort temp cleanup — /tmp is ephemeral but bounded, don't leak.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

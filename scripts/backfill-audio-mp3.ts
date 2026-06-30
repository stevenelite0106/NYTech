/**
 * One-off backfill: convert already-stored recordings to MP3 so they play in
 * every browser (Safari can't decode the WebM/Opus that Chrome recorded).
 *
 * New sessions are transcoded to MP3 at record time by /api/analyze. This
 * script fixes the rows captured BEFORE that shipped.
 *
 * Per session, for each take whose stored file isn't already .mp3:
 *   1. Download the bytes from Vercel Blob (signed GET).
 *   2. Transcode to MP3 with the bundled static ffmpeg (lib/transcode).
 *   3. Upload alongside the original as <same-path>.mp3.
 *   4. Repoint signal_data.takes[].pathname (and audio_* for Q1) at the MP3.
 *   5. Delete the original blob.
 *
 * Rows with a per-take array use it; legacy single-file rows fall back to
 * transcoding audio_pathname. (For a legacy CONCATENATED webm, only Q1 will be
 * recoverable — run `npm run blobs:migrate-takes` first to split it.)
 *
 * Defaults to dry-run. Pass `--apply` to mutate.
 *
 *   npm run audio:backfill              # dry-run
 *   npm run audio:backfill -- --apply   # for real
 *
 * Idempotent: takes already ending in .mp3 are skipped, so it's safe to re-run.
 */
import { del, put, issueSignedToken, presignUrl } from "@vercel/blob";
import postgres from "postgres";
import { transcodeToMp3 } from "../lib/transcode";
import type { SignalData, TakeAudio } from "../lib/signals";

type Row = {
  id: string;
  audio_pathname: string | null;
  audio_url: string | null;
  signal_data: SignalData | null;
};

async function main() {
  const apply = process.argv.includes("--apply");

  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is not set");
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  }

  const sql = postgres(url, { ssl: "require", prepare: false });

  // Any row with a stored file. We decide per-take in code (idempotent skip
  // of .mp3) rather than trying to express it in SQL across the jsonb array.
  const rows = await sql<Row[]>`
    select id, audio_pathname, audio_url, signal_data
    from sessions
    where audio_pathname is not null
    order by recorded_at asc
  `;

  console.log(`Scanning ${rows.length} session${rows.length === 1 ? "" : "s"}.\n`);

  let sessionsChanged = 0;
  let takesConverted = 0;
  let takesSkipped = 0;
  let failed = 0;
  let bytesIn = 0;
  let bytesOut = 0;

  for (const row of rows) {
    const signals = row.signal_data;
    const takes = signals?.takes ?? [];

    try {
      // ── New-schema rows: convert each non-mp3 take in place ─────────────
      if (takes.length > 0) {
        let changed = false;
        const newTakes: TakeAudio[] = [];
        let firstUpload: { pathname: string; url: string } | null = null;
        const toDelete: string[] = [];

        for (const take of takes) {
          if (!take.pathname || take.pathname.endsWith(".mp3")) {
            takesSkipped++;
            newTakes.push(take);
            if (!firstUpload && take.pathname) {
              firstUpload = { pathname: take.pathname, url: "" };
            }
            continue;
          }

          const src = await fetchBlobBytes(take.pathname);
          bytesIn += src.length;
          const mp3Key = `${stripExt(take.pathname)}.mp3`;

          if (!apply) {
            console.log(`  ${row.id}  q${take.question_index}: ${take.pathname} → ${mp3Key}  (${formatBytes(src.length)})`);
            changed = true;
            newTakes.push(take);
            continue;
          }

          const mp3 = await transcodeToMp3(blob(src, take.pathname), extNoDot(take.pathname));
          bytesOut += mp3.size;
          const uploaded = await put(mp3Key, mp3, {
            access: "private",
            contentType: "audio/mpeg",
            addRandomSuffix: false,
          });
          // Defer deleting the original until AFTER the row is repointed, so a
          // crash mid-session can't leave the DB pointing at a deleted blob.
          toDelete.push(take.pathname);

          newTakes.push({ ...take, pathname: uploaded.pathname });
          if (take.question_index === 1 || !firstUpload) {
            firstUpload = { pathname: uploaded.pathname, url: uploaded.url };
          }
          takesConverted++;
          changed = true;
          console.log(`  ${row.id}  q${take.question_index} → mp3 (${formatBytes(mp3.size)})`);
        }

        if (changed && apply) {
          // Repoint the legacy audio_* columns at Q1's mp3 (firstUpload prefers
          // question_index === 1) when we re-uploaded it.
          const newSignals: SignalData = { ...(signals as SignalData), takes: newTakes };
          await sql`
            update sessions
            set signal_data = ${sql.json(newSignals as unknown as Parameters<typeof sql.json>[0])},
                audio_pathname = ${firstUpload?.pathname ?? row.audio_pathname},
                audio_url = ${firstUpload?.url || row.audio_url}
            where id = ${row.id}
          `;
          // Row is safely repointed — now reclaim the originals.
          for (const p of toDelete) await del(p);
          sessionsChanged++;
        } else if (changed) {
          sessionsChanged++;
        }
        continue;
      }

      // ── Legacy single-file rows: convert audio_pathname itself ──────────
      const path = row.audio_pathname!;
      if (path.endsWith(".mp3")) {
        takesSkipped++;
        continue;
      }
      const src = await fetchBlobBytes(path);
      bytesIn += src.length;
      const mp3Key = `${stripExt(path)}.mp3`;

      if (!apply) {
        console.log(`  ${row.id}  (legacy single file): ${path} → ${mp3Key}  (${formatBytes(src.length)})`);
        sessionsChanged++;
        continue;
      }

      const mp3 = await transcodeToMp3(blob(src, path), extNoDot(path));
      bytesOut += mp3.size;
      const uploaded = await put(mp3Key, mp3, {
        access: "private",
        contentType: "audio/mpeg",
        addRandomSuffix: false,
      });
      await sql`
        update sessions
        set audio_pathname = ${uploaded.pathname}, audio_url = ${uploaded.url}
        where id = ${row.id}
      `;
      // Row repointed — safe to delete the original now.
      await del(path);
      takesConverted++;
      sessionsChanged++;
      console.log(`  ${row.id}  legacy → mp3 (${formatBytes(mp3.size)})`);
    } catch (err) {
      failed++;
      console.error(`  ${row.id}  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("");
  console.log(`Sessions changed:  ${sessionsChanged}`);
  console.log(`Takes converted:   ${takesConverted}`);
  console.log(`Takes skipped:     ${takesSkipped} (already mp3)`);
  console.log(`Failed:            ${failed}`);
  if (apply) console.log(`Bytes: ${formatBytes(bytesIn)} in → ${formatBytes(bytesOut)} out`);
  else console.log("\nDry-run only. Re-run with `-- --apply` to mutate.");

  await sql.end();
}

/** Wrap raw bytes in a Blob for transcodeToMp3 (which takes a Blob). */
function blob(buf: Buffer, pathname: string): Blob {
  return new Blob([buf], { type: mimeForPath(pathname) });
}

function mimeForPath(pathname: string): string {
  if (pathname.endsWith(".m4a") || pathname.endsWith(".mp4")) return "audio/mp4";
  if (pathname.endsWith(".ogg")) return "audio/ogg";
  return "audio/webm";
}

/** Fetch raw bytes for a private-store blob pathname via a signed GET URL. */
async function fetchBlobBytes(pathname: string): Promise<Buffer> {
  const validUntil = Date.now() + 5 * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(
    {
      clientSigningToken: token.clientSigningToken,
      delegationToken: token.delegationToken,
    },
    { operation: "get", pathname, access: "private" }
  );
  const res = await fetch(presignedUrl);
  if (!res.ok) throw new Error(`blob GET ${res.status} for ${pathname}`);
  return Buffer.from(await res.arrayBuffer());
}

function stripExt(pathname: string): string {
  return pathname.replace(/\.[a-z0-9]+$/i, "");
}

function extNoDot(pathname: string): string {
  const m = pathname.match(/\.([a-z0-9]+)$/i);
  return m ? m[1] : "webm";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

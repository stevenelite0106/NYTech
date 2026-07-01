/**
 * Copy all rows from a SOURCE sessions table into the DEST sessions table,
 * preserving everything — including signal_data (real JSONB, not the
 * "[object Object]" a MySQL text dump produces) and delivered_at (so
 * already-sent emails are NOT re-delivered).
 *
 * Use this to migrate the old Neon database into the new one after the
 * production POSTGRES_URL changed.
 *
 *   SOURCE = old DB (env: SOURCE_POSTGRES_URL)
 *   DEST   = new DB (env: POSTGRES_URL, i.e. the one in .env.local now)
 *
 * Rows are matched by primary key `id`; existing ids are skipped
 * (ON CONFLICT DO NOTHING), so it's idempotent and safe to re-run.
 *
 *   npm run sessions:copy              # dry-run: counts only
 *   npm run sessions:copy -- --apply   # actually insert
 */
import postgres from "postgres";

async function main() {
  const apply = process.argv.includes("--apply");
  const sourceUrl = process.env.SOURCE_POSTGRES_URL;
  const destUrl = process.env.POSTGRES_URL;
  if (!sourceUrl) throw new Error("SOURCE_POSTGRES_URL is not set (the OLD database)");
  if (!destUrl) throw new Error("POSTGRES_URL is not set (the DEST database)");
  if (sourceUrl === destUrl) throw new Error("SOURCE and DEST are the same database");

  const src = postgres(sourceUrl, { ssl: "require", prepare: false });
  const dst = postgres(destUrl, { ssl: "require", prepare: false });

  const rows = await src`select * from sessions order by recorded_at asc`;
  const destBefore = await dst<{ c: number }[]>`select count(*)::int as c from sessions`;
  console.log(`SOURCE rows: ${rows.length}`);
  console.log(`DEST rows (before): ${destBefore[0].c}`);

  if (!apply) {
    // Report how many would be new vs already present.
    const ids = rows.map((r) => r.id as string);
    const existing = await dst<{ id: string }[]>`
      select id from sessions where id in ${dst(ids)}
    `;
    const existingSet = new Set(existing.map((e) => e.id));
    const newCount = ids.filter((id) => !existingSet.has(id)).length;
    console.log(`Would insert: ${newCount}`);
    console.log(`Would skip (already in DEST): ${ids.length - newCount}`);
    console.log("\nDry-run only. Re-run with `-- --apply` to insert.");
    await src.end();
    await dst.end();
    return;
  }

  let inserted = 0;
  for (const r of rows) {
    const res = await dst`
      insert into sessions (
        id, first_name, email, focus, prompt, audio_url, audio_pathname,
        duration_seconds, event_name, transcript, signal_data,
        recorded_at, deliver_at, delivered_at,
        resend_email_id, delivery_status, delivery_updated_at
      ) values (
        ${r.id}, ${r.first_name}, ${r.email}, ${r.focus}, ${r.prompt},
        ${r.audio_url}, ${r.audio_pathname}, ${r.duration_seconds},
        ${r.event_name}, ${r.transcript},
        ${r.signal_data === null ? null : dst.json(r.signal_data)},
        ${r.recorded_at}, ${r.deliver_at}, ${r.delivered_at},
        ${r.resend_email_id ?? null}, ${r.delivery_status ?? null},
        ${r.delivery_updated_at ?? null}
      )
      on conflict (id) do nothing
      returning id
    `;
    if (res.length) inserted++;
  }

  const destAfter = await dst<{ c: number }[]>`select count(*)::int as c from sessions`;
  console.log(`\nInserted: ${inserted}`);
  console.log(`Skipped (already present): ${rows.length - inserted}`);
  console.log(`DEST rows (after): ${destAfter[0].c}`);

  await src.end();
  await dst.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

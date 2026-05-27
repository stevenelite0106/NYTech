"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionState } from "@/app/page";
import Logo from "@/components/Logo";

const THEATRICAL_DURATION_MS = 45_000;
const MAX_UPLOAD_RETRIES = 5;

type Props = {
  session: SessionState;
  onComplete: (deliverAt: Date) => void;
  onError: () => void;
};

/**
 * Stage timeline. Times are cumulative seconds inside the 45s theatrical
 * window. The "Uploading to your vault" stage syncs to the real upload —
 * it cannot move to `done` until the real upload result arrives, even if
 * its clock window has elapsed.
 */
type Stage = {
  id: string;
  name: string;
  subtext: string;
  startSec: number;
  endSec: number;
  /** True for the one stage that gates on the real network upload result. */
  syncsToUpload?: boolean;
};

const STAGES: Stage[] = [
  { id: "receive",   name: "Receiving your take",      subtext: "Captured, safe with us",            startSec: 0,    endSec: 5 },
  { id: "encode",    name: "Encoding audio",           subtext: "Preserving every breath",           startSec: 5,    endSec: 12 },
  { id: "seal",      name: "Sealing the envelope",     subtext: "Tamper-proof for the next ten days", startSec: 12,   endSec: 19 },
  { id: "upload",    name: "Uploading to your vault",  subtext: "Private. Yours only.",              startSec: 19,   endSec: 32, syncsToUpload: true },
  { id: "schedule",  name: "Scheduling delivery",      subtext: "Ten days from now, on the dot",     startSec: 32,   endSec: 39 },
  { id: "appoint",   name: "Setting the appointment",  subtext: "Your future self has been notified", startSec: 39,   endSec: 45 },
];

type StageStatus = "pending" | "active" | "done";

type StageState = {
  status: StageStatus;
  /** 0..1 fill within the stage's own window. */
  pct: number;
};

function stageState(
  stage: Stage,
  elapsedSec: number,
  uploadDone: boolean
): StageState {
  if (elapsedSec < stage.startSec) {
    return { status: "pending", pct: 0 };
  }
  if (elapsedSec >= stage.endSec) {
    if (stage.syncsToUpload && !uploadDone) {
      return { status: "active", pct: 1 };
    }
    return { status: "done", pct: 1 };
  }
  const pct = (elapsedSec - stage.startSec) / (stage.endSec - stage.startSec);
  return { status: "active", pct };
}

export default function Processing({ session, onComplete }: Props) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const completedRef = useRef(false);
  const uploadStartedRef = useRef(false);
  const uploadResultRef = useRef<{ deliverAt: Date } | null>(null);

  // Theatrical clock. Drives all stage progress + the overall meter. Continues
  // past 45s if the upload hasn't finished — the screen stays on the Uploading
  // stage until the real upload resolves.
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      setElapsedSec(elapsed);
      const finished =
        uploadResultRef.current &&
        elapsed >= THEATRICAL_DURATION_MS / 1000 &&
        !completedRef.current;
      if (finished && uploadResultRef.current) {
        completedRef.current = true;
        onComplete(uploadResultRef.current.deliverAt);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onComplete]);

  // Real upload — runs in parallel; result held until theatrical timer completes.
  // Guarded by uploadStartedRef so React StrictMode's double-invoked effects
  // (dev only) don't cause two uploads / two blob writes / two DB rows.
  useEffect(() => {
    if (uploadStartedRef.current) return;
    uploadStartedRef.current = true;

    async function upload() {
      if (!session.audioBlob) return;
      for (let attempt = 1; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
        try {
          setRetrying(attempt > 1);
          const fd = new FormData();
          fd.append("audio", session.audioBlob, "recording.webm");
          fd.append("firstName", session.firstName);
          fd.append("email", session.email);
          fd.append("focus", session.focus);
          fd.append("durationSeconds", String(session.durationSeconds));

          const res = await fetch("/api/upload", { method: "POST", body: fd });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { deliverAt: string };
          uploadResultRef.current = { deliverAt: new Date(data.deliverAt) };
          setUploadDone(true);
          return;
        } catch {
          if (attempt < MAX_UPLOAD_RETRIES) {
            await wait(1500 * attempt);
          } else {
            queueOffline(session);
            const fallbackDeliverAt = new Date(
              Date.now() + (Number(process.env.NEXT_PUBLIC_DELIVERY_DAYS) || 10) * 86400_000
            );
            uploadResultRef.current = { deliverAt: fallbackDeliverAt };
            setUploadDone(true);
            return;
          }
        }
      }
    }

    upload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const overallPct = Math.min(1, elapsedSec / (THEATRICAL_DURATION_MS / 1000));
  const remainingSec = Math.max(
    0,
    Math.ceil(THEATRICAL_DURATION_MS / 1000 - elapsedSec)
  );

  return (
    <section className="stage fade-in">
      <header className="stage-header">
        <span className="brand-lockup">
          <Logo height={26} />
        </span>
        <span className="meta">Processing · Take 01 · {Math.round(overallPct * 100)}%</span>
      </header>

      <div className="stage-body">
        <span className="eyebrow">Processing your take</span>
        <hr className="rule" />

        <ol className="stage-list" aria-label="Processing stages">
          {STAGES.map((stage) => {
            const s = stageState(stage, elapsedSec, uploadDone);
            const showRetrying =
              stage.syncsToUpload && s.status === "active" && retrying;
            return (
              <li key={stage.id} className={`stage-row ${s.status}`}>
                <span className="stage-mark" aria-hidden>
                  {s.status === "done" ? "✓" : s.status === "active" ? "" : ""}
                </span>
                <div className="stage-content">
                  <span className="stage-name">{stage.name}</span>
                  <span className="stage-sub">
                    {showRetrying ? "Reconnecting · staying with you" : stage.subtext}
                  </span>
                  {s.status === "active" && (
                    <span className="stage-meter" aria-hidden>
                      <span
                        className="stage-meter-fill"
                        style={{ width: `${Math.round(s.pct * 100)}%` }}
                      />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <hr className="rule" style={{ marginTop: 32 }} />

        <div className="overall-meter">
          <span className="overall-percent">
            {Math.round(overallPct * 100)}%
          </span>
          <span className="overall-divider">·</span>
          <span className="overall-remaining">
            {remainingSec === 0 ? "Almost there" : `${remainingSec} seconds remaining`}
          </span>
        </div>
      </div>

      <footer className="stage-footer">
        <span>Do not close this window</span>
        <span>Mental fitness infrastructure</span>
      </footer>
    </section>
  );
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// IndexedDB-lite offline queue (single record at a time is fine for a booth)
function queueOffline(session: SessionState) {
  try {
    const reader = new FileReader();
    reader.onload = () => {
      const payload = {
        firstName: session.firstName,
        email: session.email,
        focus: session.focus,
        durationSeconds: session.durationSeconds,
        audioBase64: reader.result,
        queuedAt: new Date().toISOString(),
      };
      localStorage.setItem("future-self:queued", JSON.stringify(payload));
    };
    if (session.audioBlob) reader.readAsDataURL(session.audioBlob);
  } catch {
    // best effort
  }
}

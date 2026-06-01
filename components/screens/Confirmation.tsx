"use client";

import Logo from "@/components/Logo";
import type { SignalData, ThinkingPattern } from "@/lib/signals";
import { LIMITING_BELIEF_LABELS, PATTERN_LABELS } from "@/lib/signals";

type Props = {
  firstName: string;
  deliverAt: Date;
  signals: SignalData | null;
  onDone: () => void;
};

export default function Confirmation({ firstName, deliverAt, signals, onDone }: Props) {
  const dateLabel = formatDeliveryDate(deliverAt);

  // Curated booth surface: top 1 belief, top 2 unhelpful patterns, top 1
  // helpful pattern (if any). Email carries the full readout.
  const topBelief = signals && signals.limiting_beliefs.length > 0
    ? [...signals.limiting_beliefs].sort((a, b) => b.strength - a.strength)[0]
    : null;

  const unhelpfulPatterns: ThinkingPattern[] = signals
    ? [...signals.thinking_patterns]
        .filter((p) => p.pattern_type === "unhelpful")
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 2)
    : [];

  const topHelpful: ThinkingPattern | null = signals
    ? [...signals.thinking_patterns]
        .filter((p) => p.pattern_type === "helpful")
        .sort((a, b) => b.strength - a.strength)[0] ?? null
    : null;

  return (
    <section className="stage fade-in">
      <header className="stage-header">
        <span className="brand-lockup">
          <Logo height={26} />
        </span>
        <span className="meta">Take complete</span>
      </header>

      <div className="stage-body">
        <span className="eyebrow">Here&rsquo;s what we heard</span>
        <hr className="rule" />

        {signals ? (
          <>
            {signals.future_vision.summary && (
              <div className="future-vision">
                <span className="signal-label">What you said is coming</span>
                <p className="future-vision-body">{signals.future_vision.summary}</p>
              </div>
            )}

            <ul className="signal-readout" aria-label="Vocal signal readout">
              <SignalLine label="Certainty" body={signals.certainty.summary} />
              <SignalLine label="Tempo"     body={signals.tempo.summary} />
              <SignalLine label="Register"  body={signals.register.summary} />
              <SignalLine label="Ownership" body={signals.ownership.summary} />
            </ul>

            {topBelief && (
              <div className="belief-block">
                <span className="signal-label">Belief running underneath</span>
                <div className="belief-row">
                  <span className="belief-name">
                    {LIMITING_BELIEF_LABELS[topBelief.type]}
                  </span>
                  <span className="belief-body">{topBelief.interpretation}</span>
                </div>
              </div>
            )}

            {(unhelpfulPatterns.length > 0 || topHelpful) && (
              <div className="patterns-block">
                <span className="signal-label">Patterns to notice</span>
                <ul className="patterns-list">
                  {unhelpfulPatterns.map((p, i) => (
                    <li key={`u-${p.pattern}-${i}`} className="pattern-row">
                      <span className="pattern-name">{PATTERN_LABELS[p.pattern]}</span>
                      <span className="pattern-body">{p.interpretation}</span>
                    </li>
                  ))}
                  {topHelpful && (
                    <li key={`h-${topHelpful.pattern}`} className="pattern-row helpful">
                      <span className="pattern-name">
                        {PATTERN_LABELS[topHelpful.pattern]}
                      </span>
                      <span className="pattern-body">{topHelpful.interpretation}</span>
                    </li>
                  )}
                </ul>
              </div>
            )}

            {signals.sentiment.summary && (
              <p className="sentiment-line">
                <span className="signal-label">Where you&rsquo;re at</span>
                <span className="sentiment-body">{signals.sentiment.summary}</span>
              </p>
            )}
          </>
        ) : (
          <p className="subtext">
            We held your take. The full readout will arrive with your email.
          </p>
        )}

        <hr className="rule" style={{ marginTop: 32 }} />

        <p className="delivery-label">
          {firstName}, your future self will receive this on
        </p>
        <p className="delivery-date">
          <em>{dateLabel}</em>
        </p>

        <p className="brand-line">
          <strong>She&rsquo;s already there.</strong> You&rsquo;re on your way.
        </p>

        <div style={{ marginTop: 40 }}>
          <button className="linear-btn" onClick={onDone} autoFocus>
            Done <span className="arrow">→</span>
          </button>
        </div>
      </div>

      <footer className="stage-footer">
        <span>Recording sealed</span>
        <span>Delivery {dateLabel}</span>
      </footer>
    </section>
  );
}

function SignalLine({ label, body }: { label: string; body: string }) {
  return (
    <li className="signal-line">
      <span className="signal-label">{label}</span>
      <span className="signal-body">{body}</span>
    </li>
  );
}

function formatDeliveryDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

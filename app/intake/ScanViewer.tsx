'use client';

// The imaging reveal — the visual half of the moat.
//
// lib/imaging.ts has always returned normalized [x, y, w, h] regions for an overlay, and
// nothing rendered them, so the moment a judge is meant to react to was two lines of chat text.
// This draws the regions over the study and shows the trained model's real measured card.
//
// On the image: no scan ships in this repo on purpose. GLENDA (what the classifier was trained
// on) is licensed for scientific research only, so it must not be committed or shown in a
// public demo. Drop a licence-clear frame at public/sample-mri/<studyId>.(png|jpg) -- UMD is
// CC BY 4.0 and is the catalog's recommended choice for anything public-facing -- and it
// renders automatically. With no file present this falls back to a clearly-labelled schematic
// so the layout, the boxes, and the demo all still work.
//
// Decision-support framing only: these are regions flagged for radiologist review.

import { useState } from 'react';
import type { ImagingResult } from '@/lib/imaging';

export default function ScanViewer({ result }: { result: ImagingResult }) {
  const [hasImage, setHasImage] = useState(true);
  const src = `/sample-mri/${result.studyId}.png`;

  return (
    <div className="card" style={{ borderColor: 'var(--accent-2)' }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        🩻 The re-read — {result.modality} · flagged for radiologist review
      </div>

      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: 'var(--r-sm)',
          overflow: 'hidden',
          background: 'var(--bg-deep)',
          border: '1px solid var(--border)',
        }}
      >
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`${result.modality} study ${result.studyId}`}
            onError={() => setHasImage(false)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Schematic />
        )}

        {/* the regions the layer flagged */}
        {result.findings
          .filter((f) => f.region)
          .map((f, i) => {
            const [x, y, w, h] = f.region!;
            return (
              <div key={f.label} style={{ position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}>
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    border: '2px solid var(--gold)',
                    borderRadius: 4,
                    boxShadow: '0 0 0 1px rgba(0,0,0,.55), 0 0 22px var(--gold-glow)',
                    animation: `scanFlag 520ms ease-out ${i * 420}ms both`,
                  }}
                />
                <span
                  style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: 5, whiteSpace: 'nowrap',
                    background: 'var(--gold)', color: 'var(--gold-ink)', fontSize: 10.5, fontWeight: 700,
                    padding: '2px 7px', borderRadius: 'var(--r-pill)',
                    animation: `scanFlag 520ms ease-out ${i * 420 + 140}ms both`,
                  }}
                >
                  {f.label}
                  {f.confidence != null && ` · ${Math.round(f.confidence * 100)}%`}
                </span>
              </div>
            );
          })}

        {!hasImage && (
          <span
            style={{
              position: 'absolute', left: 10, bottom: 10, fontSize: 10, letterSpacing: 0.4,
              color: 'var(--faint)', background: 'rgba(5,7,15,.72)', padding: '3px 8px',
              borderRadius: 'var(--r-pill)', border: '1px solid var(--border-soft)',
            }}
          >
            SCHEMATIC — no licence-clear scan loaded
          </span>
        )}
      </div>

      {/* the model behind the read: measured values, imported from the pipeline's own output */}
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="pill">ROC-AUC {result.model.cvAuc}</span>
          <span className="pill">{result.model.cvFolds}-fold CV</span>
          <span className="pill">n={result.model.n.toLocaleString()} real frames</span>
          <span className="pill">{result.model.featureCount} radiomic features</span>
        </div>
        <p className="muted" style={{ fontSize: 11.5, margin: '8px 0 0', lineHeight: 1.5 }}>
          Trained on {result.model.dataset}. Top features:{' '}
          {result.model.topFeatures.slice(0, 3).map((f) => f.feature).join(', ')}. Region
          localisation on this study is illustrative — the classifier is real, the boxes are
          curated pending the pelvic-MRI production run.
        </p>
      </div>

      <style>{`@keyframes scanFlag { from { opacity: 0; transform: scale(.82) } to { opacity: 1; transform: scale(1) } }`}</style>
    </div>
  );
}

// Anatomical stand-in so the reveal still reads when no licensed image is available.
function Schematic() {
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
      <defs>
        <radialGradient id="scanBg" cx="50%" cy="48%" r="62%">
          <stop offset="0%" stopColor="#1b2540" />
          <stop offset="100%" stopColor="#070a12" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#scanBg)" />
      {/* pelvis-ish silhouette, deliberately abstract — not a real anatomical reference */}
      <ellipse cx="50" cy="52" rx="30" ry="26" fill="#243154" opacity="0.85" />
      <ellipse cx="50" cy="44" rx="13" ry="16" fill="#33436e" opacity="0.9" />
      <ellipse cx="33" cy="57" rx="6" ry="5" fill="#2c3a61" />
      <ellipse cx="67" cy="57" rx="6" ry="5" fill="#2c3a61" />
      <g stroke="#3d4f80" strokeWidth="0.3" opacity="0.5">
        <line x1="0" y1="50" x2="100" y2="50" />
        <line x1="50" y1="0" x2="50" y2="100" />
      </g>
    </svg>
  );
}

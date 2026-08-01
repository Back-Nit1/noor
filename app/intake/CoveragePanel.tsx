'use client';

// "The Cost" — but showing the FHIR the payer answer actually produced.
//
// This used to render a single line: "Covered · ~$15 · prior auth started". That's the patient
// answer, and we still lead with it, because Naomi's lens is whether this works for an anxious
// woman. Underneath it we now expose the CoverageEligibilityResponse's insurance[].item[] --
// the benefit breakdown and the authorizationRequired flag -- because that's the artifact that
// shows we spoke real 270/271 and mapped it to real FHIR, rather than printing a number.

import { useState } from 'react';
import type { CoverageEligibilityResponse } from '@medplum/fhirtypes';

export type Coverage = {
  active?: boolean;
  copay?: string;
  priorAuthRequired?: string;
  planName?: string;
  error?: string;
  response?: CoverageEligibilityResponse;
  persisted?: boolean;
  medplumError?: string;
};

export default function CoveragePanel({ coverage }: { coverage: Coverage }) {
  const [open, setOpen] = useState(false);

  // an eligibility error is NOT a coverage denial — never render it as one
  if (coverage.error) {
    return (
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <span className="pill" style={{ marginBottom: 8 }}>The Cost</span>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
          Coverage check unavailable — {coverage.error}
        </p>
      </div>
    );
  }

  const item = coverage.response?.insurance?.[0]?.item?.[0];
  const benefits = item?.benefit ?? [];

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <span className="pill" style={{ marginBottom: 8 }}>The Cost</span>
      <p style={{ margin: '6px 0 0' }}>
        <span className={coverage.active ? 'good' : 'bad'}>{coverage.active ? 'Covered' : 'Not covered'}</span>
        {coverage.copay && <> · ~${coverage.copay} out of pocket</>}
        {coverage.priorAuthRequired === 'Y' && <> · <span className="warn">prior auth started</span></>}
      </p>

      {coverage.response && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="muted"
            style={{
              marginTop: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              font: 'inherit', fontSize: 11.5, color: 'var(--accent)', textDecoration: 'underline',
            }}
          >
            {open ? 'Hide' : 'Show'} CoverageEligibilityResponse · insurance.item
          </button>

          {open && (
            <div
              style={{
                marginTop: 8, padding: 10, borderRadius: 'var(--r-xs)',
                background: 'var(--bg-deep)', border: '1px solid var(--border-soft)',
                fontSize: 11.5, lineHeight: 1.6,
              }}
            >
              <div className="muted" style={{ marginBottom: 6 }}>
                FHIR R4 · {coverage.response.resourceType}
                {coverage.persisted
                  ? ' · saved to Medplum'
                  : ' · not persisted (Medplum unavailable)'}
              </div>

              {benefits.map((b, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span className="muted">{b.type?.text ?? 'Benefit'}</span>
                  <span>
                    {b.allowedMoney?.value != null
                      ? `$${b.allowedMoney.value}`
                      : (b.allowedString ?? '—')}
                  </span>
                </div>
              ))}

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 6 }}>
                <span className="muted">authorizationRequired</span>
                <span className={item?.authorizationRequired ? 'warn' : undefined}>
                  {/* absent means the payer said "undetermined", which is not the same as false */}
                  {item?.authorizationRequired === undefined
                    ? 'undetermined'
                    : String(item.authorizationRequired)}
                </span>
              </div>

              {item?.network?.text && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span className="muted">network</span>
                  <span>{item.network.text}</span>
                </div>
              )}

              <p className="muted" style={{ margin: '8px 0 0', fontSize: 10.5, opacity: 0.8 }}>
                Stedi has no 278 API — the prior-auth request itself is modelled as
                Claim(use=&quot;preauthorization&quot;) + Task, the gap CMS-0057-F closes by Jan 2027.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

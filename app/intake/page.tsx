'use client';

import { useState } from 'react';
import {
  DEMO_PATIENTS, matchClusters, mentionOf,
  type DemoPatient, type Finding, type ClusterMatch,
} from '@/lib/clusters';
import LiveVoice from './LiveVoice';

type Turn = { role: 'patient' | 'thaakat'; text: string };

// Scripted so the repo is instantly demoable. The teammate wires the REAL Deepgram Voice Agent
// (see docs/BUILD_KIT.md) — it calls the same /api routes and the same lib/clusters engine.
// Two seeded patients run through the SAME engine: which cluster fires is data, not code.
export default function Intake() {
  const [patient, setPatient] = useState<DemoPatient>(DEMO_PATIENTS[0]);
  const [record, setRecord] = useState<Finding[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [match, setMatch] = useState<ClusterMatch | null>(null);
  const [coverage, setCoverage] = useState<any | null>(null);
  const [committed, setCommitted] = useState<any | null>(null);
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'interview' | 'reading' | 'assembled'>('idle');
  const [retrieval, setRetrieval] = useState<{ ms: number; backend?: string } | null>(null);
  const [running, setRunning] = useState(false);

  const say = (role: Turn['role'], text: string) => setTurns((t) => [...t, { role, text }]);

  function selectPatient(p: DemoPatient) {
    setPatient(p);
    setRecord([]); setTurns([]); setMatch(null); setCoverage(null); setCommitted(null);
    setRetrieval(null); setPhase('idle');
  }

  async function simulate() {
    setRunning(true);
    setRecord([]); setTurns([]); setMatch(null); setCoverage(null); setCommitted(null);
    const rec: Finding[] = [];
    const push = (f: Finding) => { rec.push(f); setRecord([...rec]); };

    // 1) connect records
    setPhase('connecting');
    say('thaakat', "Hi, I'm Thaakat. I've pulled your records together across your doctors — take your time and tell me what's been going on.");
    for (const f of patient.record) { await wait(500); push(f); }

    // 2) chart-aware question — Moss retrieves over HER WHOLE RECORD (<10ms) and what comes back
    //    is what Thaakat cites. The question is assembled from retrieval, not a hardcoded string.
    setPhase('interview');
    await wait(500);
    const r = await fetch('/api/moss/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: patient.retrievalQuery, patientId: patient.id, topK: 4 }),
    }).then((x) => x.json()).catch(() => ({}));
    if (typeof r.ms === 'number') setRetrieval({ ms: r.ms, backend: r.backend });

    const cited: Finding[] = (r.results ?? [])
      .filter((d: any) => d.kind === 'record')
      .map((d: any) => d.finding as Finding)
      .slice(0, 2);
    say('thaakat', cited.length
      ? `I can see ${joinMentions(cited.map(mentionOf))}. ${patient.question}`
      : patient.question);

    await wait(700);
    say('patient', patient.reply);
    push(patient.reported);

    // 3) the imaging moment — re-read the under-read scan (THE MOAT).
    //    Only some patients have one; record assembly alone carries the rest.
    let img: any = null;
    if (patient.imaging) {
      setPhase('reading');
      await wait(700);
      say('thaakat', patient.imaging.intro);
      img = await fetch('/api/imaging/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studyId: patient.imaging.studyId }),
      }).then((x) => x.json()).catch(() => null);
      await wait(500);
      if (img?.findings?.length) {
        for (const f of img.findings) say('thaakat', f.narration);
        push({
          id: 'radiomics', label: patient.imaging.label,
          detail: img.summary, specialty: patient.imaging.specialty, date: patient.imaging.date,
          source: patient.imaging.source, tags: patient.imaging.tags, fromImaging: true,
        });
      }
    }

    // 4) assemble the cluster — all three definitions evaluated against the record
    const matches = matchClusters(rec);
    const top = matches[0] ?? null;
    setMatch(top);
    setPhase('assembled');
    await wait(500);
    if (top) say('thaakat', top.cluster.narration);

    // 5) The Cost — Stedi eligibility priced against THIS cluster's confirmatory service
    const cov = await fetch('/api/eligibility', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient: patient.payer,
        serviceTypeCodes: top?.cluster.confirmatory.serviceTypeCodes,
      }),
    }).then((x) => x.json()).catch(() => null);
    setCoverage(cov);
    const pa = cov?.priorAuthRequired === 'Y';
    if (top) {
      say('thaakat', `The next step I'd suggest — ${top.cluster.confirmatory.name} — is covered${cov?.copay ? `, about $${cov.copay} out of pocket` : ''}${pa ? ", and it needs prior authorization, which I've started." : '.'}`);
    }

    // 6) write it to Medplum (DetectedIssue + Dossier + referral + PA)
    const commit = await fetch('/api/medplum/commit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symptoms: rec.filter((f) => f.specialty.startsWith('Patient')).map((f) => f.detail),
        imagingFindings: img?.findings?.map((f: any) => f.narration),
        referral: top ? { specialty: 'Specialist referral', imaging: top.cluster.confirmatory.name, cptCode: top.cluster.confirmatory.cptCode } : undefined,
        priorAuthRequired: pa,
        cluster: top ? { name: top.cluster.name, ask: top.cluster.ask, confidence: top.confidence } : undefined,
        patientName: patient.name,
      }),
    }).then((x) => x.json()).catch(() => null);
    setCommitted(commit);

    await wait(300);
    say('thaakat', patient.imaging
      ? "I've assembled everything your doctors documented — including the scan they missed — into one brief. You've waited long enough. Let's get you answers."
      : "I've assembled everything your doctors already documented into one brief. Every piece of this was in your chart the whole time. You've waited long enough.");
    setRunning(false);
  }

  return (
    <main className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 0' }}>
        <div>
          <h2 style={{ margin: 0 }}>Thaakat</h2>
          <span className="muted" style={{ fontSize: 13 }}>reading your whole record — including the scan they missed</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Live Deepgram Voice Agent — drives the same cards as the scripted run below. */}
          <LiveVoice
            disabled={running}
            patientId={patient.id}
            onSeed={(seeded) => {
              setRecord(seeded); setTurns([]); setMatch(null); setCoverage(null); setCommitted(null);
              setPhase('connecting');
            }}
            handlers={{
              onTurn: (role, text) => say(role, text),
              onFinding: (f) => setRecord((r) => (r.some((x) => x.id === f.id) ? r : [...r, f])),
              onCluster: (m) => setMatch(m),
              onCoverage: (c) => setCoverage(c),
              onCommit: (c) => setCommitted(c),
              onRetrieval: (ms, backend) => setRetrieval({ ms, backend }),
              onPhase: (p) => setPhase(p),
            }}
          />
          <button className="btn" onClick={simulate} disabled={running}>{running ? 'Running…' : '▶ Play demo'}</button>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12, paddingBottom: 14 }}>
        DEMO — synthetic data only. Decision-support / navigation, not diagnosis.
      </div>

      {/* Patient switcher — same engine, same UI, same routes. A different cluster fires because
          the record differs. This is the answer to "does this only work for endometriosis?" */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 16, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 12 }}>Patient:</span>
        {DEMO_PATIENTS.map((p) => (
          <button
            key={p.id}
            className="btn"
            disabled={running}
            onClick={() => selectPatient(p)}
            style={{
              padding: '6px 12px', fontSize: 13,
              opacity: p.id === patient.id ? 1 : 0.45,
              borderColor: p.id === patient.id ? 'var(--accent-2)' : undefined,
            }}
          >
            {p.name.given} {p.name.family} · {p.headline}
          </button>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.1fr 1fr', alignItems: 'start' }}>
        {/* LEFT: the assembled record (The Dossier) + cluster */}
        <div className="grid">
          <div className="card">
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              📄 The Dossier — assembled record {phase === 'connecting' && <span className="pill">connecting via patient-access APIs…</span>} {retrieval && <span className="pill">retrieval {retrieval.ms}ms{retrieval.backend ? ` · ${retrieval.backend}` : ''}</span>}
            </div>
            {record.length === 0 && <p className="muted">Press ▶ Play demo — your records assemble here.</p>}
            <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 14 }}>
              {record.map((f) => (
                <div key={f.id} style={{ margin: '0 0 14px', position: 'relative' }}>
                  <div style={{ position: 'absolute', left: -21, top: 4, width: 10, height: 10, borderRadius: 999,
                    background: f.fromImaging ? 'var(--accent-2)' : f.orphaned ? 'var(--warn)' : 'var(--accent)' }} />
                  <div style={{ fontSize: 12 }} className="muted">{f.date} · {f.specialty}{f.orphaned && <span className="warn"> · never followed up</span>}{f.fromImaging && <span style={{ color: 'var(--accent-2)' }}> · surfaced by Thaakat</span>}</div>
                  <div style={{ fontWeight: 600 }}>{f.label}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{f.detail}</div>
                  <div className="muted" style={{ fontSize: 11, opacity: 0.7 }}>source: {f.source}</div>
                </div>
              ))}
            </div>
          </div>

          {match && (
            <div className="card" style={{ borderColor: 'var(--accent-2)' }}>
              <div className="muted" style={{ fontSize: 12 }}>🔍 Pattern nobody assembled <span className="pill">{Math.round(match.confidence * 100)}% match</span></div>
              <h3 style={{ margin: '6px 0' }}>{match.cluster.name}</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{match.cluster.narration}</p>
              {/* which signals fired — the matcher is auditable, not a black box */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 4px' }}>
                {match.matched.map((t) => <span key={t} className="pill" style={{ fontSize: 11 }}>{t}</span>)}
              </div>
              <div style={{ marginTop: 10 }}>
                <div className="pill" style={{ marginBottom: 8 }}>The Ask (for the clinician — never a diagnosis)</div>
                <p style={{ margin: 0 }}>{match.cluster.ask}</p>
              </div>
              {coverage && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <span className="pill" style={{ marginBottom: 8 }}>The Cost</span>
                  {/* an eligibility error is NOT a coverage denial — don't render it as one */}
                  {coverage.error ? (
                    <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                      Coverage check unavailable — {coverage.error}
                    </p>
                  ) : (
                    <p style={{ margin: '6px 0 0' }}>
                      <span className={coverage.active ? 'good' : 'bad'}>{coverage.active ? 'Covered' : 'Not covered'}</span>
                      {coverage.copay && <> · ~${coverage.copay} out of pocket</>}
                      {coverage.priorAuthRequired === 'Y' && <> · <span className="warn">prior auth started</span></>}
                    </p>
                  )}
                </div>
              )}
              {committed && (
                <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
                  {/* the commit can fail (bad creds, bots off) — never let that crash the run */}
                  {committed.error
                    ? `FHIR write unavailable — ${committed.error}. The assembled record above is unaffected.`
                    : committed.dryRun
                      ? committed.note
                      : `Wrote ${Object.keys(committed.ids ?? {}).length} FHIR resources${committed.ids?.DetectedIssue ? ' (incl. DetectedIssue)' : ''} to Medplum.`}
                </p>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: conversation */}
        <div className="card" style={{ minHeight: 380 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>🎙️ Conversation</div>
          {turns.map((t, i) => (
            <div key={i} style={{ margin: '10px 0', textAlign: t.role === 'patient' ? 'right' : 'left' }}>
              <span style={{ display: 'inline-block', padding: '8px 12px', borderRadius: 12, maxWidth: '88%',
                background: t.role === 'patient' ? 'var(--panel-2)' : 'linear-gradient(135deg,#20305e,#3a2a5e)' }}>{t.text}</span>
            </div>
          ))}
          {turns.length === 0 && <p className="muted">Hit 🎙️ Talk to Thaakat for the live voice interview, or ▶ Play demo for the scripted run. Both drive the same engine.</p>}
        </div>
      </div>
    </main>
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// "a, plus b" — Thaakat citing what retrieval actually surfaced from her chart
function joinMentions(m: string[]): string {
  if (m.length === 1) return m[0];
  return `${m.slice(0, -1).join(', ')}, plus ${m[m.length - 1]}`;
}

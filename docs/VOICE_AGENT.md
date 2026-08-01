# Live voice — Deepgram Voice Agent (wired)

The real voice agent is wired. `/intake` has two buttons:

| Button | What it does |
|---|---|
| 🎙️ **Talk to Noor** | Live Deepgram Voice Agent. Real mic → real conversation → drives the real routes. |
| ▶ **Play demo** | The scripted run. Untouched — this is the on-stage fallback if wifi eats the websocket. |

Both drive the **same** cluster engine, the same API routes and the same cards.

## Setup (one thing to get right)

`DEEPGRAM_API_KEY` must be a key with the **Member** role or higher — the browser never sees the
key, it gets a short-lived token from `/api/deepgram/token`, and `/v1/auth/grant` requires Member
scope. A lower-scoped key still works for raw agent sockets, so this fails *only* in the browser,
which is a confusing way to lose 20 minutes. `/api/deepgram/token` returns an explicit message if
the scope is wrong.

Create one at console.deepgram.com → Settings → API Keys.

## How it works

```
mic → linear16 PCM ─┐
                    ├─► Deepgram Voice Agent (STT nova-3 + Claude think + Aura TTS)
speakers ◄─ PCM ────┘              │
                                   ▼  FunctionCallRequest (client_side: true)
                        lib/voice/tools.ts  ──►  our real routes
                                                 /api/moss/query      (criteria + HER record)
                                                 /api/imaging/analyze (the radiomics re-read)
                                                 lib/clusters.ts      (the cluster engine)
                                                 /api/eligibility     (Stedi test mode)
                                                 /api/medplum/commit  (FHIR write)
                                   ◄── FunctionCallResponse
```

Claude decides *when* to call; the deterministic engines decide *what is true*. The cluster match,
the coverage answer and the FHIR write are never the model's opinion.

### The six tools (`lib/voice/agent-settings.ts`)

| Tool | Runs |
|---|---|
| `retrieve_criteria` | Moss over criteria **and** her own record, so Noor can cite the actual document mid-question. Called every turn — this is the retrieval-heavy story. |
| `record_symptom` | What she says becomes a documented `Finding` on the timeline — voice as the sensor. |
| `analyze_imaging` | Re-reads the scan that was called normal (the moat). |
| `assemble_record` | Runs the cluster engine over historical + live findings. |
| `check_eligibility` | Stedi test-mode coverage + `authOrCertIndicator`. |
| `commit_chart` | Writes the picture to Medplum as FHIR. |

### Files

- `lib/voice/agent-settings.ts` — the `Settings` message + tool schemas + prompt
- `lib/voice/audio.ts` — mic capture (AudioWorklet) + gapless playback + barge-in
- `lib/voice/client.ts` — websocket lifecycle and the function-call loop
- `lib/voice/tools.ts` — executes the tools against the real routes
- `app/intake/LiveVoice.tsx` — the button + status; drives the page's cards

## Verified against the live API

`Welcome → SettingsApplied → greeting synthesized → FunctionCallRequest(retrieve_criteria,
client_side:true) → FunctionCallResponse accepted → agent asked the retrieved follow-up.`
Safety framing held ("deserves a closer look", no condition named).

## Notes

- **Barge-in** is real: `UserStartedSpeaking` calls `AudioPlayer.interrupt()`, killing queued TTS.
- **Sample rate**: we send the capture `AudioContext`'s *actual* rate in `Settings`, because
  browsers may ignore a requested rate and a mismatch means chipmunk audio.
- **STT** is `nova-3` + `keyterms` (endometriosis, dyspareunia, CA-125…) so clinical vocab doesn't
  get mangled into a missed cluster tag. Swap to `flux-general-en` + `version: "v2"` in
  `buildSettings` if you want to demo Flux's eager endpointing instead.
- Tools never throw — a failed tool returns an error payload the agent talks around, rather than
  leaving Deepgram waiting on a response that never comes.
- Synthetic patients only. Deepgram BAA is Enterprise-only; never real PHI.

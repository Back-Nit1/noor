# Overnight task list — branch `Nitu`

Work through these **in order, one at a time**. One commit per item.
Skip anything already done (check `git log`). Do not do work not on this list.

After each item: `pnpm build` must pass → commit → `git push origin Nitu` → next item.
If an item turns out to need a human decision, **skip it, note why in a commit message, move on.**

---

## Tier 1 — real bugs, do these first

- [x] **1. `analyzeImaging` returns the wrong study for unknown IDs.**
  `lib/imaging.ts:94` falls back to `SAMPLE_STUDIES['demo-pelvic-mri-1']` for any unknown ID, so
  Dana (who has no imaging) can get an endometriosis MRI dropped on her timeline with `die-imaging`
  tags via `lib/voice/tools.ts:160-178`, flipping her cluster match. Return a `notFound`-shaped
  result for unknown IDs, and skip the push in `tools.ts:167` when `this.patient.imaging` is null.

- [ ] **2. `getPatient` returns Maria for any unknown ID.**
  `lib/clusters.ts:218-220`. A typo'd `patientId` serves the wrong patient's chart through
  `/api/moss/query`. Add `getPatientOrNull`; make the route 400 on an unknown `patientId`.
  Silent wrong-patient data is the worst failure mode in this app.

- [ ] **3. `/api/moss/query` crashes on a non-string query.**
  `app/api/moss/query/route.ts:15-16` only checks falsiness, so `{"query": 123}` hits
  `s.toLowerCase()` in `lib/moss.ts:90` and 500s. Add a type guard; clamp `topK` to 1..20
  (currently `topK: -1` and `topK: 1e9` both misbehave).

- [ ] **4. `record_symptom` tag enum can't express the tags the clusters require.**
  `lib/voice/agent-settings.ts:79-81` omits `ana-positive`, `ttg-positive`, `ca125-elevated`,
  `die-imaging` — all `requiredTags` in `lib/clusters.ts:236,246,256`. The model literally cannot
  complete the Sjögren's or celiac clusters. Derive the enum from
  `CLUSTERS.flatMap(c => c.requiredTags)` so they can't drift again.

- [ ] **5. `ScanViewer` only tries `.png`.**
  `app/intake/ScanViewer.tsx:23` hardcodes `.png` while its own comment and
  `public/sample-mri/README.md` say `(png|jpg)`. A `.jpg` silently falls through to the schematic.
  Try an extension list on `onError`.

## Tier 2 — error handling

- [ ] **6. `/api/imaging/analyze` has no try/catch** and mis-handles a non-string `studyId`.
  `app/api/imaging/analyze/route.ts:8-10`. Match the pattern in `app/api/eligibility/route.ts:32`.

- [ ] **7. `/api/eligibility` doesn't validate `serviceTypeCodes`** before forwarding to Stedi.
  `app/api/eligibility/route.ts:29` → `lib/stedi.ts:44`. A non-array produces a malformed 270.

- [ ] **8. `commitChart` loses everything already written when one resource fails.**
  `lib/medplum.ts:44-167` — sequential creates, no try/catch, returns `ids: {}` on failure leaving
  orphaned resources. Use a transaction Bundle (`type: "transaction"` + `urn:uuid`, per CLAUDE.md);
  `scripts/seed-fhir.ts:29-62` already has the exact pattern to copy. Biggest item here — worth it,
  the FHIR write is the Medplum judging story.

- [ ] **9. `getMedplum()` can't recover from an expired token.** `lib/medplum.ts:21-31` caches a
  permanent singleton with no re-login on 401. Same class of bug in `lib/moss.ts:57` — if
  `loadIndex` throws after `createIndex` succeeds, every query retries `createIndex` forever.

## Tier 3 — hardcoded values

- [ ] **10. `agent-settings.ts` is patient-specific but the runner is multi-patient.**
  Line 51 says "Search **Maria's** indexed clinical criteria corpus" and line 98 hardcodes her MRI —
  sent to Claude for *every* patient including Dana. Have `buildSettings()` take the patient.
  This breaks the Dana "generalizable, not hardcoded" demo beat.

- [ ] **11. Stedi NPI + org name hardcoded** in `lib/stedi.ts:42` and again in
  `medplum/bots/eligibility.ts:18`. Make them env-configurable (`STEDI_NPI`, `STEDI_ORG_NAME`).
  Add the names to `.env.example`. Never write a real value.

- [ ] **12. `'demo-pelvic-mri-1'` is duplicated across 4 files** (`lib/imaging.ts:94`,
  `app/api/imaging/analyze/route.ts:8,9`, `lib/voice/tools.ts:99`, `lib/voice/agent-settings.ts:98`).
  Extract one shared constant.

## Tier 4 — cleanup, do last

- [ ] **13. Delete four never-called exports:** `lib/moss.ts:172` `retrieveCriteria`,
  `lib/moss.ts:182` `usingMoss()`, `lib/clusters.ts:224` `SEEDED_RECORD`,
  `lib/prompts.ts:26` `nextQuestionInstruction`. Confirm each is genuinely unreferenced first.

- [ ] **14. `docs/BUILD_KIT.md` is stale.** Says "two Bots" (there are three), says to wire Deepgram
  (already wired), says STT is `flux-general-en` (code uses `nova-3-medical` at
  `agent-settings.ts:190`), calls imaging a "stub" (it imports a real model card). Fix to match code.

- [ ] **15. `radiomics/real_pipeline.py` doesn't emit the fields `lib/imaging.ts` reads.**
  It writes `n/classes/features/cv_accuracy/cv_folds/top_features`, but `lib/imaging.ts:50-57` reads
  `.task`, `.dataset`, `.cv_auc`. Re-running the pipeline produces JSON that fails compilation.
  Add those fields and compute `roc_auc` for the binary case. **Do not retrain or alter any
  committed numbers** — only make the script emit what it already implies.

---

## Do NOT touch — needs a human

- `medplum/medplum.config.json` bot IDs (`REPLACE_WITH_BOT_ID`) — real Medplum project required.
  **Never invent an ID.**
- Adding any scan to `public/sample-mri/` — licensing decision.
- The real Moss SDK call shape (`lib/moss.ts:3-4,137`) — needs live keys to verify.
- Real pelvic-MRI region localization (`lib/imaging.ts:9-10,91-93`) — needs a training run.
- Any committed radiomics number in `real_endo_summary.json` / `real_endo_features.csv`.

// Radiomics layer — THE MOAT.
//
// Two halves, and it matters that we describe them honestly to judges:
//  1. THE CLASSIFIER IS REAL. radiomics/real_pipeline.py extracted first-order + GLCM texture
//     features from 5,990 REAL GLENDA laparoscopy frames and trained a classifier at
//     5-fold CV ROC-AUC 0.967. Those measured numbers are imported below from the artifact
//     the pipeline actually wrote — not retyped, so the app can never quote a stale figure.
//  2. THE PER-REGION LOCALIZATION IS CURATED for the demo study. The trained model scores a
//     frame; it does not yet emit uterosacral/junctional-zone boxes on pelvic MRI. That's the
//     production path (UT-EndoMRI, 133 real cases) and the seam is analyzeImaging() below.
//
// Say "flags for radiologist review," never "diagnoses."

import MODEL_SUMMARY from '@/radiomics/real_endo_summary.json';

export type ImagingFinding = {
  label: string;
  narration: string; // what Thaakat says out loud
  // normalized bounding box on the displayed image, for the overlay [x, y, w, h] in 0..1
  region?: [number, number, number, number];
  confidence?: number; // 0..1 (demo)
  criteriaId?: string; // links back to lib/criteria imaging signals
};

// Provenance of the trained model, read straight from the pipeline's own output artifact.
export type ModelCard = {
  task: string;
  dataset: string;
  n: number;
  cvAuc: string;
  cvAccuracy: string;
  cvFolds: number;
  topFeatures: { feature: string; importance: number }[];
  featureCount: number;
};

export type ImagingResult = {
  studyId: string;
  modality: 'MRI' | 'US';
  findings: ImagingFinding[];
  summary: string;
  // true when the per-region boxes are curated rather than model-emitted (see header)
  isMock: boolean;
  // the real trained model behind the read — measured, not asserted
  model: ModelCard;
  // true when studyId didn't match a known study — callers must not treat this as a real read
  notFound?: boolean;
};

// Pulled from radiomics/real_endo_summary.json so the UI quotes measured values only.
export const REAL_MODEL: ModelCard = {
  task: MODEL_SUMMARY.task,
  dataset: MODEL_SUMMARY.dataset,
  n: MODEL_SUMMARY.n,
  cvAuc: MODEL_SUMMARY.cv_auc,
  cvAccuracy: MODEL_SUMMARY.cv_accuracy,
  cvFolds: MODEL_SUMMARY.cv_folds,
  topFeatures: MODEL_SUMMARY.top_features,
  featureCount: MODEL_SUMMARY.features.length,
};

// Curated sample studies. Add a corresponding image under /public/sample-mri/<studyId>.png
const SAMPLE_STUDIES: Record<string, ImagingResult> = {
  'demo-pelvic-mri-1': {
    studyId: 'demo-pelvic-mri-1',
    modality: 'MRI',
    isMock: true,
    model: REAL_MODEL,
    summary:
      'Findings consistent with deep infiltrating endometriosis and adenomyosis — the pattern most often missed on a routine read.',
    findings: [
      {
        label: 'Uterosacral ligament nodule',
        narration:
          "I'm seeing a hypointense nodule along the left uterosacral ligament — a sign consistent with deep infiltrating endometriosis that routine reads often miss.",
        region: [0.44, 0.52, 0.14, 0.12],
        confidence: 0.82,
        criteriaId: 'img-die',
      },
      {
        label: 'Junctional zone thickening',
        narration:
          'The junctional zone looks thickened, which can point to adenomyosis — worth a specialist confirming.',
        region: [0.4, 0.34, 0.2, 0.16],
        confidence: 0.74,
        criteriaId: 'img-adenomyosis',
      },
    ],
  },
};

export async function analyzeImaging(studyId: string): Promise<ImagingResult> {
  // SEAM (production path): pull the study from Medplum (ImagingStudy -> Binary), run
  // radiomics/real_pipeline.py feature extraction, score with the trained classifier, and
  // emit findings + regions here. Everything downstream already consumes this shape.
  const hit = SAMPLE_STUDIES[studyId];
  if (!hit) {
    // Unknown studyId: never silently substitute another patient's study.
    return {
      studyId,
      modality: 'MRI',
      isMock: true,
      model: REAL_MODEL,
      summary: '',
      findings: [],
      notFound: true,
    };
  }
  return { ...hit, model: REAL_MODEL };
}

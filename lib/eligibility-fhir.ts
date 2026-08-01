// Stedi 270/271 -> canonical FHIR R4 coverage resources.
//
// Why this exists: we were asking Stedi about coverage the quick way (browser -> our route ->
// Stedi) and rendering "Covered · $15". That throws away the part that actually reads as real
// healthcare engineering -- the CoverageEligibilityRequest we sent and the
// CoverageEligibilityResponse we got back, with the benefits broken out in insurance[].item[].
//
// Both the API route and medplum/bots/eligibility.ts map through here so the two paths can
// never drift apart.
//
// FHIR R4 only. Cardinality notes for the required elements, since they're easy to get wrong:
//   CoverageEligibilityRequest:  status, purpose, patient, created, insurer, insurance[].coverage
//   CoverageEligibilityResponse: status, purpose, patient, created, request, outcome, insurer,
//                                insurance[].coverage, and benefit[].type inside an item
// Reference-by-display is used for the demo org/coverage rather than inventing ids.

import type {
  CoverageEligibilityRequest,
  CoverageEligibilityResponse,
  CoverageEligibilityResponseInsuranceItem,
  CoverageEligibilityResponseInsuranceItemBenefit,
  Money,
  Patient,
  Reference,
} from '@medplum/fhirtypes';

// One entry of Stedi's 271 `benefitsInformation` array. Everything is optional on purpose --
// payers return wildly different subsets and we must not crash on a missing field.
export type StediBenefit = {
  code?: string;
  name?: string;
  benefitAmount?: string;
  benefitPercent?: string;
  authOrCertIndicator?: string;
  planCoverage?: string;
  coverageLevel?: string;
  inPlanNetworkIndicator?: string;
  serviceTypeCodes?: string[];
  serviceTypes?: string[];
};

export type EligibilityContext = {
  serviceTypeCodes: string[];
  payerName: string;
  patientDisplay: string;
  /** what the coverage is being checked FOR, e.g. the cluster's confirmatory test */
  serviceDisplay?: string;
  /** Reference to a real Patient once one exists; falls back to display-only for the demo */
  patient?: Reference<Patient>;
  created: string;
};

// ⚠️ X12 service-type codes (30 = health benefit plan coverage) are emitted WITHOUT a system
// URI on purpose: a bare code is valid FHIR, and inventing a system URI here is exactly the
// kind of hallucinated terminology that should never reach a chart. Flag for human review
// before this is anything other than a demo.
function serviceCategory(codes: string[], display?: string) {
  return {
    coding: codes.map((code) => ({ code })),
    text: display ?? `X12 service type ${codes.join(', ')} — verify coding before clinical use`,
  };
}

function money(amount?: string): Money | undefined {
  if (!amount) return undefined;
  const value = Number.parseFloat(amount);
  return Number.isFinite(value) ? { value, currency: 'USD' } : undefined;
}

/** The 270 we sent, as FHIR. */
export function toEligibilityRequest(ctx: EligibilityContext): CoverageEligibilityRequest {
  return {
    resourceType: 'CoverageEligibilityRequest',
    status: 'active',
    purpose: ['benefits', 'auth-requirements'],
    patient: ctx.patient ?? { display: ctx.patientDisplay },
    created: ctx.created,
    insurer: { display: ctx.payerName },
    provider: { display: 'Thaakat Health (demo provider)' },
    insurance: [{ focal: true, coverage: { display: `${ctx.payerName} coverage (test mode)` } }],
    item: [
      {
        category: serviceCategory(ctx.serviceTypeCodes, ctx.serviceDisplay),
      },
    ],
  };
}

/** The 271 we got back, as FHIR — this is the resource worth putting on screen. */
export function toEligibilityResponse(
  benefits: StediBenefit[],
  ctx: EligibilityContext,
  opts: { active: boolean; requestRef?: Reference<CoverageEligibilityRequest> },
): CoverageEligibilityResponse {
  // Every benefit line that carries an amount becomes a benefit entry, so the payload shows
  // the actual copay/deductible/out-of-pocket breakdown rather than a single number.
  const benefitEntries: CoverageEligibilityResponseInsuranceItemBenefit[] = benefits.flatMap((b) => {
    const allowed = money(b.benefitAmount);
    if (!allowed) return [];
    return [{ type: { text: b.name ?? b.code ?? 'Benefit' }, allowedMoney: allowed }];
  });

  // authOrCertIndicator: Y = prior auth required, N = not required, U = undetermined.
  const authFlag = benefits.map((b) => b.authOrCertIndicator).find((v) => v === 'Y' || v === 'N' || v === 'U');

  const inNetwork = benefits.find((b) => b.inPlanNetworkIndicator)?.inPlanNetworkIndicator;

  const item: CoverageEligibilityResponseInsuranceItem = {
    category: serviceCategory(ctx.serviceTypeCodes, ctx.serviceDisplay),
    ...(inNetwork ? { network: { text: inNetwork === 'Y' ? 'In network' : 'Out of network' } } : {}),
    // only assert authorizationRequired when the payer actually said Y or N; "U" and a missing
    // indicator both mean undetermined, and false would be a claim the payer never made
    ...(authFlag === 'Y' || authFlag === 'N' ? { authorizationRequired: authFlag === 'Y' } : {}),
    ...(benefitEntries.length ? { benefit: benefitEntries } : {}),
  };

  return {
    resourceType: 'CoverageEligibilityResponse',
    status: 'active',
    purpose: ['benefits', 'auth-requirements'],
    patient: ctx.patient ?? { display: ctx.patientDisplay },
    created: ctx.created,
    outcome: 'complete',
    insurer: { display: ctx.payerName },
    ...(opts.requestRef ? { request: opts.requestRef } : { request: { display: 'CoverageEligibilityRequest (unpersisted)' } }),
    insurance: [
      {
        coverage: { display: `${ctx.payerName} coverage (test mode)` },
        inforce: opts.active,
        item: [item],
      },
    ],
  };
}

/** Human-readable payer name for the demo's Stedi test identities. */
export const PAYER_NAMES: Record<string, string> = {
  aetna: 'Aetna (Stedi test mode)',
  uhc: 'UnitedHealthcare (Stedi test mode)',
  uhcInactive: 'UnitedHealthcare (Stedi test mode — inactive member)',
};

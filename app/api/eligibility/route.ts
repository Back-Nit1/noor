import { NextRequest, NextResponse } from 'next/server';
import type { CoverageEligibilityRequest, CoverageEligibilityResponse, Reference } from '@medplum/fhirtypes';
import { checkEligibility, MOCK_PATIENTS } from '@/lib/stedi';
import { PAYER_NAMES, toEligibilityRequest, toEligibilityResponse, type StediBenefit } from '@/lib/eligibility-fhir';
import { getMedplum } from '@/lib/medplum';

export const runtime = 'nodejs';

// POST { patient?: "aetna" | "uhc" | "uhcInactive", serviceTypeCodes?: string[], serviceDisplay?: string }
//
// Uses Stedi TEST MODE mock payers, then maps the 271 into the canonical FHIR pair --
// CoverageEligibilityRequest + CoverageEligibilityResponse -- so the demo can show the
// insurance[].item[] payload rather than a bare "covered / $15".
//
// Persisting to Medplum is best-effort and deliberately non-fatal: the coverage answer is
// useful on its own, and a Medplum outage must never take out the coverage step of the demo.
export async function POST(req: NextRequest) {
  const key = process.env.STEDI_API_KEY;
  const body = await req.json().catch(() => ({}));
  const which = (body.patient as keyof typeof MOCK_PATIENTS) ?? 'aetna';
  const patient = MOCK_PATIENTS[which] ?? MOCK_PATIENTS.aetna;
  const serviceTypeCodes: string[] = body.serviceTypeCodes?.length ? body.serviceTypeCodes : ['30'];

  const ctx = {
    serviceTypeCodes,
    payerName: PAYER_NAMES[which] ?? 'Payer (Stedi test mode)',
    patientDisplay: `${patient.subscriber.firstName} ${patient.subscriber.lastName} (synthetic)`,
    serviceDisplay: body.serviceDisplay as string | undefined,
    created: new Date().toISOString(),
  };

  // graceful demo fallback if the key isn't set yet — still shaped as real FHIR
  if (!key) {
    const benefits: StediBenefit[] = [
      { code: 'B', name: 'Co-Payment', benefitAmount: '210', authOrCertIndicator: 'Y' },
    ];
    return NextResponse.json({
      active: true,
      planName: 'CHOICE PLUS (demo)',
      copay: '210',
      priorAuthRequired: 'Y',
      request: toEligibilityRequest(ctx),
      response: toEligibilityResponse(benefits, ctx, { active: true }),
      persisted: false,
      _note: 'STEDI_API_KEY not set — returning demo coverage. Set the key for a real test-mode call.',
    });
  }

  try {
    const result = await checkEligibility({ apiKey: key, patient, serviceTypeCodes });
    const benefits = ((result.raw as any)?.benefitsInformation ?? []) as StediBenefit[];

    let request = toEligibilityRequest(ctx);
    let response = toEligibilityResponse(benefits, ctx, { active: result.active });

    // Best-effort: write both resources so they can be opened inside Medplum.
    let persisted = false;
    let medplumError: string | undefined;
    try {
      const medplum = await getMedplum();
      if (medplum) {
        const savedRequest = await medplum.createResource<CoverageEligibilityRequest>(request);
        const requestRef = {
          reference: `CoverageEligibilityRequest/${savedRequest.id}`,
        } as Reference<CoverageEligibilityRequest>;
        const savedResponse = await medplum.createResource<CoverageEligibilityResponse>(
          toEligibilityResponse(benefits, ctx, { active: result.active, requestRef }),
        );
        request = savedRequest;
        response = savedResponse;
        persisted = true;
      }
    } catch (e) {
      medplumError = (e as Error).message;
    }

    // `raw` is dropped from the payload: it's the full 271 and only bloats the response.
    const { raw: _raw, ...summary } = result;
    return NextResponse.json({ ...summary, request, response, persisted, medplumError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

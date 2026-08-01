// Medplum Bot: on a CoverageEligibilityRequest, call Stedi (test mode) and write a
// CoverageEligibilityResponse. Store the Stedi test key as a Bot Secret named STEDI_API_KEY.
// Stedi has NO 278 API — the caller models prior auth as Claim(use="preauthorization") separately.
import { BotEvent, MedplumClient, createReference } from '@medplum/core';
import type { CoverageEligibilityRequest, CoverageEligibilityResponse } from '@medplum/fhirtypes';
// Same 271 -> FHIR mapping the /api/eligibility route uses, so the bot and the route can't drift.
import { toEligibilityResponse, type StediBenefit } from '../../lib/eligibility-fhir';

const STEDI_URL = 'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3';

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<CoverageEligibilityRequest>,
): Promise<CoverageEligibilityResponse> {
  const request = event.input;
  const stediKey = event.secrets['STEDI_API_KEY']?.valueString;

  // Demo default: Aetna test patient. In a real build, map request.patient -> member identifiers.
  const stediBody = {
    provider: { npi: '1999999984', organizationName: 'Thaakat Health' },
    subscriber: { firstName: 'Jane', lastName: 'Doe', dateOfBirth: '20040404', memberId: 'AETNA12345' },
    encounter: { serviceTypeCodes: ['30'] },
    tradingPartnerServiceId: '60054',
  };

  let benefits: StediBenefit[] = [];
  let active = true;
  if (stediKey) {
    const data: any = await fetch(STEDI_URL, {
      method: 'POST',
      headers: { Authorization: stediKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(stediBody),
    }).then((r) => r.json());
    benefits = (data.benefitsInformation ?? []) as StediBenefit[];
    active = benefits.some((b) => b.code === '1') || (data.status ?? '').toLowerCase() === 'active';
  }

  // The shared mapper emits the full insurance[].item[] benefit breakdown, and only asserts
  // authorizationRequired when the payer actually said Y or N (the old inline version wrote
  // `false` whenever the answer was "undetermined", which is a claim the payer never made).
  const response = toEligibilityResponse(
    benefits,
    {
      serviceTypeCodes: ['30'],
      payerName: request.insurer?.display ?? 'Aetna (Stedi test mode)',
      patient: request.patient,
      patientDisplay: request.patient?.display ?? 'Jane Doe (synthetic)',
      created: new Date().toISOString(),
    },
    { active, requestRef: createReference(request) },
  );

  return medplum.createResource<CoverageEligibilityResponse>(response);
}

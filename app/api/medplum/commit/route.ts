import { NextRequest, NextResponse } from 'next/server';
import { commitChart, type ChartInput } from '@/lib/medplum';

export const runtime = 'nodejs';

// POST ChartInput -> writes Condition/Observations/DiagnosticReport/ServiceRequest/Claim(preauth)/Task
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ChartInput;
  try {
    const result = await commitChart({
      symptoms: body.symptoms ?? [],
      imagingFindings: body.imagingFindings,
      referral: body.referral,
      priorAuthRequired: body.priorAuthRequired,
      // the assembled pattern -> DetectedIssue. Dropping this silently skipped the
      // single resource the whole record-assembly story rests on.
      cluster: body.cluster,
      patientName: body.patientName,
      patientId: body.patientId,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

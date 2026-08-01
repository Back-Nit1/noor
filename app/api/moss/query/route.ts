import { NextRequest, NextResponse } from 'next/server';
import { retrieveContext, usingMoss } from '@/lib/moss';

export const runtime = 'nodejs';

// POST { query: string, patientId?: string, topK?: number }
// -> ranked context over BOTH the diagnostic criteria and the patient's own record
//    (Moss <10ms, or local fallback). Record docs are scoped to the requested patient.
export async function POST(req: NextRequest) {
  const { query, patientId, topK } = await req.json().catch(() => ({ query: '' }));
  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });
  const t0 = Date.now();
  const results = await retrieveContext(query, { topK: topK ?? 4, patientId });
  return NextResponse.json({
    results,
    backend: usingMoss() ? 'moss' : 'local-fallback',
    ms: Date.now() - t0,
  });
}

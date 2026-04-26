import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createReadyToShipPdf, getReadyToShipReport } from '@/lib/harness-ready-to-ship'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const report = await getReadyToShipReport({
      tenant: request.nextUrl.searchParams.get('tenant'),
      profile: request.nextUrl.searchParams.get('profile'),
    })
    const pdf = createReadyToShipPdf(report)
    const pdfBuffer = Buffer.from(pdf)
    const body = pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength)
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="checklist-${report.tenant}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export checklist PDF' },
      { status: 500 },
    )
  }
}

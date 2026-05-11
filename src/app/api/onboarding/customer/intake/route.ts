import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  CUSTOMER_INTAKE_MAX_BYTES,
  IntakeStructuredData,
  isAllowedCustomerIntakeFile,
  normalizeCustomerTenantId,
  writeCustomerIntake,
} from '@/lib/customer-intake'

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as File).name === 'string' &&
    typeof (value as File).size === 'number' &&
    typeof (value as File).type === 'string',
  )
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  if (typeof file.arrayBuffer === 'function') {
    return new TextDecoder().decode(await file.arrayBuffer())
  }
  return ''
}

function parseIntakeData(raw: string | null): IntakeStructuredData | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as IntakeStructuredData
  } catch {
    return undefined
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return errorResponse('Expected multipart/form-data upload')
  }

  const tenantIdRaw = formData.get('tenant_id')
  const tenantNameRaw = formData.get('tenant_name')
  const summaryRaw = formData.get('summary')
  const intakeDataRaw = formData.get('intake_data')
  const file = formData.get('file')

  let tenantId: string
  try {
    tenantId = normalizeCustomerTenantId(tenantIdRaw)
  } catch (error: any) {
    return errorResponse(error?.message || 'Invalid tenant_id')
  }

  const intakeData = parseIntakeData(typeof intakeDataRaw === 'string' ? intakeDataRaw : null)

  // File is now optional — structured data alone is enough
  let fileName: string | undefined
  let fileType: string | undefined
  let fileSize: number | undefined
  let originalText: string | undefined

  if (isUploadedFile(file) && file.size > 0) {
    if (file.size > CUSTOMER_INTAKE_MAX_BYTES) return errorResponse('file exceeds 100MB limit', 413)
    if (!isAllowedCustomerIntakeFile(file.name, file.type)) {
      return errorResponse('file type must be audio/* or text/*')
    }
    fileName = file.name
    fileType = file.type || 'application/octet-stream'
    fileSize = file.size
    const isText = file.type.toLowerCase().startsWith('text/') || /\.(md|txt)$/i.test(file.name)
    if (isText) originalText = await readFileText(file)
  }

  // Must have at least structured data or a file
  if (!intakeData && !fileName) {
    return errorResponse('Please provide intake questions (C1-C6 / S1-S6) or upload a file')
  }

  try {
    const result = await writeCustomerIntake({
      tenantId,
      tenantName: typeof tenantNameRaw === 'string' ? tenantNameRaw : '',
      fileName,
      fileType,
      fileSize,
      uploadedBy: auth.user.username,
      summary: typeof summaryRaw === 'string' ? summaryRaw : '',
      originalText,
      intakeData,
    })

    return NextResponse.json({
      ok: true,
      tenant_id: result.tenantId,
      path: result.relativePath,
      content: result.content,
    })
  } catch (error: any) {
    return errorResponse(error?.message || 'Failed to write intake-raw.md', 500)
  }
}

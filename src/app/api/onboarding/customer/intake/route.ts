import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  CUSTOMER_INTAKE_MAX_BYTES,
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
  const file = formData.get('file')

  let tenantId: string
  try {
    tenantId = normalizeCustomerTenantId(tenantIdRaw)
  } catch (error: any) {
    return errorResponse(error?.message || 'Invalid tenant_id')
  }

  if (!isUploadedFile(file)) return errorResponse('file is required')
  if (file.size <= 0) return errorResponse('file must not be empty')
  if (file.size > CUSTOMER_INTAKE_MAX_BYTES) return errorResponse('file exceeds 100MB limit', 413)
  if (!isAllowedCustomerIntakeFile(file.name, file.type)) {
    return errorResponse('file type must be audio/* or text/*')
  }

  const isText = file.type.toLowerCase().startsWith('text/') || /\.(md|txt)$/i.test(file.name)
  const originalText = isText ? await readFileText(file) : undefined

  try {
    const result = await writeCustomerIntake({
      tenantId,
      tenantName: typeof tenantNameRaw === 'string' ? tenantNameRaw : '',
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      uploadedBy: auth.user.username,
      summary: typeof summaryRaw === 'string' ? summaryRaw : '',
      originalText,
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

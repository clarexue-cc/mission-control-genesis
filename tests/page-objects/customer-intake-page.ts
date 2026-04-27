import type { Page } from '@playwright/test'

export class CustomerIntakePage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/onboarding/customer')
  }

  async uploadIntake(params: {
    tenantId: string
    tenantName?: string
    summary?: string
    filePath: string
  }) {
    await this.page.getByLabel('Tenant ID').fill(params.tenantId)
    await this.page.getByLabel('Tenant 名称').fill(params.tenantName || '')
    await this.page.getByLabel('用户输入摘要').fill(params.summary || '')
    await this.page.getByLabel('上传访谈文件').setInputFiles(params.filePath)
    await this.page.getByRole('button', { name: /确认上传/ }).click()
  }

  preview() {
    return this.page.getByText('intake-raw.md 预览')
  }
}

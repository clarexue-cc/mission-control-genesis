import type { Page } from '@playwright/test'

export class CustomerConfirmationPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/onboarding/customer/confirm')
  }

  async sign(params: {
    tenantId: string
    confirmationText?: string
  }) {
    await this.page.getByLabel('Tenant ID').fill(params.tenantId)
    await this.page.getByRole('button', { name: '读取' }).click()
    if (params.confirmationText) {
      await this.page.getByLabel('确认语').fill(params.confirmationText)
    }
    await this.page.getByRole('button', { name: 'Clare 已审阅，确认开始 tenant 部署' }).click()
  }

  confirmationPreview() {
    return this.page.getByText('OB-S3 文件预览')
  }
}

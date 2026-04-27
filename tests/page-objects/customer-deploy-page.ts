import type { Page } from '@playwright/test'

export class CustomerDeployPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/onboarding/customer/deploy')
  }

  async deploy(tenantId: string) {
    await this.page.getByLabel('Tenant ID').fill(tenantId)
    await this.page.getByRole('button', { name: '读取' }).click()
    await this.page.getByRole('button', { name: '触发 new-tenant + Docker 部署' }).click()
  }

  deployResult() {
    return this.page.getByText('部署结果')
  }
}

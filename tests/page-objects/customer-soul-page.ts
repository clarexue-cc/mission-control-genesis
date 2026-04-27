import type { Page } from '@playwright/test'

export class CustomerSoulPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/onboarding/customer/soul')
  }

  async generate(tenantId: string) {
    await this.page.locator('#tenant-id').fill(tenantId)
    await this.page.getByRole('button', { name: '读取' }).click()
    await this.page.getByText('已找到').waitFor()
    await this.page.getByRole('button', { name: '生成 SOUL/AGENTS' }).click()
    await this.page.getByText('占位符残留：0').waitFor()
    await this.page.getByText('SOUL.md').waitFor()
    await this.page.getByText('AGENTS.md').waitFor()
  }

  get placeholderStatus() {
    return this.page.getByText('占位符残留：0')
  }
}

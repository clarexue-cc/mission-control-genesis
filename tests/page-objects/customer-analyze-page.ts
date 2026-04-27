import type { Page } from '@playwright/test'

export class CustomerAnalyzePage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/onboarding/customer/analyze')
  }

  async analyze(tenantId: string) {
    await this.page.locator('#tenant-id').fill(tenantId)
    await this.page.getByRole('button', { name: '读取' }).click()
    await this.page.getByText('已找到').waitFor()
    await this.page.getByRole('button', { name: 'AI 分析' }).click()
    await this.page.getByText('intake-analysis.md 预览').waitFor()
    await this.page.getByText('mock-fallback').waitFor()
  }

  get analysisResult() {
    return this.page.getByText('## 候选 Skills')
  }
}

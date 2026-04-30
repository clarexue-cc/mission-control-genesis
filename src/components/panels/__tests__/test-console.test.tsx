import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TestConsolePanel } from '@/components/panels/test-console'

describe('TestConsolePanel', () => {
  it('labels the page as the P10 test console', () => {
    render(<TestConsolePanel />)

    expect(screen.getByRole('heading', { name: 'P10 Test Console', level: 1 })).toBeInTheDocument()
  })

  it('exposes all P10 test suites', () => {
    render(<TestConsolePanel />)

    expect(screen.getByRole('button', { name: /Golden\s+10/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Adversarial\s+25/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cross-session\s+3/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Drift\s+8/ })).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TestConsolePanel } from '@/components/panels/test-console'

describe('TestConsolePanel', () => {
  it('labels the page as the P10 test console', () => {
    render(<TestConsolePanel />)

    expect(screen.getByRole('heading', { name: 'P10 Test Console', level: 1 })).toBeInTheDocument()
  })
})

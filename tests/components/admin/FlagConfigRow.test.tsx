/**
 * Component: Flag Config Row Tests
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FlagConfigRow } from '@/components/admin/FlagConfigRow';
import type { IndexerFlagConfig } from '@/lib/utils/ranking-algorithm';

describe('FlagConfigRow', () => {
  it('updates name and modifier values and allows removal', () => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    const config: IndexerFlagConfig = { name: 'Freeleech', modifier: 20 };

    render(<FlagConfigRow config={config} onChange={onChange} onRemove={onRemove} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Internal' } });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '-15' } });
    fireEvent.click(screen.getByTitle('Remove flag rule'));

    expect(onChange).toHaveBeenCalledWith({ name: 'Internal', modifier: 20 });
    expect(onChange).toHaveBeenCalledWith({ name: 'Freeleech', modifier: -15 });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('shows disqualification warning for large negative modifiers', () => {
    render(
      <FlagConfigRow
        config={{ name: 'Bad', modifier: -60 }}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByText(/Would disqualify/i)).toBeInTheDocument();
  });
});

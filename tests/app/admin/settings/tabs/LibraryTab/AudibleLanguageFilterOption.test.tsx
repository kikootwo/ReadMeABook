/**
 * Component: Audible Language Filter Option Tests
 * Documentation: documentation/settings-pages.md
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AudibleLanguageFilterOption } from '@/app/admin/settings/tabs/LibraryTab/AudibleLanguageFilterOption';
import type { Settings } from '@/app/admin/settings/lib/types';

describe('AudibleLanguageFilterOption', () => {
  it('reflects the setting and reports the toggled value', () => {
    const onChange = vi.fn();
    const settings = { audibleLanguageFilter: false } as Settings;

    render(<AudibleLanguageFilterOption settings={settings} onChange={onChange} />);

    const checkbox = screen.getByRole('checkbox', { name: /region's language/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith({ audibleLanguageFilter: true });
  });
});

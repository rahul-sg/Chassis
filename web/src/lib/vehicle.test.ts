import { describe, expect, it } from 'vitest';
import { cleanVin } from './vehicle';

describe('cleanVin', () => {
  it('upper-cases, drops spaces and dashes, and fixes letters VINs never use', () => {
    expect(cleanVin('1hg cm82-633a00 4352')).toBe('1HGCM82633A004352');
    expect(cleanVin('IOQ')).toBe('100');
    expect(cleanVin('1HGCM82633A004352EXTRA')).toHaveLength(17);
  });
});

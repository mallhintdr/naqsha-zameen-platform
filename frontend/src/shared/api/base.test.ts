import { describe, expect, it } from 'vitest';
import { apiUrl, dataUrl } from './base';

describe('api base', () => {
  it('uses same-origin relative paths by default', () => {
    expect(apiUrl('/api/profile')).toBe('/api/profile');
  });
  it('encodes data folders with spaces per segment', () => {
    expect(dataUrl('JSON Murabba', 'Tehsil A', 'Chak 1.geojson')).toBe('/JSON%20Murabba/Tehsil%20A/Chak%201.geojson');
  });
});

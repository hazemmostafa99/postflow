import { BadRequestException } from '@nestjs/common';
import { parseReportRange } from './report-range';

describe('parseReportRange', () => {
  it('defaults to thirty inclusive UTC days', () => {
    const range = parseReportRange(
      undefined,
      undefined,
      new Date('2026-10-04T12:00:00Z'),
    );
    expect(range.from.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-04T23:59:59.999Z');
    expect(range.previousFrom.toISOString()).toBe('2026-08-06T00:00:00.000Z');
    expect(range.previousTo.toISOString()).toBe('2026-09-04T23:59:59.999Z');
  });

  it('rejects inverted and oversized ranges', () => {
    expect(() => parseReportRange('2026-10-04', '2026-10-03')).toThrow(
      BadRequestException,
    );
    expect(() => parseReportRange('2025-01-01', '2026-10-04')).toThrow(
      BadRequestException,
    );
  });

  it('rejects calendar dates that JavaScript would otherwise normalize', () => {
    expect(() => parseReportRange('2026-02-31', '2026-03-31')).toThrow(
      BadRequestException,
    );
  });
});

import { BadRequestException } from '@nestjs/common';

const DEFAULT_REPORT_DAYS = 30;
const MAX_REPORT_DAYS = 366;

export function parseReportRange(from?: string, to?: string, now = new Date()) {
  const end = to ? parseDate(to, 'to', true) : endOfUtcDay(now);
  const start = from
    ? parseDate(from, 'from', false)
    : startOfUtcDay(
        new Date(end.getTime() - (DEFAULT_REPORT_DAYS - 1) * 86_400_000),
      );
  if (start > end) throw new BadRequestException('from must be before to');
  const durationMs = end.getTime() - start.getTime() + 1;
  if (durationMs > MAX_REPORT_DAYS * 86_400_000) {
    throw new BadRequestException(
      `Report range cannot exceed ${MAX_REPORT_DAYS} days`,
    );
  }
  const previousTo = new Date(start.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - durationMs + 1);
  return { from: start, to: end, previousFrom, previousTo };
}

function parseDate(value: string, name: string, end: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${name} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${name} must be a valid date`);
  }
  return date;
}

function startOfUtcDay(value: Date) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfUtcDay(value: Date) {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

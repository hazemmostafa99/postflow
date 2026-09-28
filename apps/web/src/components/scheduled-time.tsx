"use client";

import { useMemo } from "react";

interface ScheduledTimeProps {
  value?: string;
  className?: string;
}

export function ScheduledTime({ value, className }: ScheduledTimeProps) {
  const formatted = useMemo(() => {
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }, [value]);

  if (!value) return <span className={className}>Not scheduled</span>;

  return (
    <time dateTime={value} className={className} title={value}>
      {formatted ?? "Scheduled"}
    </time>
  );
}

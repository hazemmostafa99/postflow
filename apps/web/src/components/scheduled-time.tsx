"use client";

import { useEffect, useState } from "react";

interface ScheduledTimeProps {
  value?: string;
  className?: string;
}

export function ScheduledTime({ value, className }: ScheduledTimeProps) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;

    setFormatted(new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date));
  }, [value]);

  if (!value) return <span className={className}>Not scheduled</span>;

  return (
    <time dateTime={value} className={className} title={value}>
      {formatted ?? "Scheduled"}
    </time>
  );
}

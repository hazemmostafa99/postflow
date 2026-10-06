import { CalendarClock } from "lucide-react";
import type { PostFlowSubscription } from "@/lib/postflow-user";

export function TrialStatusBanner({
  subscription,
}: {
  subscription: PostFlowSubscription | null;
}) {
  if (subscription?.status !== "TRIALING") return null;

  const dayLabel = subscription.daysRemaining === 1 ? "day" : "days";
  const expirationDate = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(subscription.trialEndsAt));

  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3 sm:items-center">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="font-semibold text-foreground">
            Your free trial is active
          </p>
          <p className="mt-0.5 text-muted-foreground">
            Full access through {expirationDate}.
          </p>
        </div>
      </div>
      <span className="w-fit rounded-full border border-primary/20 bg-background px-3 py-1 text-xs font-semibold text-primary">
        {subscription.daysRemaining} {dayLabel} left
      </span>
    </div>
  );
}

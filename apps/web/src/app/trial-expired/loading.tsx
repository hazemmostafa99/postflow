import { Skeleton } from "@/components/ui/skeleton";

export default function TrialExpiredLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card p-8 shadow-sm sm:p-10">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="mt-10 h-10 w-72 max-w-full" />
        <Skeleton className="mt-4 h-4 w-full max-w-xl" />
        <Skeleton className="mt-2 h-4 w-4/5 max-w-lg" />
        <div className="mt-8 flex gap-3">
          <Skeleton className="h-11 w-48" />
          <Skeleton className="h-11 w-24" />
        </div>
      </div>
    </main>
  );
}

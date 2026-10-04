import { Skeleton } from "@/components/ui/skeleton";

export default function ConnectionsLoading() {
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-3 h-8 w-40" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-24" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="surface p-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-4 h-8 w-12" />
            <Skeleton className="mt-2 h-3 w-36" />
          </div>
        ))}
      </div>

      <div className="surface overflow-hidden">
        <div className="flex gap-3 border-b border-border p-4">
          <Skeleton className="h-10 w-full max-w-sm" />
          <Skeleton className="ml-auto h-10 w-44" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="grid gap-4 px-4 py-4 lg:grid-cols-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

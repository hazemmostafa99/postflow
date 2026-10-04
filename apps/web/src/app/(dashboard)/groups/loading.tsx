import { Skeleton } from "@/components/ui/skeleton";

export default function GroupsLoading() {
  return (
    <div className="page-shell">
      <section className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="surface p-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
        ))}
      </section>
      <div className="surface overflow-hidden p-4">
        <Skeleton className="h-10 w-full" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-14 w-full" />)}
        </div>
      </div>
    </div>
  );
}

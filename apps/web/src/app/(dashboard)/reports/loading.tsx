import { Skeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="page-shell">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-7"><Skeleton className="h-80 rounded-xl lg:col-span-5" /><Skeleton className="h-80 rounded-xl lg:col-span-2" /></div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

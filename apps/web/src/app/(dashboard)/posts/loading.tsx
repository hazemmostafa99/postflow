import { FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function PostsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-primary/20 bg-primary/10 p-2">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="mt-2 h-4 w-72" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      <div className="rounded-xl border border-border">
        <div className="grid grid-cols-5 gap-4 border-b border-border bg-muted/40 px-4 py-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-4 w-full" />
          ))}
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="grid grid-cols-5 gap-4 px-4 py-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="ml-auto h-8 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { CheckSquare, ChevronDown, Square, Video } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isTikTokConnectionReady, type TikTokConnection } from "@/lib/tiktok-publishing";

export function TikTokDestinationMenu({ connections, selectedIds, publishingEnabled, mediaError, onToggle, onClear }: {
  connections: TikTokConnection[];
  selectedIds: string[];
  publishingEnabled: boolean;
  mediaError: string | null;
  onToggle: (connection: TikTokConnection) => void;
  onClear: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const readyCount = connections.filter(isTikTokConnectionReady).length;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger type="button" aria-label={selectedIds.length > 0 ? `${selectedIds.length} TikTok accounts selected` : "Choose TikTok accounts"} className="flex min-h-11 w-full items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left shadow-sm transition-colors hover:border-primary/40 focus:outline-none focus:ring-3 focus:ring-ring/20">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-700"><Video className="h-3.5 w-3.5" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{selectedIds.length > 0 ? `${selectedIds.length} TikTok account${selectedIds.length === 1 ? "" : "s"} selected` : "Choose TikTok accounts"}</span><span className="block truncate text-[11px] text-muted-foreground">{readyCount} available</span></span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5"><span className="text-xs font-medium text-muted-foreground">Select TikTok accounts</span>{selectedIds.length > 0 && <button type="button" onClick={onClear} className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear</button>}</div>
          {!publishingEnabled && <p role="status" className="m-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">TikTok publishing is coming soon. Connect your account from the Connections page.</p>}
          {connections.length === 0 ? <p className="px-3 pb-3 text-xs text-muted-foreground">No TikTok account connected.</p> : <div role="listbox" aria-label="TikTok destinations" aria-multiselectable="true" className="max-h-64 space-y-1.5 overflow-y-auto p-2">
            {connections.map((connection) => {
              const ready = isTikTokConnectionReady(connection);
              const selected = selectedIds.includes(connection._id);
              const disabled = !publishingEnabled || !ready;
              const connectionName = connection.extensionName?.trim() || connection.extensionInstanceIdMasked?.trim() || "Chrome profile";
              return <button key={connection._id} type="button" role="option" aria-selected={selected} disabled={disabled} aria-disabled={disabled} onClick={() => onToggle(connection)} title={!publishingEnabled ? "TikTok publishing is coming soon" : ready ? `Use ${connectionName}` : "Verify this account from the Connections page"} className={"flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors " + (selected ? "border-primary/40 bg-primary/10 text-foreground" : disabled ? "cursor-not-allowed border-border bg-muted/30 text-muted-foreground" : "border-border text-foreground hover:border-primary/40 hover:bg-accent")}>
                {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}<span className="min-w-0"><span className="block truncate text-xs font-medium">{connectionName}</span><span className="block text-[11px] text-muted-foreground">{ready ? "Verified" : connection.status.replaceAll("_", " ")}</span></span>
              </button>;
            })}
          </div>}
        </PopoverContent>
      </Popover>
      {selectedIds.length > 0 && mediaError && <p role="alert" className="text-xs text-destructive">{mediaError}</p>}
    </div>
  );
}

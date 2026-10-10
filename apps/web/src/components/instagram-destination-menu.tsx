"use client";

import { useState } from "react";
import { AlertCircle, Camera, CheckCircle2, CheckSquare, ChevronDown, Clock3, Square } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { InstagramMediaSelection } from "@/lib/instagram-publishing";

export interface InstagramConnection {
  _id: string;
  displayName?: string;
  extensionName?: string | null;
  extensionInstanceIdMasked?: string | null;
  activeExtensionInstallationId?: string | null;
  externalAccountId?: string;
  detectedExternalAccountId?: string;
  externalUsername?: string;
  detectedExternalUsername?: string;
  status: string;
  workerStatus: string;
  sessionDetected: boolean;
  sessionEvidenceState?: string;
}

interface InstagramDestinationMenuProps {
  mediaSelection: InstagramMediaSelection;
  connections: InstagramConnection[];
  selectedIds: string[];
  publishingEnabled: boolean;
  onToggle: (connection: InstagramConnection) => void;
  onClear: () => void;
}

function isReady(connection: InstagramConnection): boolean {
  const idVerified = Boolean(connection.externalAccountId && connection.externalAccountId === connection.detectedExternalAccountId);
  const legacyUsernameVerified = Boolean(connection.externalUsername && connection.externalUsername.toLowerCase() === connection.detectedExternalUsername?.toLowerCase());
  return Boolean(connection.status === "CONNECTED" && connection.sessionDetected && (idVerified || legacyUsernameVerified));
}

function getConnectionState(connection: InstagramConnection) {
  if (isReady(connection)) return { label: "Verified", detail: connection.externalAccountId ? "Account identity verified" : `@${connection.externalUsername}`, className: "text-emerald-700", Icon: CheckCircle2 };
  if (connection.status === "ACCOUNT_MISMATCH") return { label: "Account mismatch", detail: "Open the expected account in Instagram", className: "text-amber-700", Icon: AlertCircle };
  if (connection.status === "LOGIN_REQUIRED") return { label: "Sign in required", detail: "Sign in at instagram.com", className: "text-amber-700", Icon: AlertCircle };
  if (connection.sessionEvidenceState === "STALE") return { label: "Verification expired", detail: "Open Instagram to verify the current account", className: "text-amber-700", Icon: Clock3 };
  return { label: "Waiting for extension", detail: "Keep Instagram open in this Chrome profile", className: "text-muted-foreground", Icon: Clock3 };
}

export function InstagramDestinationMenu({ mediaSelection, connections, selectedIds, publishingEnabled, onToggle, onClear }: InstagramDestinationMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const readyCount = connections.filter(isReady).length;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger type="button" aria-label={selectedIds.length > 0 ? `${selectedIds.length} Instagram accounts selected` : "Choose Instagram accounts"} className="flex min-h-11 w-full items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left shadow-sm transition-colors hover:border-primary/40 focus:outline-none focus:ring-3 focus:ring-ring/20">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-pink-50 text-pink-700"><Camera className="h-3.5 w-3.5" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">{selectedIds.length > 0 ? `${selectedIds.length} Instagram account${selectedIds.length === 1 ? "" : "s"} selected` : "Choose Instagram accounts"}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{readyCount} available</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5"><span className="text-xs font-medium text-muted-foreground">Select Instagram accounts</span>{selectedIds.length > 0 && <button type="button" onClick={onClear} className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear</button>}</div>
          <div className="p-2"><div role="status" className={"rounded-lg border px-3 py-2 text-[11px] leading-relaxed " + (publishingEnabled ? "border-emerald-200 bg-emerald-50/70 text-emerald-800" : "border-amber-200 bg-amber-50/80 text-amber-800")}>{publishingEnabled ? `${readyCount} verified account${readyCount === 1 ? "" : "s"} available. Select one to publish.` : "Instagram is connected, but publishing is still in live validation. The account will unlock here when the rollout is approved."}</div></div>
          {connections.length === 0 ? <div className="px-3 pb-3 text-center text-xs text-muted-foreground">Connect Instagram from the Connections page first.</div> : <div role="listbox" aria-label="Instagram destinations" aria-multiselectable="true" className="max-h-64 space-y-1.5 overflow-y-auto px-2 pb-2">
            {connections.map((connection) => {
              const ready = isReady(connection);
              const selected = selectedIds.includes(connection._id);
              const disabled = !publishingEnabled || !ready;
              const state = getConnectionState(connection);
              const StateIcon = state.Icon;
              const connectionName = connection.extensionName?.trim() || connection.extensionInstanceIdMasked?.trim() || "Chrome profile";
              return <button key={connection._id} type="button" role="option" aria-selected={selected} aria-disabled={disabled} disabled={disabled} onClick={() => onToggle(connection)} title={disabled ? state.detail : `Use ${connectionName}`} className={"flex min-h-12 w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors " + (selected ? "border-primary/40 bg-primary/10 text-foreground" : disabled ? "cursor-not-allowed border-border bg-muted/30 text-muted-foreground" : "border-border text-foreground hover:border-primary/40 hover:bg-accent")}>
                {selected ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Square className="h-3.5 w-3.5" />}<span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-pink-50 text-pink-700"><Camera className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{connectionName}</span><span className={`flex items-center gap-1 truncate text-[11px] ${state.className}`}><StateIcon className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{state.label}</span></span></span>
              </button>;
            })}
          </div>}
        </PopoverContent>
      </Popover>
      {selectedIds.length > 0 && !mediaSelection.ready && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-800">{mediaSelection.error}</p>}
    </div>
  );
}

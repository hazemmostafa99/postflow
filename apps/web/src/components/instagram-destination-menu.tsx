"use client";

import {
  AlertCircle,
  Camera,
  CheckCircle2,
  CheckSquare,
  Clock3,
  Square,
} from "lucide-react";

export type InstagramDestinationType = "INSTAGRAM_FEED" | "INSTAGRAM_REEL";

export interface InstagramConnection {
  _id: string;
  displayName?: string;
  externalUsername?: string;
  detectedExternalUsername?: string;
  status: string;
  workerStatus: string;
  sessionDetected: boolean;
}

interface InstagramDestinationMenuProps {
  targetType: InstagramDestinationType;
  connections: InstagramConnection[];
  selectedIds: string[];
  publishingEnabled: boolean;
  onToggle: (connection: InstagramConnection) => void;
  onClear: () => void;
}

function isReady(connection: InstagramConnection): boolean {
  return Boolean(
    connection.status === "CONNECTED" &&
      connection.sessionDetected &&
      connection.externalUsername &&
      connection.externalUsername.toLowerCase() ===
        connection.detectedExternalUsername?.toLowerCase(),
  );
}

function getConnectionState(connection: InstagramConnection) {
  if (isReady(connection)) {
    return {
      label: "Verified",
      detail: `@${connection.externalUsername}`,
      className: "text-emerald-700",
      Icon: CheckCircle2,
    };
  }

  if (connection.status === "ACCOUNT_MISMATCH") {
    return {
      label: "Account mismatch",
      detail: "Open the expected account in Instagram",
      className: "text-amber-700",
      Icon: AlertCircle,
    };
  }

  if (connection.status === "LOGIN_REQUIRED") {
    return {
      label: "Sign in required",
      detail: "Sign in at instagram.com",
      className: "text-amber-700",
      Icon: AlertCircle,
    };
  }

  return {
    label: "Waiting for extension",
    detail: "Keep Instagram open in this Chrome profile",
    className: "text-muted-foreground",
    Icon: Clock3,
  };
}

export function InstagramDestinationMenu({
  targetType,
  connections,
  selectedIds,
  publishingEnabled,
  onToggle,
  onClear,
}: InstagramDestinationMenuProps) {
  const isReel = targetType === "INSTAGRAM_REEL";
  const readyCount = connections.filter(isReady).length;
  const title = isReel ? "Instagram Reels" : "Instagram Feed";
  const requirement = isReel ? "1 video · caption optional" : "1 image · caption optional";

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-pink-50 text-pink-700 ring-1 ring-pink-100">
            <Camera className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <span className="rounded-full bg-pink-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pink-700">
                Beta
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{requirement}</p>
          </div>
        </div>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      <div
        role="status"
        className={
          "rounded-lg border px-3 py-2 text-[11px] leading-relaxed " +
          (publishingEnabled
            ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
            : "border-amber-200 bg-amber-50/80 text-amber-800")
        }
      >
        {publishingEnabled
          ? `${readyCount} verified account${readyCount === 1 ? "" : "s"} available. Select one to publish.`
          : "Instagram is connected, but publishing is still in live validation. The account will unlock here when the rollout is approved."}
      </div>

      {connections.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-background/60 px-3 py-4 text-center text-xs text-muted-foreground">
          Connect Instagram from the Connections page first.
        </div>
      ) : (
        <div role="listbox" aria-label={`${title} destinations`} aria-multiselectable="true" className="space-y-1.5">
          {connections.map((connection) => {
            const ready = isReady(connection);
            const selected = selectedIds.includes(connection._id);
            const disabled = !publishingEnabled || !ready;
            const state = getConnectionState(connection);
            const StateIcon = state.Icon;
            return (
              <button
                key={connection._id}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={disabled}
                disabled={disabled}
                onClick={() => onToggle(connection)}
                title={disabled ? state.detail : `Use ${connection.displayName || "Instagram account"}`}
                className={
                  "flex min-h-12 w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors " +
                  (selected
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : disabled
                      ? "cursor-not-allowed border-border bg-muted/30 text-muted-foreground"
                      : "border-border text-foreground hover:border-primary/40 hover:bg-accent")
                }
              >
                {selected ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Square className="h-3.5 w-3.5" />}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-pink-50 text-pink-700">
                  <Camera className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{connection.displayName || "Instagram account"}</span>
                  <span className={`flex items-center gap-1 truncate text-[11px] ${state.className}`}>
                    <StateIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{state.label}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

import type { ConnectionPlatform } from "./connection-platforms";

/** Read-only account diagnostics inside the existing expandable connection row. */
export function PlatformDetails({ accounts }: { accounts: ConnectionPlatform[] }) {
  return <section aria-label="Platform details" className="mt-5 border-t border-border pt-4">
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-normal text-muted-foreground">Platforms</h3>
    <div className="grid gap-3 xl:grid-cols-3">
      {accounts.map((account) => {
        const name = account.platform === "FACEBOOK" ? "Facebook" : account.platform === "INSTAGRAM" ? "Instagram" : account.platform === "TIKTOK" ? "TikTok" : account.platform;
        const connected = account.status === "CONNECTED" && account.sessionDetected;
        const label = (value: string) => value.replaceAll("_", " ").toLowerCase();
        return <div key={account.platform} className="rounded-lg border border-border bg-card p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{name}</h4>
            <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-muted text-muted-foreground"}`}>{label(account.status)}</span>
          </div>
          <dl className="space-y-2 text-xs">
            <div><dt className="text-muted-foreground">Account</dt><dd className="mt-1 break-all font-medium">{account.username ? `@${account.username}` : account.accountId ? `••••${account.accountId.slice(-4)}` : "Not detected"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Session</dt><dd>{account.sessionDetected ? "Detected" : "Not detected"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Worker status</dt><dd className="capitalize">{label(account.workerStatus)}</dd></div>
          </dl>
        </div>;
      })}
    </div>
    <p className="mt-3 text-xs text-muted-foreground">Accounts belong to this extension. Platform login status is independent; lifecycle controls apply to the whole connection.</p>
  </section>;
}

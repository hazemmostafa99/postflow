/** Sanitized shared connection identity returned by the authenticated PostFlow API. */
export function connectionIdentityUpdate(response: unknown): { extensionInstallationId: string; extensionName: string } | null {
  if (!response || typeof response !== 'object') return null;
  const { installationId, connectionDisplayName } = response as Record<string, unknown>;
  if (typeof installationId !== 'string' || !/^[a-f\d]{24}$/i.test(installationId)) return null;
  if (typeof connectionDisplayName !== 'string' || !connectionDisplayName.trim() || connectionDisplayName.length > 60) return null;
  return { extensionInstallationId: installationId, extensionName: connectionDisplayName };
}

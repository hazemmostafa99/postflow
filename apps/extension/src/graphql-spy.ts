(function () {
  const EXCLUDED_SLUGS = new Set([
    "feed", "discover", "create", "joins",
    "requests", "questions", "members",
    "media", "events", "files", "search",
  ]);

  interface GroupData {
    id: string;
    numericId?: string;
    name: string;
    url: string;
  }

  function extractSlugFromUrl(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl);
      const match = parsed.pathname.match(/^\/groups\/([^/?#]+)/);
      if (!match) return null;
      const slug = match[1];
      return EXCLUDED_SLUGS.has(slug) ? null : slug;
    } catch {
      return null;
    }
  }

  function findGroups(obj: unknown, depth = 0): GroupData[] {
    if (depth > 20 || obj === null || typeof obj !== "object") {
      return [];
    }

    const results: GroupData[] = [];

    if (Array.isArray(obj)) {
      for (const item of obj) {
        results.push(...findGroups(item, depth + 1));
      }
      return results;
    }

    const record = obj as Record<string, unknown>;

    if (record.__typename === "Group" && typeof record.name === "string" && record.name) {
      let id: string | null = null;
      let numericId: string | undefined = undefined;
      let url = "";

      // Extract the numeric ID (Facebook's internal ID) — always a string of digits
      if (typeof record.id === "string" && /^\d+$/.test(record.id)) {
        numericId = record.id;
      }

      if (typeof record.url === "string") {
        url = record.url;
        id = extractSlugFromUrl(url);
      } else if (typeof record.group_url === "string") {
        url = record.group_url;
        id = extractSlugFromUrl(url);
      }

      if (!id && typeof record.vanity === "string" && record.vanity) {
        id = record.vanity;
        url = url || `https://www.facebook.com/groups/${id}/`;
      }

      // Fall back to numeric ID as slug if no vanity URL found
      if (!id && numericId) {
        id = numericId;
        url = url || `https://www.facebook.com/groups/${id}/`;
      }

      if (id && !EXCLUDED_SLUGS.has(id)) {
        const canonicalUrl = `https://www.facebook.com/groups/${id}/`;
        results.push({ id, numericId, name: record.name, url: canonicalUrl });
        // Don't recurse deeper into this node to avoid duplicate child groups
        return results;
      } else if (id && EXCLUDED_SLUGS.has(id)) {
        console.warn(`[PostFlow] Skipped excluded group slug: ${id} (${record.name})`);
      }
    }

    for (const value of Object.values(record)) {
      if (typeof value === "object" && value !== null) {
        results.push(...findGroups(value, depth + 1));
      }
    }

    return results;
  }

  function extractPostUrls(text: string): string[] {
    const normalized = text.replace(/\\\//g, '/');
    const matches = normalized.match(new RegExp('https?://(?:www\\.)?facebook\\.com/groups/[^\\s"<>]+?/(?:posts|permalink|pending_posts)/[A-Za-z0-9_-]+[^\\s"<>]*', 'gi')) ?? [];
    return Array.from(new Set(matches.map((value: string) => {
      try {
        const url = new URL(value.replace(/[\\"']+$/g, ''));
        const match = url.pathname.match(/^\/groups\/([^/]+)\/(posts|permalink|pending_posts)\/([A-Za-z0-9_-]+)/i);
        return match ? `https://www.facebook.com/groups/${match[1]}/${match[2]}/${match[3]}/` : url.href;
      } catch {
        return value.replace(/[\\"']+$/g, '');
      }
    })));
  }

  function extractNetworkMetadata(text: string): { videoIds: string[]; uploadSessionIds: string[] } {
    const videoIds = Array.from(new Set(
      Array.from(text.matchAll(/"video_id"\s*:\s*"(\d+)"/g), (match) => match[1]),
    ));
    const uploadSessionIds = Array.from(new Set(
      Array.from(text.matchAll(/"upload_session_id"\s*:\s*"(\d+)"/g), (match) => match[1]),
    ));
    return { videoIds, uploadSessionIds };
  }

  function getBodyText(body: unknown): string {
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const parts: string[] = [];
      for (const [key, value] of body.entries()) {
        if (typeof value === "string") parts.push(`${key}=${value}`);
      }
      return parts.join("&");
    }
    return "";
  }

  function publishCandidates(detail: {
    requestUrl?: string;
    postUrls?: string[];
    storyFbids?: string[];
    videoIds?: string[];
    uploadSessionIds?: string[];
  }): void {
    const hasCandidates = Boolean(
      detail.postUrls?.length ||
      detail.storyFbids?.length ||
      detail.videoIds?.length ||
      detail.uploadSessionIds?.length
    );
    if (!hasCandidates) return;
    window.dispatchEvent(new CustomEvent("postflow:facebook-response", { detail }));
    window.postMessage({
      source: "postflow-graphql-spy",
      type: "facebook-response",
      ...detail,
    }, "*");
  }

  function processText(text: string, requestUrl = ''): void {
    const postUrls = extractPostUrls(text);
    const storyFbids = text.includes('"story_create"')
      ? Array.from(new Set(
        Array.from(text.matchAll(/"feed_fbids"\s*:\s*\[\s*"(\d+)"/g), (match) => match[1]),
      ))
      : [];
    const metadata = extractNetworkMetadata(text);
    publishCandidates({ requestUrl, postUrls, storyFbids, ...metadata });
    if (requestUrl && !requestUrl.includes("/api/graphql")) return;

    // Facebook may return multiple JSON objects in a single response body
    const lines = text.split("\n");
    const allGroups: GroupData[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const data = JSON.parse(trimmed);
        allGroups.push(...findGroups(data));
      } catch {
        // not valid JSON, skip
      }
    }

    if (allGroups.length > 0) {
      window.dispatchEvent(new CustomEvent("postflow:groups", { detail: allGroups }));
    }
  }

  // ── Intercept fetch ──

  window.addEventListener('postflow:graphql-text', ((e: CustomEvent<string>) => {
    if (typeof e.detail === 'string') {
      processText(e.detail);
    }
  }) as EventListener);

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const response = await originalFetch(...args);

    try {
      const url =
        typeof args[0] === "string"
          ? args[0]
          : args[0] instanceof Request
          ? args[0].url
          : "";
      const requestBody = args[1]?.body ?? (args[0] instanceof Request ? getBodyText(args[0].body) : "");
      const requestText = getBodyText(requestBody);
      if (requestText) {
        const metadata = extractNetworkMetadata(requestText);
        publishCandidates({ requestUrl: url, ...metadata });
      }

      if (url.includes("facebook.com") || url.startsWith("/")) {
        response.clone().text().then((text) => processText(text, url)).catch(() => {});
      }
    } catch {
      // never break the original response
    }

    return response;
  };

  // ── Intercept XHR (fallback) ──

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = XMLHttpRequest.prototype as any;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  proto.open = function (method: string, url: string | URL) {
    this._postflow_url = url.toString();
    // eslint-disable-next-line prefer-rest-params
    return originalOpen.apply(this, arguments);
  };

  proto.send = function (body?: unknown) {
    const requestText = getBodyText(body);
    if (requestText) {
      const metadata = extractNetworkMetadata(requestText);
      publishCandidates({ requestUrl: this._postflow_url ?? '', ...metadata });
    }
    if (this._postflow_url?.includes("facebook.com") || this._postflow_url?.startsWith("/")) {
      this.addEventListener("load", () => {
        try {
          processText(this.responseText, this._postflow_url ?? '');
        } catch {
          // ignore
        }
      });
    }
    // eslint-disable-next-line prefer-rest-params
    return originalSend.apply(this, arguments);
  };

  console.log("[PostFlow] GraphQL spy active");
})();

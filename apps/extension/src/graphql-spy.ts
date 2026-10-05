(function () {
  const PENDING_RESPONSE_REPLAY_EVENT = 'postflow:request-facebook-response-replay';
  const spyWindow = window as Window & { __postflowGraphqlSpyInstalled?: boolean };
  if (spyWindow.__postflowGraphqlSpyInstalled) {
    window.dispatchEvent(new CustomEvent(PENDING_RESPONSE_REPLAY_EVENT));
    return;
  }
  spyWindow.__postflowGraphqlSpyInstalled = true;

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
    const normalized = text.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    const matches = [
      ...Array.from(normalized.matchAll(/https?:\/\/(?:www\.)?facebook\.com\/groups\/[^\s"<>\\]+?\/(?:posts|permalink|pending_posts)\/[A-Za-z0-9_-]+[^\s"<>\\]*/gi), (match) => match[0]),
      ...Array.from(normalized.matchAll(/\/\/(?:www\.)?facebook\.com\/groups\/[^\s"<>\\]+?\/(?:posts|permalink|pending_posts)\/[A-Za-z0-9_-]+[^\s"<>\\]*/gi), (match) => `https:${match[0]}`),
      ...Array.from(normalized.matchAll(/(?:www\.)facebook\.com\/groups\/[^\s"<>\\]+?\/(?:posts|permalink|pending_posts)\/[A-Za-z0-9_-]+[^\s"<>\\]*/gi), (match) => `https://${match[0]}`),
      ...Array.from(normalized.matchAll(/\/groups\/[^/\s"<>\\]+\/(?:posts|permalink|pending_posts)\/[A-Za-z0-9_-]+[^\s"<>\\]*/gi), (match) => `https://www.facebook.com${match[0]}`),
    ];
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
    let normalized = text.replace(/\\"/g, '"');
    try {
      normalized = decodeURIComponent(normalized.replace(/\+/g, ' '));
    } catch {
      // Responses are not URL encoded; use the original normalized text.
    }
    const videoIds = Array.from(new Set(
      Array.from(normalized.matchAll(/"video_id"\s*:\s*"(\d+)"/g), (match) => match[1]),
    ));
    const uploadSessionIds = Array.from(new Set(
      Array.from(normalized.matchAll(/"upload_session_id"\s*:\s*"(\d+)"/g), (match) => match[1]),
    ));
    return { videoIds, uploadSessionIds };
  }

  interface PendingPostNetworkCandidate {
    postUrls: string[];
    postIds: string[];
    texts: string[];
    videoIds: string[];
  }

  interface FacebookResponseCandidateDetail {
    requestUrl?: string;
    requestStartedAt?: number;
    isStoryCreateResponse?: boolean;
    postUrls?: string[];
    storyFbids?: string[];
    videoIds?: string[];
    uploadSessionIds?: string[];
    pendingPostCandidates?: PendingPostNetworkCandidate[];
  }

  const pendingResponseReplayBuffer: FacebookResponseCandidateDetail[] = [];

  function extractPendingPostCandidates(text: string): PendingPostNetworkCandidate[] {
    if (!location.pathname.match(/^\/groups\/[^/]+\/pending_posts\/?$/i)) return [];

    const candidates: PendingPostNetworkCandidate[] = [];
    const seen = new Set<string>();
    const visit = (value: unknown, depth = 0): void => {
      if (depth > 24 || value === null || typeof value !== 'object' || candidates.length >= 60) return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }

      const record = value as Record<string, unknown>;
      for (const child of Object.values(record)) visit(child, depth + 1);

      const serialized = JSON.stringify(record);
      if (serialized.length > 250_000) return;
      const postUrls = extractPostUrls(serialized);
      const texts = Array.from(new Set(
        Object.entries(record)
          .filter(([key, item]) => /^(?:text|message|body|story_message)$/i.test(key) && typeof item === 'string')
          .map(([, item]) => (item as string).normalize('NFKC').replace(/\s+/g, ' ').trim())
          .filter((item) => item.length > 0 && item.length <= 2_000),
      ));
      if (!texts.length) {
        const nestedTexts = Array.from(serialized.matchAll(/"(?:text|message|body|story_message)"\s*:\s*"((?:\\.|[^"\\])*)"/gi))
          .map((match) => {
            try {
              return JSON.parse(`"${match[1]}"`) as string;
            } catch {
              return '';
            }
          })
          .map((item) => item.normalize('NFKC').replace(/\s+/g, ' ').trim())
          .filter((item) => item.length > 0 && item.length <= 2_000);
        texts.push(...Array.from(new Set(nestedTexts)).slice(0, 20));
      }
      if (!texts.length) return;

      const typename = typeof record.__typename === 'string' ? record.__typename : '';
      const postIds = Array.from(new Set(
        Object.entries(record)
          .filter(([key, item]) => {
            if (typeof item !== 'string' || !/^\d+$/.test(item)) return false;
            if (/^(?:post_id|story_fbid|legacy_fbid|story_id)$/i.test(key)) return true;
            return key === 'id' && /(?:story|post|feedunit)/i.test(typename);
          })
          .map(([, item]) => item as string),
      ));
      const videoIds = extractNetworkMetadata(serialized).videoIds;
      if (!postUrls.length && !postIds.length) return;

      const key = `${postUrls.join(',')}|${postIds.join(',')}|${texts.join('|')}|${videoIds.join(',')}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        postUrls: postUrls.slice(0, 5),
        postIds: postIds.slice(0, 5),
        texts: texts.slice(0, 20),
        videoIds: videoIds.slice(0, 10),
      });
    };

    for (const line of text.split('\n')) {
      const trimmed = line.trim().replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, '');
      if (!trimmed.startsWith('{')) continue;
      try {
        visit(JSON.parse(trimmed));
      } catch {
        // Ignore malformed streaming-response lines.
      }
    }
    return candidates;
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

  function isStoryCreateRequest(requestText: string): boolean {
    if (!requestText) return false;
    let decoded = requestText.replace(/\+/g, ' ');
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // The body may be only partially URL encoded; inspect it as-is.
    }
    return /(?:Comet)?ComposerStoryCreateMutation|story_create/i.test(decoded);
  }

  function dispatchCandidates(detail: FacebookResponseCandidateDetail): void {
    window.dispatchEvent(new CustomEvent("postflow:facebook-response", { detail }));
    window.postMessage({
      source: "postflow-graphql-spy",
      type: "facebook-response",
      ...detail,
    }, "*");
  }

  function publishCandidates(detail: FacebookResponseCandidateDetail): void {
    const hasCandidates = Boolean(
      detail.postUrls?.length ||
      detail.storyFbids?.length ||
      detail.videoIds?.length ||
      detail.uploadSessionIds?.length ||
      detail.pendingPostCandidates?.length
    );
    if (!hasCandidates) return;
    if (detail.pendingPostCandidates?.length) {
      pendingResponseReplayBuffer.push(detail);
      if (pendingResponseReplayBuffer.length > 100) pendingResponseReplayBuffer.shift();
    }
    dispatchCandidates(detail);
  }

  window.addEventListener(PENDING_RESPONSE_REPLAY_EVENT, () => {
    for (const detail of pendingResponseReplayBuffer) dispatchCandidates(detail);
  });

  function processText(
    text: string,
    requestUrl = '',
    requestStartedAt = Date.now(),
    requestWasStoryCreate = false,
    requestMetadata: { videoIds: string[]; uploadSessionIds: string[] } = {
      videoIds: [],
      uploadSessionIds: [],
    },
  ): void {
    const hasStoryCreatePayload = text.includes('"story_create"');
    const requestCompletedWithoutGraphQLErrors = requestWasStoryCreate &&
      !/"errors"\s*:/.test(text);
    const isStoryCreateResponse = hasStoryCreatePayload || requestCompletedWithoutGraphQLErrors;
    // General feed responses contain many historical permalinks. They are not
    // publication evidence, even when one happens to belong to the target.
    const postUrls = isStoryCreateResponse ? extractPostUrls(text) : [];
    const storyFbids = isStoryCreateResponse
      ? Array.from(new Set(
        Array.from(text.matchAll(/"feed_fbids"\s*:\s*\[\s*"(\d+)"/g), (match) => match[1]),
      ))
      : [];
    const responseMetadata = extractNetworkMetadata(text);
    const pendingPostCandidates = extractPendingPostCandidates(text);
    const metadata = isStoryCreateResponse
      ? {
          videoIds: Array.from(new Set([...requestMetadata.videoIds, ...responseMetadata.videoIds])),
          uploadSessionIds: Array.from(new Set([
            ...requestMetadata.uploadSessionIds,
            ...responseMetadata.uploadSessionIds,
          ])),
        }
      : responseMetadata;
    publishCandidates({
      requestUrl,
      requestStartedAt,
      isStoryCreateResponse,
      postUrls,
      storyFbids,
      ...metadata,
      pendingPostCandidates,
    });
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
      // This legacy bridge does not carry the originating request time. Keep
      // it available for group discovery, but make it ineligible as publish
      // evidence for any active submission.
      processText(e.detail, '', 0);
    }
  }) as EventListener);

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const requestStartedAt = Date.now();
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
      const requestWasStoryCreate = isStoryCreateRequest(requestText);
      const requestMetadata = extractNetworkMetadata(requestText);
      if (requestText) {
        publishCandidates({ requestUrl: url, ...requestMetadata });
      }

      if (url.includes("facebook.com") || url.startsWith("/")) {
        response.clone().text()
          .then((text) => processText(
            text,
            url,
            requestStartedAt,
            requestWasStoryCreate,
            requestMetadata,
          ))
          .catch(() => {});
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
    const requestStartedAt = Date.now();
    const requestText = getBodyText(body);
    const requestWasStoryCreate = isStoryCreateRequest(requestText);
    const requestMetadata = extractNetworkMetadata(requestText);
    if (requestText) {
      publishCandidates({ requestUrl: this._postflow_url ?? '', ...requestMetadata });
    }
    if (this._postflow_url?.includes("facebook.com") || this._postflow_url?.startsWith("/")) {
      this.addEventListener("load", () => {
        try {
          processText(
            this.responseText,
            this._postflow_url ?? '',
            requestStartedAt,
            requestWasStoryCreate,
            requestMetadata,
          );
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

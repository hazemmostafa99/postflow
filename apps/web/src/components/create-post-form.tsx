"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, ChevronDown, ImagePlus, Loader2, Search, Send, Square, Trash2, UserRound, Users, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Group {
  _id: string;
  name: string;
  externalId: string;
  status: string;
  facebookConnectionId?: string;
}

interface FacebookConnection {
  _id: string;
  displayName?: string;
  facebookUserId?: string;
  status: string;
  workerStatus: string;
}

interface CreatePostFormProps {
  groups?: Group[];
  onCancel?: () => void;
  onSuccess?: () => void;
}

interface GroupsResponse {
  groups: Group[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const GROUPS_PER_PAGE = 20;
const MAX_MEDIA_FILES = 4;
const MAX_MEDIA_FILE_SIZE = 2 * 1024 * 1024;
const MAX_VIDEO_FILES = 1;
const MAX_VIDEO_FILE_SIZE = 25 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function CreatePostForm({ groups = [], onCancel, onSuccess }: CreatePostFormProps) {
  const router = useRouter();
  const [availableGroups, setAvailableGroups] = useState<Group[]>(groups);
  const [selectedGroupsById, setSelectedGroupsById] = useState<Map<string, Group>>(new Map());
  const [content, setContent] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("");
  const [spacePostsApart, setSpacePostsApart] = useState(false);
  const [spacingMinutes, setSpacingMinutes] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReadingMedia, setIsReadingMedia] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupPage, setGroupPage] = useState(1);
  const [groupTotal, setGroupTotal] = useState(groups.length);
  const [groupTotalPages, setGroupTotalPages] = useState(Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE)));
  const [connections, setConnections] = useState<FacebookConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [isGroupMenuOpen, setIsGroupMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGroups = useMemo(
    () => Array.from(selectedGroupsById.values()),
    [selectedGroupsById],
  );

  const fetchGroupsPage = useCallback(async (page: number, search: string) => {
    setIsLoadingGroups(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(GROUPS_PER_PAGE),
      });
      if (search.trim()) params.set("search", search.trim());
      if (selectedConnectionId) params.set("connectionId", selectedConnectionId);

      const res = await fetch(`/api/groups?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load groups");

      const data = (await res.json()) as GroupsResponse;
      setAvailableGroups(data.groups);
      setGroupPage(data.pagination.page);
      setGroupTotal(data.pagination.total);
      setGroupTotalPages(data.pagination.totalPages);
    } catch {
      setError("Could not load groups. Please try again.");
    } finally {
      setIsLoadingGroups(false);
    }
  }, [selectedConnectionId]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/extensions/connections")
      .then(async (res) => {
        if (!res.ok) return [] as FacebookConnection[];
        return (await res.json()) as FacebookConnection[];
      })
      .then((data) => {
        if (cancelled) return;
        setConnections(data);
        const connected = data.filter((connection) => connection.status === "CONNECTED");
        if (!selectedConnectionId && connected.length === 1) {
          setSelectedConnectionId(connected[0]._id);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [selectedConnectionId]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      fetchGroupsPage(groupPage, searchQuery);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [fetchGroupsPage, groupPage, searchQuery]);

  const connectionLabel = useCallback((connectionId?: string) => {
    if (!connectionId) return "Unassigned group";
    const connection = connections.find((item) => item._id === connectionId);
    if (!connection) return "Facebook account";
    if (connection.displayName) return connection.displayName;
    return connection.facebookUserId
      ? `Facebook ending ${connection.facebookUserId.slice(-4)}`
      : "Unnamed profile";
  }, [connections]);

  const connectionName = useCallback((connection: FacebookConnection) => {
    if (connection.displayName) return connection.displayName;
    return connection.facebookUserId
      ? `Facebook ending ${connection.facebookUserId.slice(-4)}`
      : "Unnamed profile";
  }, []);

  const connectionStatus = useCallback((connection: FacebookConnection) => {
    if (connection.status === "CONNECTED") {
      return connection.workerStatus === "PUBLISHING" ? "Publishing" : "Ready";
    }
    return connection.status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }, []);

  const toggleGroup = useCallback((group: Group) => {
    setSelectedGroupsById((prev) => {
      const next = new Map(prev);
      if (next.has(group._id)) {
        next.delete(group._id);
      } else {
        next.set(group._id, group);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedGroupsById((prev) => {
      const next = new Map(prev);
      for (const group of availableGroups) {
        next.set(group._id, group);
      }
      return next;
    });
  }, [availableGroups]);

  const clearAll = useCallback(() => {
    setSelectedGroupsById(new Map());
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!content.trim() && mediaUrls.length === 0) {
      setError("Please write content or attach at least one image or video.");
      return;
    }
    if (selectedGroupsById.size === 0) {
      setError("Please select at least one group to publish to.");
      return;
    }
    if (spacePostsApart && !startTime) {
      setError("Choose a start time before spacing posts apart.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim(),
          mediaUrls,
          targetGroupIds: Array.from(selectedGroupsById.keys()),
          ...(startTime ? { startTime: new Date(startTime).toISOString() } : {}),
          spacePostsApart,
          ...(spacePostsApart ? { spacingMinutes } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message || "Failed to create post. Please try again.");
        return;
      }

      // The API creates the jobs, while the browser extension owns execution.
      // Persist the signal as a fallback in case the extension content script
      // has not finished initializing when this event is dispatched.
      window.localStorage.setItem("postflow:pending-job-check", String(Date.now()));
      window.dispatchEvent(new CustomEvent("postflow:check-jobs"));

      if (onSuccess) {
        onSuccess();
        router.refresh();
      } else {
        router.push("/posts");
        router.refresh();
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMediaChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    setError(null);

    if (mediaUrls.length + files.length > MAX_MEDIA_FILES) {
      setError(`You can attach up to ${MAX_MEDIA_FILES} media files.`);
      return;
    }

    const invalidFile = files.find((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"));
    if (invalidFile) {
      setError("Only image and video files are supported.");
      return;
    }

    const videoCount = mediaUrls.filter((url) => url.startsWith("data:video/")).length;
    const newVideoCount = files.filter((file) => file.type.startsWith("video/")).length;
    if (videoCount + newVideoCount > MAX_VIDEO_FILES) {
      setError("You can attach one video per post.");
      return;
    }

    const oversizedFile = files.find((file) =>
      file.type.startsWith("video/") ? file.size > MAX_VIDEO_FILE_SIZE : file.size > MAX_MEDIA_FILE_SIZE,
    );
    if (oversizedFile) {
      setError(oversizedFile.type.startsWith("video/") ? "Videos must be 25MB or smaller." : "Images must be 2MB or smaller.");
      return;
    }

    setIsReadingMedia(true);
    try {
      const urls = await Promise.all(files.map(readFileAsDataUrl));
      setMediaUrls((prev) => [...prev, ...urls]);
    } catch {
      setError("Could not read one of the selected media files.");
    } finally {
      setIsReadingMedia(false);
    }
  };

  const removeMedia = (index: number) => {
    setMediaUrls((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const charsLeft = 63206 - content.length;
  const isOverLimit = charsLeft < 0;
  const canSubmit =
    !isSubmitting &&
    !isReadingMedia &&
    !isOverLimit &&
    (content.trim().length > 0 || mediaUrls.length > 0) &&
    selectedGroupsById.size > 0;
  const selectedConnection = connections.find((connection) => connection._id === selectedConnectionId);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="content" className="text-sm font-medium text-foreground">
          Post Content
        </label>
        <textarea
          id="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What would you like to share with your groups?"
          rows={5}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-6 shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-3 focus:ring-ring/20"
        />
        <p className={`text-right text-xs ${isOverLimit ? "text-red-600" : "text-muted-foreground"}`}>
          {isOverLimit ? `${Math.abs(charsLeft)} characters over limit` : `${charsLeft.toLocaleString()} characters remaining`}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="start-time" className="text-sm font-medium text-foreground">
              Start time <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="start-time"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-3 focus:ring-ring/20"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={spacePostsApart}
              onChange={(e) => setSpacePostsApart(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Space posts apart
          </label>
        </div>
        {spacePostsApart && (
          <div className="max-w-xs space-y-1.5">
            <label htmlFor="spacing-minutes" className="text-xs font-medium text-muted-foreground">
              Minimum time between posts
            </label>
            <select
              id="spacing-minutes"
              value={spacingMinutes}
              onChange={(e) => setSpacingMinutes(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-3 focus:ring-ring/20"
            >
              {[1, 2, 3, 5, 10, 15, 30].map((minutes) => (
                <option key={minutes} value={minutes}>{minutes} minute{minutes === 1 ? "" : "s"}</option>
              ))}
            </select>
          </div>
        )}
        {startTime && selectedGroups.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {selectedGroups.map((group, index) => (
              <div key={group._id} className="flex justify-between gap-4 py-0.5">
                <span className="truncate">{index + 1}. {group.name}</span>
                <span className="shrink-0">
                  {new Date(new Date(startTime).getTime() + index * (spacePostsApart ? spacingMinutes : 0) * 60_000).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">
            Media
            <span className="ml-2 font-normal text-muted-foreground">
              ({mediaUrls.length}/{MAX_MEDIA_FILES})
            </span>
          </label>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-primary transition-colors hover:bg-accent">
            {isReadingMedia ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
            Add images or video
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleMediaChange}
              disabled={isReadingMedia || mediaUrls.length >= MAX_MEDIA_FILES}
              className="sr-only"
            />
          </label>
        </div>

        {mediaUrls.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {mediaUrls.map((url, index) => (
              <div key={`${url.slice(0, 32)}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted shadow-sm">
                {url.startsWith("data:video/") ? (
                  <video src={url} controls className="h-full w-full object-cover" />
                ) : (
                  <img src={url} alt="" className="h-full w-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => removeMedia(index)}
                  className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/95 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
                  aria-label="Remove media"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {connections.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Publish from</p>
              <p className="text-xs text-muted-foreground">Choose the profile that owns these groups.</p>
            </div>
          </div>
          <Select
            value={selectedConnectionId || "all"}
            onValueChange={(value) => {
              const connectionId = value === "all" ? "" : String(value ?? "");
              setSelectedConnectionId(connectionId);
              setSelectedGroupsById(new Map());
              setGroupPage(1);
            }}
          >
            <SelectTrigger aria-label="Choose Facebook profile">
              <SelectValue>
                {() => (
                  <span className="flex min-w-0 items-center gap-3 text-left">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${selectedConnection ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                      {selectedConnection ? <UserRound className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {selectedConnection ? connectionName(selectedConnection) : "All profiles"}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {selectedConnection ? connectionStatus(selectedConnection) : `Show groups from ${connections.length} profiles`}
                      </span>
                    </span>
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start" className="w-(--anchor-width)">
              <SelectItem value="all">
                <span className="block min-w-0">
                  <span className="block truncate text-sm font-medium">All profiles</span>
                  <span className="block truncate text-xs text-muted-foreground">Show groups from every account</span>
                </span>
              </SelectItem>
              {connections.map((connection) => (
                <SelectItem key={connection._id} value={connection._id}>
                  <span className="block min-w-0">
                    <span className="block truncate text-sm font-medium">{connectionName(connection)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{connectionStatus(connection)}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Target groups</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Choose where this post should be published.</p>
            </div>
            <span className="shrink-0 rounded-full border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
              {selectedGroupsById.size} selected
            </span>
          </div>
          <Popover open={isGroupMenuOpen} onOpenChange={setIsGroupMenuOpen}>
            <PopoverTrigger
              type="button"
              aria-label={selectedGroupsById.size > 0 ? `${selectedGroupsById.size} target groups selected` : "Choose target groups"}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left shadow-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-3 focus:ring-ring/20"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                <Users className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {selectedGroupsById.size > 0 ? `${selectedGroupsById.size} groups selected` : "Choose target groups"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {isLoadingGroups ? "Loading groups..." : `${groupTotal.toLocaleString()} groups available`}
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isGroupMenuOpen ? "rotate-180" : ""}`} />
            </PopoverTrigger>

            <PopoverContent align="start" className="w-(--anchor-width) p-0">
                <div className="border-b border-border p-2">
                  <div className="flex items-center justify-between gap-3 px-1 pb-2">
                    <span className="text-xs font-medium text-muted-foreground">Select target groups</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={selectAll} className="text-xs font-medium text-primary hover:underline">
                        Select visible
                      </button>
                      <button type="button" onClick={clearAll} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search groups..."
                      value={searchQuery}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setGroupPage(1);
                      }}
                      aria-label="Search target groups"
                      autoFocus
                      className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-3 focus:ring-ring/20"
                    />
                  </div>
                </div>

                <div
                  role="listbox"
                  aria-label="Target groups"
                  aria-multiselectable="true"
                  className="max-h-64 space-y-1 overflow-y-auto p-2"
                >
                  {availableGroups.length === 0 ? (
                    <div className="px-3 py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        {searchQuery ? "No groups match your search." : "No groups synced yet."}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground/70">
                        {searchQuery ? "Try a different group name." : "Open the extension on Facebook to collect groups."}
                      </p>
                    </div>
                  ) : (
                    availableGroups.map((group) => {
                      const isSelected = selectedGroupsById.has(group._id);
                      return (
                        <button
                          key={group._id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => toggleGroup(group)}
                          className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
                            isSelected
                              ? "border-primary/30 bg-primary/10 text-foreground"
                              : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          {isSelected ? (
                            <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                          ) : (
                            <Square className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{group.name}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {connectionLabel(group.facebookConnectionId)}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {isLoadingGroups ? "Loading..." : `${groupTotal.toLocaleString()} groups - page ${groupPage} of ${groupTotalPages}`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setGroupPage((page) => Math.max(1, page - 1))}
                      disabled={groupPage <= 1 || isLoadingGroups}
                      className="rounded-md border border-border bg-background px-2 py-1 hover:bg-accent disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroupPage((page) => Math.min(groupTotalPages, page + 1))}
                      disabled={groupPage >= groupTotalPages || isLoadingGroups}
                      className="rounded-md border border-border bg-background px-2 py-1 hover:bg-accent disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
            </PopoverContent>
          </Popover>
        </div>

        {selectedGroups.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/35 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">Selected groups</p>
              <button type="button" onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground">
                Clear all
              </button>
            </div>
            <div className="flex max-h-16 flex-wrap gap-1.5 overflow-y-auto pr-1">
              {selectedGroups.map((group) => (
                <span
                  key={group._id}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-foreground"
                >
                  <span className="max-w-56 truncate">{group.name}</span>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${group.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onCancel ?? (() => router.back())}
          className="h-9 rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting || isReadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {isSubmitting ? "Publishing..." : isReadingMedia ? "Preparing..." : "Publish Now"}
        </button>
      </div>
    </form>
  );
}

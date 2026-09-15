"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, ImagePlus, Loader2, Search, Send, Square, Trash2, X } from "lucide-react";

interface Group {
  _id: string;
  name: string;
  externalId: string;
  status: string;
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReadingMedia, setIsReadingMedia] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupPage, setGroupPage] = useState(1);
  const [groupTotal, setGroupTotal] = useState(groups.length);
  const [groupTotalPages, setGroupTotalPages] = useState(Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE)));
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
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      fetchGroupsPage(groupPage, searchQuery);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [fetchGroupsPage, groupPage, searchQuery]);

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
      setError("Please write content or attach at least one image.");
      return;
    }
    if (selectedGroupsById.size === 0) {
      setError("Please select at least one group to publish to.");
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
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message || "Failed to create post. Please try again.");
        return;
      }

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
      setError(`You can attach up to ${MAX_MEDIA_FILES} images.`);
      return;
    }

    const invalidFile = files.find((file) => !file.type.startsWith("image/"));
    if (invalidFile) {
      setError("Only image files are supported right now.");
      return;
    }

    const oversizedFile = files.find((file) => file.size > MAX_MEDIA_FILE_SIZE);
    if (oversizedFile) {
      setError("Each image must be 2MB or smaller.");
      return;
    }

    setIsReadingMedia(true);
    try {
      const urls = await Promise.all(files.map(readFileAsDataUrl));
      setMediaUrls((prev) => [...prev, ...urls]);
    } catch {
      setError("Could not read one of the selected images.");
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
            Add images
            <input
              type="file"
              accept="image/*"
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
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeMedia(index)}
                  className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/95 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
                  aria-label="Remove image"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="text-sm font-medium text-foreground">
            Target Groups
            <span className="ml-2 font-normal text-muted-foreground">
              ({selectedGroupsById.size} selected)
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={selectAll} className="text-xs font-medium text-primary hover:underline">
              Select all
            </button>
            <span className="text-muted-foreground">/</span>
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
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setGroupPage(1);
            }}
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-3 focus:ring-ring/20"
          />
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

        {availableGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {searchQuery ? "No groups match your search." : "No groups synced yet."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {searchQuery ? "Try a different group name." : "Open the extension on Facebook to collect groups."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid max-h-52 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {availableGroups.map((group) => {
                const isSelected = selectedGroupsById.has(group._id);
                return (
                  <button
                    key={group._id}
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all ${
                      isSelected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <Square className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate text-xs font-medium">{group.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                {isLoadingGroups
                  ? "Loading groups..."
                  : `${groupTotal.toLocaleString()} groups - page ${groupPage} of ${groupTotalPages}`}
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

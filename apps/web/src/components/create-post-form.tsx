"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckSquare, ChevronDown, Clock3, ImagePlus, Loader2, Search, Send, Square, Trash2, UserRound, Users, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  InstagramDestinationMenu,
  type InstagramConnection,
} from "@/components/instagram-destination-menu";
import { buildInstagramTarget, resolveInstagramMedia } from "@/lib/instagram-publishing";
import { TikTokDestinationMenu } from "@/components/tiktok-destination-menu";
import { buildTikTokTarget, getTikTokMediaError, getTikTokMediaLabel, isTikTokConnectionReady, type TikTokConnection } from "@/lib/tiktok-publishing";

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
  detectedFacebookUserId?: string;
  status: string;
  workerStatus: string;
}

type SelectedDestination =
  | { key: string; type: "GROUP"; group: Group }
  | { key: string; type: "PROFILE_FEED"; connection: FacebookConnection }
  | { key: string; type: "INSTAGRAM"; connection: InstagramConnection }
  | { key: string; type: "TIKTOK"; connection: TikTokConnection };

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
const INSTAGRAM_PUBLISHING_ENABLED = process.env.NEXT_PUBLIC_INSTAGRAM_PUBLISHING_ENABLED === "true";
const TIKTOK_PUBLISHING_ENABLED = process.env.NEXT_PUBLIC_TIKTOK_PUBLISHING_ENABLED === "true";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function platformConnectionName(connection: {
  extensionName?: string | null;
  extensionInstanceIdMasked?: string | null;
}): string {
  return connection.extensionName?.trim()
    || connection.extensionInstanceIdMasked?.trim()
    || "Chrome profile";
}

export function CreatePostForm({ groups = [], onCancel, onSuccess }: CreatePostFormProps) {
  const router = useRouter();
  const [availableGroups, setAvailableGroups] = useState<Group[]>(groups);
  const [selectedGroupsById, setSelectedGroupsById] = useState<Map<string, Group>>(new Map());
  const [selectedProfilesById, setSelectedProfilesById] = useState<Map<string, FacebookConnection>>(new Map());
  const [selectedInstagramByKey, setSelectedInstagramByKey] = useState<Map<string, InstagramConnection>>(new Map());
  const [selectedTikTokById, setSelectedTikTokById] = useState<Map<string, TikTokConnection>>(new Map());
  const [tiktokConnections, setTikTokConnections] = useState<TikTokConnection[]>([]);
  const [selectedTargetKeys, setSelectedTargetKeys] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [publishMode, setPublishMode] = useState<"NOW" | "SCHEDULED">("NOW");
  const [startTime, setStartTime] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReadingMedia, setIsReadingMedia] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupPage, setGroupPage] = useState(1);
  const [groupTotal, setGroupTotal] = useState(groups.length);
  const [groupTotalPages, setGroupTotalPages] = useState(Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE)));
  const [connections, setConnections] = useState<FacebookConnection[]>([]);
  const [instagramConnections, setInstagramConnections] = useState<InstagramConnection[]>([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isGroupAccountMenuOpen, setIsGroupAccountMenuOpen] = useState(false);
  const [isGroupMenuOpen, setIsGroupMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instagramMedia = resolveInstagramMedia(mediaUrls);
  const instagramMediaError = selectedInstagramByKey.size > 0 ? instagramMedia.error : null;
  const tiktokMediaError = selectedTikTokById.size > 0 ? getTikTokMediaError(mediaUrls) : null;

  const selectedDestinations = useMemo<SelectedDestination[]>(
    () => selectedTargetKeys.flatMap((key): SelectedDestination[] => {
      if (key.startsWith("GROUP:")) {
        const group = selectedGroupsById.get(key.slice("GROUP:".length));
        return group ? [{ key, type: "GROUP", group }] : [];
      }
      if (key.startsWith("PROFILE_FEED:")) {
        const connection = selectedProfilesById.get(key.slice("PROFILE_FEED:".length));
        return connection ? [{ key, type: "PROFILE_FEED", connection }] : [];
      }
      if (key.startsWith("INSTAGRAM:")) {
        const connection = selectedInstagramByKey.get(key);
        return connection ? [{ key, type: "INSTAGRAM", connection }] : [];
      }
      if (key.startsWith("TIKTOK:")) {
        const connection = selectedTikTokById.get(key.slice("TIKTOK:".length));
        return connection ? [{ key, type: "TIKTOK", connection }] : [];
      }
      return [];
    }),
    [selectedGroupsById, selectedInstagramByKey, selectedTikTokById, selectedProfilesById, selectedTargetKeys],
  );

  const fetchGroupsPage = useCallback(async (page: number, search: string) => {
    setIsLoadingGroups(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(GROUPS_PER_PAGE),
      });
      if (search.trim()) params.set("search", search.trim());
      if (selectedConnectionIds.length > 0) params.set("connectionIds", selectedConnectionIds.join(","));

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
  }, [selectedConnectionIds]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/extensions/connections"),
      fetch("/api/extensions/platform-connections?platform=INSTAGRAM"),
      fetch("/api/extensions/platform-connections?platform=TIKTOK"),
    ])
      .then(async ([facebookResponse, instagramResponse, tiktokResponse]) => [
        facebookResponse.ok ? (await facebookResponse.json()) as FacebookConnection[] : [],
        instagramResponse.ok ? (await instagramResponse.json()) as InstagramConnection[] : [],
        tiktokResponse.ok ? (await tiktokResponse.json()) as TikTokConnection[] : [],
      ] as const)
      .then(([facebookData, instagramData, tiktokData]) => {
        if (cancelled) return;
        setConnections(facebookData);
        setInstagramConnections(instagramData);
        setTikTokConnections(tiktokData);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

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

  const connectionAccountSuffix = useCallback((connection: FacebookConnection) => (
    connection.facebookUserId ? `Account ending ${connection.facebookUserId.slice(-4)}` : "Facebook account"
  ), []);

  const connectionStatus = useCallback((connection: FacebookConnection) => {
    if (connection.status === "CONNECTED") {
      return connection.workerStatus === "PUBLISHING" ? "Publishing" : "Ready";
    }
    return connection.status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }, []);

  const isProfileReady = useCallback((connection: FacebookConnection) => (
    connection.status === "CONNECTED" &&
    Boolean(connection.facebookUserId) &&
    connection.detectedFacebookUserId === connection.facebookUserId
  ), []);

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
    setSelectedTargetKeys((keys) => keys.includes(`GROUP:${group._id}`)
      ? keys.filter((key) => key !== `GROUP:${group._id}`)
      : [...keys, `GROUP:${group._id}`]);
  }, []);

  const selectAll = useCallback(() => {
    setSelectedGroupsById((prev) => {
      const next = new Map(prev);
      for (const group of availableGroups) {
        next.set(group._id, group);
      }
      return next;
    });
    setSelectedTargetKeys((keys) => [
      ...keys,
      ...availableGroups
        .map((group) => `GROUP:${group._id}`)
        .filter((key) => !keys.includes(key)),
    ]);
  }, [availableGroups]);

  const clearGroups = useCallback(() => {
    setSelectedGroupsById(new Map());
    setSelectedTargetKeys((keys) => keys.filter((key) => !key.startsWith("GROUP:")));
  }, []);

  const toggleProfile = useCallback((connection: FacebookConnection) => {
    if (!isProfileReady(connection)) return;
    const key = `PROFILE_FEED:${connection._id}`;
    setSelectedProfilesById((prev) => {
      const next = new Map(prev);
      if (next.has(connection._id)) {
        next.delete(connection._id);
      } else {
        next.set(connection._id, connection);
      }
      return next;
    });
    setSelectedTargetKeys((keys) => keys.includes(key)
      ? keys.filter((item) => item !== key)
      : [...keys, key]);
  }, [isProfileReady]);

  const clearProfiles = useCallback(() => {
    setSelectedProfilesById(new Map());
    setSelectedTargetKeys((keys) => keys.filter((key) => !key.startsWith("PROFILE_FEED:")));
  }, []);

  const updateGroupConnectionFilter = useCallback((connectionIds: string[]) => {
    setSelectedConnectionIds(connectionIds);
    setSelectedGroupsById(new Map());
    setSelectedTargetKeys((keys) => keys.filter((key) => !key.startsWith("GROUP:")));
    setGroupPage(1);
  }, []);

  const toggleGroupConnection = useCallback((connectionId: string) => {
    updateGroupConnectionFilter(
      selectedConnectionIds.includes(connectionId)
        ? selectedConnectionIds.filter((id) => id !== connectionId)
        : [...selectedConnectionIds, connectionId],
    );
  }, [selectedConnectionIds, updateGroupConnectionFilter]);

  const toggleInstagram = useCallback((connection: InstagramConnection) => {
    const key = `INSTAGRAM:${connection._id}`;
    setSelectedInstagramByKey((previous) => {
      const next = new Map(previous);
      if (next.has(key)) next.delete(key);
      else next.set(key, connection);
      return next;
    });
    setSelectedTargetKeys((keys) => keys.includes(key)
      ? keys.filter((item) => item !== key)
      : [...keys, key]);
  }, []);

  const clearInstagram = useCallback(() => {
    setSelectedInstagramByKey(new Map());
    setSelectedTargetKeys((keys) => keys.filter((key) => !key.startsWith("INSTAGRAM:")));
  }, []);

  const toggleTikTok = useCallback((connection: TikTokConnection) => {
    if (!TIKTOK_PUBLISHING_ENABLED || !isTikTokConnectionReady(connection)) return;
    const key = `TIKTOK:${connection._id}`;
    setSelectedTikTokById((previous) => {
      const next = new Map(previous);
      if (next.has(connection._id)) next.delete(connection._id);
      else next.set(connection._id, connection);
      return next;
    });
    setSelectedTargetKeys((keys) => keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]);
  }, []);

  const clearTikTok = useCallback(() => {
    setSelectedTikTokById(new Map());
    setSelectedTargetKeys((keys) => keys.filter((key) => !key.startsWith("TIKTOK:")));
  }, []);

  const clearAll = useCallback(() => {
    setSelectedGroupsById(new Map());
    setSelectedProfilesById(new Map());
    setSelectedInstagramByKey(new Map());
    setSelectedTikTokById(new Map());
    setSelectedTargetKeys([]);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isSubmitting || isReadingMedia) return;
    if (instagramMediaError || tiktokMediaError) {
      setError(instagramMediaError || tiktokMediaError);
      return;
    }

    if (!content.trim() && mediaUrls.length === 0) {
      setError("Please write content or attach at least one image or video.");
      return;
    }
    if (selectedTargetKeys.length === 0) {
      setError("Please select at least one publishing destination.");
      return;
    }
    if (publishMode === "SCHEDULED" && !startTime) {
      setError("Choose a date and time for the scheduled post.");
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
          targets: selectedDestinations.map((destination) => destination.type === "GROUP"
            ? { type: "GROUP", groupId: destination.group._id }
            : destination.type === "PROFILE_FEED"
              ? { type: "PROFILE_FEED", facebookConnectionId: destination.connection._id }
              : destination.type === "TIKTOK"
                ? buildTikTokTarget(destination.connection._id, mediaUrls)
                : buildInstagramTarget(destination.connection._id, mediaUrls)),
          ...(publishMode === "SCHEDULED" && startTime ? { startTime: new Date(startTime).toISOString() } : {}),
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
    !instagramMediaError &&
    !tiktokMediaError &&
    (content.trim().length > 0 || mediaUrls.length > 0) &&
    selectedTargetKeys.length > 0 &&
    (publishMode === "NOW" || Boolean(startTime));
  const selectedGroupConnections = connections.filter((connection) => selectedConnectionIds.includes(connection._id));
  const groupConnectionFilterLabel = selectedGroupConnections.length === 0
    ? "Groups from all profiles"
    : selectedGroupConnections.length === 1
      ? connectionName(selectedGroupConnections[0])
      : selectedGroupConnections.length + " profiles selected";
  const publishTimingLabel = publishMode === "SCHEDULED" && startTime
    ? new Date(startTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "Publish now";

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
      <div className="grid min-h-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
        <div className="space-y-6 p-5 sm:p-6 lg:border-r lg:border-border">
          <section className="space-y-2" aria-labelledby="post-content-label">
            <div className="flex items-center justify-between gap-4">
              <label id="post-content-label" htmlFor="content" className="text-sm font-semibold text-foreground">
                Post content
              </label>
              <span className={isOverLimit ? "text-xs font-medium tabular-nums text-destructive" : "text-xs tabular-nums text-muted-foreground"}>
                {isOverLimit ? Math.abs(charsLeft) + " over" : charsLeft.toLocaleString() + " left"}
              </span>
            </div>

            <div className="overflow-hidden rounded-md border border-border bg-background shadow-sm transition focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/15">
              <textarea
                id="content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Write your post..."
                rows={7}
                className="min-h-44 w-full resize-y bg-transparent px-4 py-3 text-sm leading-6 outline-none placeholder:text-muted-foreground"
              />

              {mediaUrls.length > 0 && (
                <div className="grid grid-cols-2 gap-2 border-t border-border p-3 sm:grid-cols-4">
                  {mediaUrls.map((url, index) => (
                    <div key={url.slice(0, 32) + "-" + index} className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
                      {url.startsWith("data:video/") ? (
                        <video src={url} controls className="h-full w-full object-cover" />
                      ) : (
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      )}
                      <button
                        type="button"
                        onClick={() => removeMedia(index)}
                        className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/95 text-muted-foreground opacity-100 shadow-sm transition-colors hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                        aria-label="Remove media"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex min-h-12 items-center justify-between gap-3 border-t border-border bg-muted/25 px-3 py-2">
                <label
                  className={
                    "inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors " +
                    (isReadingMedia || mediaUrls.length >= MAX_MEDIA_FILES
                      ? "cursor-not-allowed text-muted-foreground opacity-60"
                      : "cursor-pointer text-primary hover:bg-primary/10")
                  }
                >
                  {isReadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  Add media
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={handleMediaChange}
                    disabled={isReadingMedia || mediaUrls.length >= MAX_MEDIA_FILES}
                    className="sr-only"
                  />
                </label>
                <span className="text-xs tabular-nums text-muted-foreground">{mediaUrls.length}/{MAX_MEDIA_FILES}</span>
              </div>
            </div>
          </section>

          {selectedDestinations.length > 0 && (
            <section className="space-y-2" aria-labelledby="selected-destinations-label">
              <div className="flex items-center justify-between gap-3">
                <h3 id="selected-destinations-label" className="text-sm font-semibold text-foreground">Selected destinations</h3>
                <button type="button" onClick={clearAll} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  Clear all
                </button>
              </div>
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                {selectedDestinations.map((destination) => {
                  const label = destination.type === "GROUP"
                    ? destination.group.name
                    : destination.type === "PROFILE_FEED"
                      ? connectionName(destination.connection)
                      : destination.type === "TIKTOK"
                        ? `TikTok · ${getTikTokMediaLabel(mediaUrls)} ${platformConnectionName(destination.connection)}`
                        : `Instagram · ${instagramMedia.label} ${platformConnectionName(destination.connection)}`;
                  return (
                    <span
                      key={destination.key}
                      className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 pl-2.5 pr-1.5 text-xs font-medium text-foreground"
                    >
                      {destination.type !== "GROUP"
                        ? <UserRound className="h-3.5 w-3.5 shrink-0 text-primary" />
                        : <Users className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      <span className="max-w-48 truncate">{label}</span>
                      <button
                        type="button"
                        onClick={() => destination.type === "GROUP"
                          ? toggleGroup(destination.group)
                          : destination.type === "PROFILE_FEED"
                            ? toggleProfile(destination.connection)
                            : destination.type === "TIKTOK" ? toggleTikTok(destination.connection) : toggleInstagram(destination.connection)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                        aria-label={"Remove " + label}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-6 bg-muted/20 p-5 sm:p-6">
          <section className="space-y-3" aria-labelledby="destinations-label">
            <div className="flex items-center justify-between gap-3">
              <h3 id="destinations-label" className="text-sm font-semibold text-foreground">Destinations</h3>
              <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold tabular-nums text-primary">
                {selectedDestinations.length} selected
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                {/* <p className="text-xs font-medium text-muted-foreground">Profile feeds</p> */}
                {selectedProfilesById.size > 0 && <span className="text-[11px] font-medium text-primary">{selectedProfilesById.size} selected</span>}
              </div>
              {connections.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-background/60 px-3 py-4 text-center text-xs text-muted-foreground">
                  No connected Facebook profiles
                </div>
              ) : (
                <Popover open={isProfileMenuOpen} onOpenChange={setIsProfileMenuOpen}>
                  <PopoverTrigger
                    type="button"
                    aria-label={selectedProfilesById.size > 0 ? selectedProfilesById.size + " profile feeds selected" : "Choose profile feeds"}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left shadow-sm transition-colors hover:border-primary/40 focus:outline-none focus:ring-3 focus:ring-ring/20"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                      <UserRound className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {selectedProfilesById.size > 0 ? selectedProfilesById.size + " profile feeds selected" : "Choose profile feeds"}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {connections.filter(isProfileReady).length} available
                      </span>
                    </span>
                    <ChevronDown className={"h-4 w-4 shrink-0 text-muted-foreground transition-transform " + (isProfileMenuOpen ? "rotate-180" : "")} />
                  </PopoverTrigger>

                  <PopoverContent align="start" className="w-(--anchor-width) p-0">
                    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
                      <span className="text-xs font-medium text-muted-foreground">Select profile feeds</span>
                      {selectedProfilesById.size > 0 && (
                        <button type="button" onClick={clearProfiles} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                          Clear
                        </button>
                      )}
                    </div>
                    <div role="listbox" aria-label="Profile feed destinations" aria-multiselectable="true" className="max-h-64 overflow-y-auto p-1.5">
                      {connections.map((connection) => {
                        const ready = isProfileReady(connection);
                        const isSelected = selectedProfilesById.has(connection._id);
                        return (
                          <button
                            key={connection._id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            aria-disabled={!ready}
                            disabled={!ready}
                            onClick={() => toggleProfile(connection)}
                            className={
                              "flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors " +
                              (isSelected
                                ? "bg-primary/10 text-foreground"
                                : ready
                                  ? "text-foreground hover:bg-accent"
                                  : "cursor-not-allowed text-muted-foreground opacity-60")
                            }
                          >
                            {isSelected
                              ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                              : <Square className="h-3.5 w-3.5 shrink-0" />}
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                              <UserRound className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">{connectionName(connection)}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {ready
                                  ? connectionStatus(connection) + " - " + connectionAccountSuffix(connection)
                                  : connection.status === "CONNECTED"
                                    ? "Profile not verified - " + connectionAccountSuffix(connection)
                                    : connectionStatus(connection)}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                      {selectedProfilesById.size} of {connections.filter(isProfileReady).length} selected
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <InstagramDestinationMenu
              mediaSelection={instagramMedia}
              connections={instagramConnections}
              selectedIds={Array.from(selectedInstagramByKey.keys())
                .map((key) => key.slice("INSTAGRAM:".length))}
              publishingEnabled={INSTAGRAM_PUBLISHING_ENABLED}
              onToggle={toggleInstagram}
              onClear={clearInstagram}
            />

            <TikTokDestinationMenu connections={tiktokConnections} selectedIds={Array.from(selectedTikTokById.keys())}
              publishingEnabled={TIKTOK_PUBLISHING_ENABLED} mediaError={getTikTokMediaError(mediaUrls)}
              onToggle={toggleTikTok} onClear={clearTikTok} />

            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-3">
                {/* <p className="text-xs font-medium text-muted-foreground">Facebook groups</p> */}
                {selectedGroupsById.size > 0 && <span className="text-[11px] font-medium text-primary">{selectedGroupsById.size} selected</span>}
              </div>

              {connections.length > 0 && (
                <Popover open={isGroupAccountMenuOpen} onOpenChange={setIsGroupAccountMenuOpen}>
                  <PopoverTrigger
                    type="button"
                    aria-label="Filter groups by Facebook profiles"
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left shadow-sm transition-colors hover:border-primary/40 focus:outline-none focus:ring-3 focus:ring-ring/20"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                      {selectedGroupConnections.length > 0 ? <UserRound className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">{groupConnectionFilterLabel}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">Filter groups by account</span>
                    </span>
                    <ChevronDown className={"h-4 w-4 shrink-0 text-muted-foreground transition-transform " + (isGroupAccountMenuOpen ? "rotate-180" : "")} />
                  </PopoverTrigger>

                  <PopoverContent align="start" className="w-(--anchor-width) p-0">
                    <div className="border-b border-border px-3 py-2.5">
                      <span className="text-xs font-medium text-muted-foreground">Groups from profiles</span>
                    </div>
                    <div role="listbox" aria-label="Facebook accounts for group filtering" aria-multiselectable="true" className="max-h-64 overflow-y-auto p-1.5">
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedConnectionIds.length === 0}
                        onClick={() => updateGroupConnectionFilter([])}
                        className={"flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors " + (selectedConnectionIds.length === 0 ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-accent")}
                      >
                        {selectedConnectionIds.length === 0
                          ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                          : <Square className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><Users className="h-3.5 w-3.5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">All profiles</span>
                          <span className="block truncate text-[11px] text-muted-foreground">Include groups from every account</span>
                        </span>
                      </button>
                      {connections.map((connection) => {
                        const isSelected = selectedConnectionIds.includes(connection._id);
                        return (
                          <button
                            key={connection._id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => toggleGroupConnection(connection._id)}
                            className={"flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors " + (isSelected ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-accent")}
                          >
                            {isSelected
                              ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                              : <Square className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700"><UserRound className="h-3.5 w-3.5" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">{connectionName(connection)}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">{connectionStatus(connection)}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                      {selectedConnectionIds.length === 0 ? "All profiles included" : selectedConnectionIds.length + " of " + connections.length + " selected"}
                    </div>
                  </PopoverContent>
                </Popover>
              )}

              <Popover open={isGroupMenuOpen} onOpenChange={setIsGroupMenuOpen}>
                <PopoverTrigger
                  type="button"
                  aria-label={selectedGroupsById.size > 0 ? selectedGroupsById.size + " target groups selected" : "Choose target groups"}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left shadow-sm transition-colors hover:border-primary/40 focus:outline-none focus:ring-3 focus:ring-ring/20"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                    <Users className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {selectedGroupsById.size > 0 ? selectedGroupsById.size + " groups selected" : "Choose groups"}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {isLoadingGroups ? "Loading..." : groupTotal.toLocaleString() + " available"}
                    </span>
                  </span>
                  <ChevronDown className={"h-4 w-4 shrink-0 text-muted-foreground transition-transform " + (isGroupMenuOpen ? "rotate-180" : "")} />
                </PopoverTrigger>

                <PopoverContent align="start" className="w-(--anchor-width) p-0">
                  <div className="border-b border-border p-2">
                    <div className="flex items-center justify-between gap-3 px-1 pb-2">
                      <span className="text-xs font-medium text-muted-foreground">Select groups</span>
                      <div className="flex items-center gap-3">
                        <button type="button" onClick={selectAll} className="text-xs font-medium text-primary hover:underline">Select visible</button>
                        <button type="button" onClick={clearGroups} className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear</button>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search groups"
                        value={searchQuery}
                        onChange={(event) => {
                          setSearchQuery(event.target.value);
                          setGroupPage(1);
                        }}
                        aria-label="Search target groups"
                        autoFocus
                        className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-3 focus:ring-ring/20"
                      />
                    </div>
                  </div>

                  <div role="listbox" aria-label="Target groups" aria-multiselectable="true" className="max-h-64 overflow-y-auto p-1.5">
                    {availableGroups.length === 0 ? (
                      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {searchQuery ? "No groups match your search." : "No groups synced yet."}
                      </p>
                    ) : availableGroups.map((group) => {
                      const isSelected = selectedGroupsById.has(group._id);
                      return (
                        <button
                          key={group._id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => toggleGroup(group)}
                          className={"flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors " + (isSelected ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                        >
                          {isSelected
                            ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                            : <Square className="h-3.5 w-3.5 shrink-0" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{group.name}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">{connectionLabel(group.facebookConnectionId)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                    <span>{isLoadingGroups ? "Loading..." : "Page " + groupPage + " of " + groupTotalPages}</span>
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
          </section>

          <section className="space-y-3 border-t border-border pt-5" aria-labelledby="publishing-time-label">
            <h3 id="publishing-time-label" className="text-sm font-semibold text-foreground">Publishing time</h3>
            <div className="grid grid-cols-2 rounded-md bg-muted p-1" aria-label="Publishing time" role="group">
              <button
                type="button"
                onClick={() => {
                  setPublishMode("NOW");
                  setStartTime("");
                }}
                className={"inline-flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors " + (publishMode === "NOW" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                aria-pressed={publishMode === "NOW"}
              >
                <Clock3 className="h-3.5 w-3.5" />
                Now
              </button>
              <button
                type="button"
                onClick={() => setPublishMode("SCHEDULED")}
                className={"inline-flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors " + (publishMode === "SCHEDULED" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                aria-pressed={publishMode === "SCHEDULED"}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                Schedule
              </button>
            </div>

            <p className="text-xs leading-5 text-muted-foreground">
              Destinations publish in order with a random 30–120 second gap between each one.
            </p>

            {publishMode === "SCHEDULED" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="start-time" className="text-xs font-medium text-muted-foreground">Date and time</label>
                  <input
                    id="start-time"
                    type="datetime-local"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-3 focus:ring-ring/20"
                  />
                </div>
                {startTime && selectedDestinations.length > 1 && (
                  <div className="max-h-24 space-y-1 overflow-y-auto border-l-2 border-primary/30 pl-3 text-[11px] text-muted-foreground">
                    {selectedDestinations.map((destination, index) => (
                      <div key={destination.key} className="flex justify-between gap-3">
                        <span className="truncate">
                          {destination.type === "GROUP"
                            ? destination.group.name
                            : destination.type === "PROFILE_FEED"
                              ? connectionName(destination.connection) + " - Profile"
                              : destination.type === "TIKTOK"
                                ? `TikTok · ${getTikTokMediaLabel(mediaUrls)} ${platformConnectionName(destination.connection)}`
                                : `Instagram · ${instagramMedia.label} ${platformConnectionName(destination.connection)}`}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {index === 0
                            ? new Date(startTime).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
                            : "30–120 sec after previous"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-border bg-card/95 px-5 py-3 backdrop-blur sm:px-6">
        {error && (
          <div role="alert" className="mb-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-xs font-medium text-foreground">
              {selectedDestinations.length === 0
                ? "No destinations selected"
                : selectedDestinations.length + " destination" + (selectedDestinations.length === 1 ? "" : "s")}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{publishTimingLabel}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel ?? (() => router.back())}
              className="h-9 rounded-md px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-9 min-w-32 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting || isReadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isSubmitting ? "Publishing..." : isReadingMedia ? "Preparing..." : publishMode === "SCHEDULED" ? "Schedule post" : "Publish now"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

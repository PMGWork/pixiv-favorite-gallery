import { useState, useRef, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, X, ExternalLink } from "lucide-react";
import { useSwipeable } from "react-swipeable";
import type { FavoriteItem } from "@random-gallery/shared";

import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogClose,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Skeleton } from "./components/ui/skeleton";

const DEFAULT_COUNT = 20;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

function apiFetch(path: string, options: RequestInit = {}) {
  const url = `${API_BASE_URL}${path}`;
  return fetch(url, options);
}

export default function App() {
  const limit = DEFAULT_COUNT;
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [mode, setMode] = useState<"or" | "and">("or");
  const [appliedTags, setAppliedTags] = useState<string[]>([]);
  const [appliedMode, setAppliedMode] = useState<"or" | "and">("or");
  const [ai, setAi] = useState<"all" | "ai" | "non-ai">("all");
  const [source, setSource] = useState<"pixiv" | "raindrop">("pixiv");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [seed, setSeed] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [selectedItem, setSelectedItem] = useState<FavoriteItem | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isUiHidden, setIsUiHidden] = useState(false);
  const isSwipeActive = useRef(false);

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      if (selectedItem?.source === "pixiv" && selectedItem.pageCount && selectedItem.pageCount > 1) {
        setCurrentPage((p) => Math.min((selectedItem.pageCount || 1) - 1, p + 1));
        isSwipeActive.current = true;
        setTimeout(() => { isSwipeActive.current = false; }, 100);
      }
    },
    onSwipedRight: () => {
      if (selectedItem?.source === "pixiv" && selectedItem.pageCount && selectedItem.pageCount > 1) {
        setCurrentPage((p) => Math.max(0, p - 1));
        isSwipeActive.current = true;
        setTimeout(() => { isSwipeActive.current = false; }, 100);
      }
    },
    preventScrollOnSwipe: true,
    trackMouse: false,
  });

  const parseTagsFromInput = (input: string) => {
    const parts = input
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const tag of parts) {
      const normalized = tag.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(tag);
      }
    }
    return result;
  };

  const addTags = (tagsToAdd: string[]) => {
    setIncludeTags((prev) => {
      const normalized = new Set(prev.map((value) => value.toLowerCase()));
      const next = [...prev];
      for (const tag of tagsToAdd) {
        const trimmed = tag.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (normalized.has(key)) continue;
        normalized.add(key);
        next.push(trimmed);
      }
      return next;
    });
  };

  const filteredItems = useMemo(() => {
    if (appliedTags.length === 0) {
      return items;
    }
    const normalizedTags = appliedTags.map((tag) => tag.toLowerCase());
    return items.filter((item) => {
      const itemTags = (item.tags || []).map((tag) => tag.toLowerCase());
      if (appliedMode === "and") {
        return normalizedTags.every((tag) => itemTags.includes(tag));
      }
      return normalizedTags.some((tag) => itemTags.includes(tag));
    });
  }, [items, appliedTags, appliedMode]);

  const addTagsFromInput = () => {
    const parsed = parseTagsFromInput(tagInput);
    if (parsed.length === 0) {
      return;
    }
    const normalizedExisting = new Set(includeTags.map((value) => value.toLowerCase()));
    const hasNew = parsed.some((tag) => !normalizedExisting.has(tag.toLowerCase()));
    addTags(parsed);
    if (hasNew) {
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setIncludeTags((prev) => prev.filter((value) => value !== tag));
  };

  const handleTagClick = (tag: string, closeModal: boolean) => {
    addTags([tag]);
    if (closeModal) {
      setSelectedItem(null);
      setIsUiHidden(false);
      setCurrentPage(0);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleFetch = async (overrideTags?: string[]) => {
    const activeTags = overrideTags ?? includeTags;
    const tagsParam = activeTags.join(", ");
    setLoading(true);
    setError(null);
    setItems([]);
    setOffset(0);
    setSeed(null);
    setHasMore(true);

    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: "0",
        mode,
        source,
      });
      if (source === "pixiv") {
        params.set("ai", ai);
      }
      if (activeTags.length > 0) {
        params.append("tags", tagsParam);
      }
      const response = await apiFetch(`/favorites?${params.toString()}`);
      if (response.status === 401 || response.status === 403) {
        setError("認証エラー: トークンが無効です。");
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = payload?.error
          ? `API error: ${payload.error}`
          : `API error: ${response.status}`;
        throw new Error(message);
      }
      const data = await response.json();
      setItems(data.data || []);
      setOffset(data.offset || 0);
      setSeed(data.seed || null);
      setHasMore(data.hasMore ?? false);
      setAppliedTags(activeTags);
      setAppliedMode(mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : "読み込みに失敗しました";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore || !seed) return;

    const tagsParam = appliedTags.join(", ");
    setLoadingMore(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        seed: seed,
        mode: appliedMode,
        source,
      });
      if (source === "pixiv") {
        params.set("ai", ai);
      }
      if (appliedTags.length > 0) {
        params.append("tags", tagsParam);
      }
      const response = await apiFetch(`/favorites?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = payload?.error
          ? `API error: ${payload.error}`
          : `API error: ${response.status}`;
        throw new Error(message);
      }
      const data = await response.json();

      const newItems = data.data || [];
      const existingIds = new Set(items.map(item => item.id));
      const uniqueNewItems = newItems.filter((item: FavoriteItem) => !existingIds.has(item.id));

      setItems(prev => [...prev, ...uniqueNewItems]);
      setOffset(data.offset || offset + newItems.length);
      setHasMore(data.hasMore ?? false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "読み込みに失敗しました";
      setError(message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">
            Random Gallery
          </h1>
        </header>

        <Card className="border-border/70 bg-card">
          <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.1fr,1fr]">
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">タグ</p>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addTagsFromInput();
                      }
                    }}
                    placeholder="例: 風景, 夜"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      addTagsFromInput();
                    }}
                    disabled={!tagInput.trim()}
                    size="sm"
                  >
                    追加
                  </Button>
                </div>
                {includeTags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {includeTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-semibold transition hover:bg-accent/80"
                      >
                        {tag}
                        <X className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    タグを未指定の場合は全件から抽出します。
                  </p>
                )}
              </div>
            </div>

            <div className="flex h-full flex-col justify-between gap-6">
              <div className="space-y-3">
                <p className="text-sm font-semibold text-muted-foreground">ソース</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSource("pixiv")}
                    className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      source === "pixiv"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:bg-accent/50"
                    }`}
                  >
                    Pixiv
                  </button>
                  <button
                    type="button"
                    onClick={() => setSource("raindrop")}
                    className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      source === "raindrop"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:bg-accent/50"
                    }`}
                  >
                    Raindrop
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-semibold text-muted-foreground">検索モード</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("or")}
                    className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      mode === "or"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:bg-accent/50"
                    }`}
                  >
                    OR
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("and")}
                    className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      mode === "and"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:bg-accent/50"
                    }`}
                  >
                    AND
                  </button>
                </div>
              </div>

              {source === "pixiv" && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-muted-foreground">AI判定</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setAi("all")}
                      className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        ai === "all"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border hover:bg-accent/50"
                      }`}
                    >
                      全て
                    </button>
                    <button
                      type="button"
                      onClick={() => setAi("ai")}
                      className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        ai === "ai"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border hover:bg-accent/50"
                      }`}
                    >
                      AI
                    </button>
                    <button
                      type="button"
                      onClick={() => setAi("non-ai")}
                      className={`flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        ai === "non-ai"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border hover:bg-accent/50"
                      }`}
                    >
                      非AI
                    </button>
                  </div>
                </div>
              )}

              <Button onClick={(e) => { e.preventDefault(); handleFetch(); }} disabled={loading} size="lg">
                {loading ? "取得中..." : "ランダム取得"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>取得に失敗しました</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && (
          <div className="columns-1 gap-6 sm:columns-2 lg:columns-4">
            {Array.from({ length: limit }).map((_, index) => (
              <Card key={`skeleton-${index}`} className="mb-6 break-inside-avoid overflow-hidden p-0">
                <CardContent className="flex flex-col p-0">
                  <Skeleton className="h-64 w-full" />
                  <div className="bg-muted/90 p-4">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="mt-2 h-3 w-1/2" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <Alert>
            <AlertTitle>まだ取得していません</AlertTitle>
            <AlertDescription>
              右上の「ランダム取得」を押すと、お気に入りのイラストが表示されます。
            </AlertDescription>
          </Alert>
        )}

        {!loading && filteredItems.length > 0 && (
          <div className="columns-1 gap-6 sm:columns-2 lg:columns-4">
            {filteredItems.map((item) => (
              <Card key={item.id} className="mb-6 break-inside-avoid overflow-hidden p-0">
                <CardContent className="group relative p-0">
                    <button
                      onClick={() => {
                        if (item.source === "raindrop") {
                          window.open(item.artworkUrl, "_blank", "noopener,noreferrer");
                          return;
                        }
                        setSelectedItem(item);
                        setCurrentPage(0);
                        setIsUiHidden(true);
                      }}
                      className="block w-full text-left"
                    >
                     <div className="relative overflow-hidden bg-muted">
                        {item.source === "pixiv" && item.aiType === 2 && (
                          <div className="absolute left-2 top-2 z-10 rounded-full bg-purple-500/90 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
                            AI
                          </div>
                        )}
                        {item.source === "pixiv" && item.pageCount && item.pageCount > 1 && (
                          <div className="absolute right-2 top-2 z-10 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
                            {item.pageCount}
                          </div>
                        )}
                        {buildImageUrl(item) ? (
                          <img
                            src={buildImageUrl(item)}
                            alt={item.title}
                            className="w-full object-contain transition-transform duration-500 group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-64 items-center justify-center bg-muted text-sm text-muted-foreground">
                            No image
                          </div>
                        )}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 text-white">
                      <p className="truncate text-sm font-semibold text-white">
                        {item.title}
                      </p>
                      {item.source === "pixiv" ? (
                        item.user?.name && item.userUrl ? (
                          <a
                            href={item.userUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-white/90 hover:text-white"
                            onClick={(e) => e.stopPropagation()}
                          >
                            by {item.user.name}
                          </a>
                        ) : (
                          <p className="text-xs text-white/90">作者情報なし</p>
                        )
                      ) : (
                        <p className="text-xs text-white/90">クリックで開く</p>
                      )}
                      {item.tags && item.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.tags.slice(0, 3).map((tag) => (
                            <button
                              key={`${item.id}-tag-${tag}`}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleTagClick(tag, false);
                              }}
                              className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-white/30"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div className="py-8 flex flex-col items-center gap-4">
            {hasMore && !loadingMore && (
              <Button
                onClick={loadMore}
                disabled={loadingMore}
                variant="secondary"
                size="lg"
              >
                さらに読み込む
              </Button>
            )}
            {loadingMore && (
              <div className="flex items-center justify-center gap-3 text-muted-foreground">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm">読み込み中...</span>
              </div>
            )}
            {!hasMore && (
              <p className="text-center text-sm text-muted-foreground">
                すべての作品を表示しました
              </p>
            )}
          </div>
        )}

        <Dialog open={!!selectedItem} onOpenChange={(open) => {!open && (setSelectedItem(null), setIsUiHidden(false))}}>
          <DialogContent className="max-w-full h-screen p-0 border-0">
            {selectedItem && (
              <div 
                className="relative h-screen w-full cursor-pointer overflow-hidden" 
                onClick={() => {
                  if (!isSwipeActive.current) {
                    setIsUiHidden((v) => !v);
                  }
                }}
                {...swipeHandlers}
              >
                {buildImageUrl(
                  selectedItem,
                  selectedItem.pages && selectedItem.pages.length > 0
                    ? selectedItem.pages[currentPage]
                    : selectedItem.imageUrl
                ) ? (
                  <img
                    src={buildImageUrl(
                      selectedItem,
                      selectedItem.pages && selectedItem.pages.length > 0
                        ? selectedItem.pages[currentPage]
                        : selectedItem.imageUrl
                    )}
                    alt={selectedItem.title}
                    className="h-screen w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">
                    No image
                  </div>
                )}
                {!isUiHidden && selectedItem.source === "pixiv" && selectedItem.aiType === 2 && (
                  <div className="absolute left-4 top-4 rounded-full bg-purple-500/90 px-3 py-1 text-xs font-semibold text-white backdrop-blur transition-all duration-300 ease-out">
                    AI
                  </div>
                )}
                <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-6 transition-all duration-300 ease-out ${
                  isUiHidden ? 'opacity-0 translate-y-4 pointer-events-none' : 'opacity-100 translate-y-0'
                }`}>
                    <div className="flex items-end justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-lg font-semibold text-white">
                          {selectedItem.title}
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                          {selectedItem.user?.name && selectedItem.userUrl && (
                            <a
                              href={selectedItem.userUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-white/90 hover:text-white"
                              onClick={(e) => e.stopPropagation()}
                            >
                              by {selectedItem.user.name}
                            </a>
                          )}
                          {selectedItem.artworkUrl && (
                            <a
                              href={selectedItem.artworkUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-sm text-white/90 hover:text-white transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              {selectedItem.source === "raindrop" ? "Raindropで開く" : "Pixivで開く"}
                            </a>
                          )}
                        </div>
                      </div>
                      {selectedItem.source === "pixiv" && selectedItem.pageCount && selectedItem.pageCount > 1 && (
                        <div className="flex items-center gap-3">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentPage((p) => Math.max(0, p - 1));
                            }}
                            disabled={currentPage === 0}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <span className="text-sm font-semibold text-white">
                            {currentPage + 1} / {selectedItem.pageCount}
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentPage((p) =>
                                Math.min((selectedItem.pageCount || 1) - 1, p + 1)
                              );
                            }}
                            disabled={currentPage >= (selectedItem.pageCount || 1) - 1}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                    {selectedItem.tags && selectedItem.tags.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {selectedItem.tags.map((tag) => (
                          <button
                            key={`modal-tag-${tag}`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleTagClick(tag, true);
                            }}
                            className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/30"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                <div className={`absolute right-4 top-4 transition-all duration-300 ease-out ${
                  isUiHidden ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}>
                  <DialogClose className="rounded-sm bg-black/50 p-2 text-white opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" />
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function buildImageProxyUrl(url?: string) {
  if (!url) {
    return "";
  }
  const params = new URLSearchParams({ url });
  return `${API_BASE_URL}/image?${params.toString()}`;
}

function buildImageUrl(item: FavoriteItem, overrideUrl?: string) {
  const url = overrideUrl || item.imageUrl;
  if (!url) {
    return "";
  }
  if (item.source === "pixiv" || url.includes("pximg.net")) {
    return buildImageProxyUrl(url);
  }
  return url;
}

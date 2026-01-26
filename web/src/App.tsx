import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, LogOut, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogClose,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { RadioGroup, RadioGroupItem } from "./components/ui/radio-group";
import { Skeleton } from "./components/ui/skeleton";
import { Slider } from "./components/ui/slider";

type FavoriteItem = {
  id: number;
  title: string;
  user?: {
    id: number;
    name: string;
  };
  imageUrl?: string;
  artworkUrl: string;
  userUrl?: string;
  pageCount?: number;
  pages?: string[];
  tags?: string[];
};

const DEFAULT_COUNT = 30;

export default function App() {
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [mode, setMode] = useState<"or" | "and">("or");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<FavoriteItem | null>(null);
  const [currentPage, setCurrentPage] = useState(0);

  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/me");
      const data = await res.json();
      setAuthenticated(data.authenticated || false);
      if (!data.authenticated) {
        setAuthError(null);
      }
    } catch (err) {
      setAuthenticated(false);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setAuthError("パスワードが正しくありません。");
        return;
      }
      await checkAuth();
      setPassword("");
    } catch (err) {
      setAuthError("ログインに失敗しました。");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
    } finally {
      setAuthenticated(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const tags = includeTags.join(", ");

  const addTag = (tag: string) => {
    const normalized = includeTags.map((value) => value.toLowerCase());
    if (!tag.trim() || normalized.includes(tag.trim().toLowerCase())) {
      return;
    }
    setIncludeTags((prev) => [...prev, tag.trim()]);
  };

  const removeTag = (tag: string) => {
    setIncludeTags((prev) => prev.filter((value) => value !== tag));
  };

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        count: String(count),
        mode,
      });
      if (includeTags.length > 0) {
        params.append("tags", tags);
      }
      const response = await fetch(`/api/favorites?${params.toString()}`);
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) {
        throw new Error(`Pixiv API error: ${response.status}`);
      }
      const data = await response.json();
      setItems(data.data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "読み込みに失敗しました";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">
            Pixiv Favorite Gallery
          </h1>
          {authenticated && (
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="h-4 w-4" />
              ログアウト
            </button>
          )}
        </header>

        {authLoading ? (
          <div className="py-20 text-center text-muted-foreground">
            読み込み中...
          </div>
        ) : !authenticated ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-full max-w-sm">
              <Card>
                <CardContent className="p-6">
                  <h2 className="text-lg font-semibold mb-2">ログイン</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    閲覧にはパスワードが必要です。
                  </p>
                  <form onSubmit={handleLogin}>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="パスワード"
                      disabled={authSubmitting}
                      className="mb-3"
                    />
                    <Button
                      type="submit"
                      disabled={authSubmitting}
                      className="w-full"
                    >
                      {authSubmitting ? "ログイン中..." : "ログイン"}
                    </Button>
                  </form>
                  {authError && (
                    <p className="mt-3 text-sm text-destructive">
                      {authError}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <>
            <Card className="border-border/70 bg-card">
              <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.1fr,1fr]">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground">表示枚数</p>
                    <div className="mt-3 flex items-center gap-4">
                      <Slider
                        min={10}
                        max={50}
                        step={1}
                        value={[count]}
                        onValueChange={(value) => setCount(value[0])}
                        className="flex-1"
                      />
                      <div className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground">
                        {count}枚
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-muted-foreground">タグ</p>
                    <div className="mt-2 flex gap-2">
                      <Input
                        value={tagInput}
                        onChange={(event) => setTagInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addTag(tagInput);
                            setTagInput("");
                          }
                        }}
                        placeholder="例: 風景"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        onClick={() => {
                          addTag(tagInput);
                          setTagInput("");
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
                    <p className="text-sm font-semibold text-muted-foreground">検索モード</p>
                    <RadioGroup
                      value={mode}
                      onValueChange={(value) => setMode(value as "or" | "and")}
                      className="grid gap-3"
                    >
                      <label className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium">
                        <RadioGroupItem value="or" id="mode-or" />
                        <span>OR検索（いずれか一致）</span>
                      </label>
                      <label className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium">
                        <RadioGroupItem value="and" id="mode-and" />
                        <span>AND検索（すべて一致）</span>
                      </label>
                    </RadioGroup>
                  </div>

                  <Button onClick={handleFetch} disabled={loading} size="lg">
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
                {Array.from({ length: count }).map((_, index) => (
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

            {!loading && items.length > 0 && (
              <div className="columns-1 gap-6 sm:columns-2 lg:columns-4">
                {items.map((item) => (
                  <Card key={item.id} className="mb-6 break-inside-avoid overflow-hidden p-0">
                    <CardContent className="group relative p-0">
                      <button
                        onClick={() => {
                          setSelectedItem(item);
                          setCurrentPage(0);
                        }}
                        className="block w-full text-left"
                      >
                        <div className="relative overflow-hidden bg-muted">
                          {item.pageCount && item.pageCount > 1 && (
                            <div className="absolute right-2 top-2 z-10 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
                              📄 {item.pageCount}
                            </div>
                          )}
                          <img
                            src={buildImageProxyUrl(item.imageUrl)}
                            alt={item.title}
                            className="w-full object-contain transition-transform duration-500 group-hover:scale-105"
                            loading="lazy"
                          />
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 text-white">
                          <p className="truncate text-sm font-semibold text-white">
                            {item.title}
                          </p>
                          {item.user?.name && item.userUrl ? (
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
                          )}
                          {item.tags && item.tags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {item.tags.slice(0, 3).map((tag) => (
                                <button
                                  key={`${item.id}-tag-${tag}`}
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    addTag(tag);
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

            <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
              <DialogContent className="max-w-full h-screen p-0 border-0">
                {selectedItem && (
                  <div className="relative h-screen w-full">
                    <img
                      src={buildImageProxyUrl(
                        selectedItem.pages && selectedItem.pages.length > 0
                          ? selectedItem.pages[currentPage]
                          : selectedItem.imageUrl
                      )}
                      alt={selectedItem.title}
                      className="h-screen w-full object-contain"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-6">
                      <div className="flex items-end justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-lg font-semibold text-white">
                            {selectedItem.title}
                          </p>
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
                        </div>
                        {selectedItem.pageCount && selectedItem.pageCount > 1 && (
                          <div className="flex items-center gap-3">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
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
                              onClick={() =>
                                setCurrentPage((p) =>
                                  Math.min((selectedItem.pageCount || 1) - 1, p + 1)
                                )
                              }
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
                                addTag(tag);
                              }}
                              className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/30"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <DialogClose className="absolute right-4 top-4 rounded-sm bg-black/50 p-2 text-white opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" />
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
}

function buildImageProxyUrl(url?: string) {
  if (!url) {
    return "";
  }
  const params = new URLSearchParams({ url });
  return `/api/image?${params.toString()}`;
}

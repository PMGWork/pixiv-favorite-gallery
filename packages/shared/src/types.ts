export type FavoriteItem = {
  id: number | string;
  source: "pixiv" | "raindrop";
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
  aiType?: number;
};

export type FavoritesResponse = {
  data: FavoriteItem[];
  offset: number;
  hasMore: boolean;
  total: number;
  seed: string;
};

export type FavoritesQuery = {
  limit: number;
  offset: number;
  seed?: string;
  tags?: string;
  mode: "or" | "and";
  ai?: "all" | "ai" | "non-ai";
  source: "pixiv" | "raindrop";
};

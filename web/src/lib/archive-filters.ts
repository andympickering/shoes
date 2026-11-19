export interface ArticleFilters {
  source: string;
  headline: string;
  headlineOnly: boolean;
  publishedFrom: string;
  publishedTo: string;
}

export function archiveFiltersFromSearchParams(params: URLSearchParams): ArticleFilters {
  return {
    source: "",
    headline: params.get("headline") ?? "",
    headlineOnly: false,
    publishedFrom: params.get("publishedFrom") ?? "",
    publishedTo: params.get("publishedTo") ?? "",
  };
}

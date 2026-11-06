"use client";

import { useEffect, useState } from "react";
import { getSourceLabel } from "@/lib/source-label";

interface Article {
  id: string;
  source: string;
  headline: string;
  display_date: string;
  relevance_score: number;
}

interface ArticleFilters {
  source: string;
  headline: string;
  headlineOnly: boolean;
  publishedFrom: string;
  publishedTo: string;
}

const pageSize = 50;

export default function Home() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [filters, setFilters] = useState<ArticleFilters>({
    source: "",
    headline: "",
    headlineOnly: false,
    publishedFrom: "",
    publishedTo: "",
  });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [articleError, setArticleError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSources() {
      try {
        const response = await fetch("/api/articles?sources=1", {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load sources");
        setSources(data.sources);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setSourceError(
          error instanceof Error ? error.message : "Could not load sources"
        );
      }
    }

    loadSources();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setArticleError(null);

      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        Object.entries(filters).forEach(([key, value]) => {
          if (typeof value === "string" && value) params.set(key, value);
        });
        if (filters.headlineOnly) params.set("headlineOnly", "true");

        const response = await fetch(`/api/articles?${params}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load articles");
        setArticles(data.articles);
        setTotal(data.total);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setArticleError(
          error instanceof Error ? error.message : "Could not load articles"
        );
        setArticles([]);
        setTotal(0);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [filters, page]);

  function updateFilter(
    field: keyof ArticleFilters,
    value: ArticleFilters[keyof ArticleFilters]
  ) {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  }

  function formatDate(value: string) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? "";
    return `${part("day")}-${part("month")}-${part("year")}`;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-xl font-semibold">中国新闻档案</h1>
        </div>
      </header>

      <main className="w-full py-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <p className="text-xs text-stone-600 dark:text-stone-400" aria-live="polite">
            {loading ? "Loading articles…" : `${total.toLocaleString()} articles`}
          </p>
          {(sourceError || articleError) && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {sourceError || articleError}
            </p>
          )}
        </div>

        <div className="overflow-x-auto border-y border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <table className="w-full min-w-[700px] table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-14" />
              <col />
              <col className="w-[20ch]" />
              <col className="w-[42ch]" />
            </colgroup>
            <thead className="bg-stone-50 dark:bg-stone-800/70">
              <tr className="text-[10px] font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-300">
                <th scope="col" className="px-2 pb-1 pt-2">Score</th>
                <th scope="col" className="px-2 pb-1 pt-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>Headline</span>
                    <label className="flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal">
                      <input
                        type="checkbox"
                        checked={filters.headlineOnly}
                        onChange={(event) => updateFilter("headlineOnly", event.target.checked)}
                        className="h-3 w-3 accent-amber-600"
                      />
                      Search only headline
                    </label>
                  </div>
                </th>
                <th scope="col" className="px-2 pb-1 pt-2">Source</th>
                <th scope="col" className="px-2 pb-1 pt-2">Published</th>
              </tr>
              <tr className="border-b border-stone-200 dark:border-stone-700">
                <th className="px-2 pb-2 pt-0" aria-label="No score filter" />
                <th className="px-2 pb-2 pt-0">
                  <label htmlFor="headline-filter" className="sr-only">
                    Filter headline with regex
                  </label>
                  <input
                    id="headline-filter"
                    type="text"
                    value={filters.headline}
                    onChange={(event) => updateFilter("headline", event.target.value)}
                    placeholder='term AND term OR "phrase"'
                    className="w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-xs normal-case text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100"
                  />
                </th>
                <th className="px-2 pb-2 pt-0">
                  <label htmlFor="source-filter" className="sr-only">
                    Filter by source
                  </label>
                  <select
                    id="source-filter"
                    value={filters.source}
                    onChange={(event) => updateFilter("source", event.target.value)}
                    className="w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-xs normal-case text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100"
                  >
                    <option value="">All sources</option>
                    {sources.map((source) => (
                      <option key={source} value={source}>{getSourceLabel(source)}</option>
                    ))}
                  </select>
                </th>
                <th className="px-2 pb-2 pt-0">
                  <fieldset>
                    <legend className="sr-only">Filter by published date or date range</legend>
                    <div className="flex gap-2">
                      <label className="flex min-w-0 items-center gap-1 text-[10px] font-normal leading-3 text-stone-500 dark:text-stone-400">
                        From
                        <input
                          aria-label="Published date from"
                          type="date"
                          value={filters.publishedFrom}
                          max={filters.publishedTo || undefined}
                          onChange={(event) => updateFilter("publishedFrom", event.target.value)}
                          className="w-28 min-w-0 rounded-md border border-stone-300 bg-white px-1 py-1 text-[10px] font-normal text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100"
                        />
                      </label>
                      <label className="flex min-w-0 items-center gap-1 text-[10px] font-normal leading-3 text-stone-500 dark:text-stone-400">
                        To
                        <input
                          aria-label="Published date to"
                          type="date"
                          value={filters.publishedTo}
                          min={filters.publishedFrom || undefined}
                          onChange={(event) => updateFilter("publishedTo", event.target.value)}
                          className="w-28 min-w-0 rounded-md border border-stone-300 bg-white px-1 py-1 text-[10px] font-normal text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100"
                        />
                      </label>
                    </div>
                  </fieldset>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {articles.map((article) => (
                <tr key={article.id} className="align-top hover:bg-amber-50/50 dark:hover:bg-stone-800/40">
                  <td className="whitespace-nowrap px-2 py-2 text-stone-600 dark:text-stone-300">
                    {filters.headline.trim() ? article.relevance_score : "—"}
                  </td>
                  <td className="break-words px-3 py-2 text-base font-medium">
                    <a
                      href={`/articles/${article.id}`}
                      className="text-amber-800 underline decoration-amber-800/30 underline-offset-2 hover:text-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-amber-300 dark:decoration-amber-300/40 dark:hover:text-amber-200"
                    >
                      {article.headline}
                    </a>
                  </td>
                  <td className="break-words px-3 py-2 font-medium">{getSourceLabel(article.source)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-600 dark:text-stone-300">
                    {formatDate(article.display_date)}
                  </td>
                </tr>
              ))}
              {!loading && articles.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-stone-500 dark:text-stone-400">
                    {articleError ? "Articles could not be loaded." : "No articles match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <nav
          aria-label="Article pages"
          className="mt-3 flex items-center justify-end gap-3 px-4 text-sm text-stone-600 dark:text-stone-400 sm:px-6 lg:px-8"
        >
          <span>Page {page} of {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
            className="rounded-md border border-stone-300 px-3 py-2 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-md border border-stone-300 px-3 py-2 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            Next
          </button>
        </nav>
      </main>
    </div>
  );
}

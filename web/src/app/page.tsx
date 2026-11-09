"use client";

import { useEffect, useState } from "react";
import { AlertControls } from "@/components/alert-controls";
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

const pageSize = 49;

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
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b-2 border-amber-400 bg-white dark:border-amber-500 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-700 text-lg font-semibold text-amber-300 shadow-sm dark:bg-red-800">
              中
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-800 dark:text-red-300">
                Chinese News Archive
              </p>
              <h1 className="text-lg font-semibold tracking-tight">中国新闻档案</h1>
            </div>
          </div>
          <AlertControls />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-2 py-4 sm:px-4 sm:py-6 lg:px-6">
        {(sourceError || articleError) && (
          <p
            role="alert"
            className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {sourceError || articleError}
          </p>
        )}

        <section
          aria-label="Filter articles"
          className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-3"
        >
          <div className="overflow-x-auto">
            <div className="grid min-w-[820px] grid-cols-[minmax(340px,5fr)_minmax(160px,3fr)_minmax(280px,4fr)] items-end gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <label htmlFor="headline-filter" className="sr-only">
                  Filter headline with regex
                </label>
                <input
                  id="headline-filter"
                  type="text"
                  value={filters.headline}
                  onChange={(event) => updateFilter("headline", event.target.value)}
                  placeholder='term AND term OR "phrase"'
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={filters.headlineOnly}
                    onChange={(event) => updateFilter("headlineOnly", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-red-700 focus:ring-red-700 dark:border-slate-600"
                  />
                  Headline only
                </label>
              </div>
              <div className="min-w-0">
                <label htmlFor="source-filter" className="sr-only">
                  Filter by source
                </label>
                <select
                  id="source-filter"
                  value={filters.source}
                  onChange={(event) => updateFilter("source", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">All sources</option>
                  {sources.map((source) => (
                    <option key={source} value={source}>{getSourceLabel(source)}</option>
                  ))}
                </select>
              </div>
              <fieldset className="flex min-w-0 items-center gap-1.5">
                <legend className="sr-only">Filter by published date range</legend>
                <label className="flex min-w-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  From
                  <input
                    aria-label="Published date from"
                    type="date"
                    value={filters.publishedFrom}
                    max={filters.publishedTo || undefined}
                    onChange={(event) => updateFilter("publishedFrom", event.target.value)}
                    className="min-w-0 rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-xs text-slate-900 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
                <label className="flex min-w-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  To
                  <input
                    aria-label="Published date to"
                    type="date"
                    value={filters.publishedTo}
                    min={filters.publishedFrom || undefined}
                    onChange={(event) => updateFilter("publishedTo", event.target.value)}
                    className="min-w-0 rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-xs text-slate-900 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
              </fieldset>
            </div>
          </div>
        </section>

        <p
          className="mb-1 text-xs text-slate-500 dark:text-slate-400"
          aria-live="polite"
        >
          {loading ? "Loading articles…" : `${total.toLocaleString()} articles`}
        </p>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-16" />
              <col />
              <col className="w-[20ch]" />
              <col className="w-[18ch]" />
            </colgroup>
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th scope="col" className="px-3 py-2.5">Score</th>
                <th scope="col" className="px-3 py-2.5">Headline</th>
                <th scope="col" className="px-3 py-2.5">Source</th>
                <th scope="col" className="px-3 py-2.5">Published</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {articles.map((article) => (
                <tr key={article.id} className="align-top transition-colors hover:bg-red-50/70 dark:hover:bg-red-950/30">
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {filters.headline.trim() ? article.relevance_score : ""}
                  </td>
                  <td className="break-words px-3 py-3 text-sm font-medium leading-6">
                    <a
                      href={`/articles/${article.id}`}
                      className="text-slate-950 decoration-red-700/40 underline-offset-4 hover:text-red-800 hover:underline focus:outline-none focus:ring-2 focus:ring-red-700 dark:text-white dark:hover:text-red-300"
                    >
                      {article.headline}
                    </a>
                  </td>
                  <td className="break-words px-3 py-3 text-slate-700 dark:text-slate-300">{getSourceLabel(article.source)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-500 dark:text-slate-400">
                    {formatDate(article.display_date)}
                  </td>
                </tr>
              ))}
              {!loading && articles.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {articleError ? "Articles could not be loaded." : "No articles match these filters."}
                    </p>
                    {!articleError && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Try adjusting your search or filters.
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        <nav
          aria-label="Article pages"
          className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
        >
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Page <span className="font-medium text-slate-700 dark:text-slate-300">{page}</span> of {totalPages}
          </span>
          <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Next
          </button>
          </div>
        </nav>
      </main>
    </div>
  );
}

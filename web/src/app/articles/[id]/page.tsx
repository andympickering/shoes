"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getSourceLabel } from "@/lib/source-label";

interface Article {
  id: string;
  source: string;
  headline: string;
  story_text: string;
  url: string;
}

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadArticle() {
      try {
        const response = await fetch(`/api/articles/${encodeURIComponent(id)}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load article");
        setArticle(data.article);
      } catch (loadError) {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(
          loadError instanceof Error ? loadError.message : "Could not load article"
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadArticle();
    return () => controller.abort();
  }, [id]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b-2 border-amber-400 bg-white dark:border-amber-500 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <a href="/" aria-label="Chinese News Archive home" className="flex items-center gap-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-700">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-700 text-lg font-semibold text-amber-300 shadow-sm dark:bg-red-800">
              中
            </span>
            <span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-red-800 dark:text-red-300">
                Chinese News Archive
              </span>
              <span className="block text-lg font-semibold tracking-tight">中国新闻档案</span>
            </span>
          </a>
        </div>
      </header>

      <article className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <a
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-red-800 hover:text-red-950 focus:outline-none focus:ring-2 focus:ring-red-700 dark:text-red-300 dark:hover:text-red-200"
        >
          <span aria-hidden="true">&larr;</span> Back to archive
        </a>

        {loading && (
          <p className="py-12 text-center text-slate-500 dark:text-slate-400" aria-live="polite">
            Loading article…
          </p>
        )}

        {!loading && error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {error}
          </p>
        )}

        {!loading && article && (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-5 dark:border-slate-800">
                <span className="rounded-full border border-amber-300 bg-red-50 px-3 py-1 text-xs font-medium text-red-900 dark:border-amber-700 dark:bg-red-950 dark:text-amber-200">
                  {getSourceLabel(article.source)}
                </span>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-red-800 underline decoration-red-700/30 underline-offset-4 hover:text-red-950 focus:outline-none focus:ring-2 focus:ring-red-700 dark:text-red-300 dark:hover:text-red-200"
                >
                  View original article <span aria-hidden="true">↗</span>
                </a>
              </div>
              <h1 className="mt-6 text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
                {article.headline}
              </h1>
              <div className="mt-7 whitespace-pre-wrap break-words border-t border-slate-100 pt-6 text-base leading-8 text-slate-700 dark:border-slate-800 dark:text-slate-300">
                {article.story_text}
              </div>
              <p className="mt-8 border-t border-slate-100 pt-4 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                Article ID: <span className="break-all font-mono">{article.id}</span>
              </p>
            </div>
          </>
        )}
      </article>
    </main>
  );
}

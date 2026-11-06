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
    <main className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      {!loading && article && (
        <header className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 border-y border-stone-200 bg-white px-4 py-5 text-sm dark:border-stone-800 dark:bg-stone-900 sm:px-8 lg:px-12">
          <span className="min-w-0 break-all text-left text-stone-500 dark:text-stone-400">
            ID: {article.id}
          </span>
          <span className="max-w-[30vw] break-words text-center font-semibold">
            {getSourceLabel(article.source)}
          </span>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="justify-self-end text-right font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300"
          >
            Link to article
          </a>
        </header>
      )}

      <article className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <a
          href="/"
          className="mb-5 inline-flex text-sm font-medium text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300"
        >
          &larr; Back to articles
        </a>

        {loading && (
          <p className="py-12 text-center text-stone-500 dark:text-stone-400" aria-live="polite">
            Loading article…
          </p>
        )}

        {!loading && error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-4 py-3 text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        {!loading && article && (
          <>
            <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              {article.headline}
            </h1>
            <div className="mt-6 whitespace-pre-wrap break-words text-base leading-8 text-stone-700 dark:text-stone-300">
              {article.story_text}
            </div>
          </>
        )}
      </article>
    </main>
  );
}

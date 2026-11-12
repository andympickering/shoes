export function getSafeRedirectPath(value: string | null, origin: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const destination = new URL(value, origin);
    if (destination.origin !== origin) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}

export function getSourceLabel(source: string) {
  if (source === "gmw") return "Guangming Online";
  return source === "people" ? "People's Daily" : source;
}

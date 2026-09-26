export function readingProgress(entry) {
  const { page, status } = entry.personal;
  const total = entry.metadata.pageCount;
  const percent =
    status === "finished"
      ? 100
      : total
        ? Math.min(100, Math.round((page / total) * 100))
        : null;
  const label =
    status === "finished"
      ? "Finished"
      : page > 0
        ? `Page ${page}${total ? ` of ${total}` : " · total unknown"}`
        : "Not started yet";
  return { percent, label };
}
export function continueReading(entries) {
  return entries
    .filter((e) => e.personal.status === "reading")
    .sort((a, b) => b.personal.updatedAt - a.personal.updatedAt)
    .slice(0, 3);
}

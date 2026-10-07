export const adultRatings = new Set(['erotica', 'pornographic', 'adult']);
export const isAdult = item => item.is_adult !== undefined ? Boolean(item.is_adult) : adultRatings.has(item.contentRating);
export const isPublicReading = item => !item.is_private && !isAdult(item);
export function inLibraryScope(item, scope = 'library') {
  if (scope === 'private') return Boolean(item.is_private);
  if (scope === 'adult') return !item.is_private && isAdult(item);
  return !item.is_private;
}

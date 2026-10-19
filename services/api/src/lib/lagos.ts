/** Lagos is UTC+1 all year (no daylight saving), so calendar days are fixed one-hour offsets from UTC. */
export const LAGOS_OFFSET_MS = 60 * 60 * 1000;
/** The Lagos calendar date (YYYY-MM-DD) of an instant. */
export const lagosDate = (d: Date) => new Date(d.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
/** The UTC instant at which a Lagos calendar date begins. */
export const lagosDayStartUtc = (isoDate: string) => new Date(Date.parse(`${isoDate}T00:00:00Z`) - LAGOS_OFFSET_MS);

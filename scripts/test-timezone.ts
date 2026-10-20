/**
 * Preloaded first by `bun test`. The tests of dates around a daylight-saving change only cross one when the process
 * runs in a zone that has it, and a shell's zone may be UTC, so every run uses the zone `bun run vectors` records in.
 */
process.env.TZ = 'America/New_York';

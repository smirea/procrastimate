/** The Worker's Cron Triggers, each with the Sentry monitor that alerts when it stops running. `wrangler.jsonc` lists the same schedules. */
export const CRONS = {
	delivery: { schedule: '* * * * *', monitor: 'push-delivery' },
	backup: { schedule: '0 9 * * *', monitor: 'daily-backup' },
} as const;
export type CronName = keyof typeof CRONS;

export function cronNamed(schedule: string): CronName {
	const name = (Object.keys(CRONS) as CronName[]).find(key => CRONS[key].schedule === schedule);
	if (!name) throw new Error(`No cron runs on "${schedule}"`);
	return name;
}

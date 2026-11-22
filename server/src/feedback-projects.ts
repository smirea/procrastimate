import { and, eq } from 'drizzle-orm';
import type { FeedbackProject, FeedbackProjects } from '../../shared/api/contract';
import type { Actor } from '../../shared/auth';
import { access, projects, sections } from '../../shared/db/schema';
import { compareNames } from '../../shared/order';
import type { Db } from './db/sqlite';
import { peopleById, unknownPerson } from './people';

type Ordered = { order: number; createdAt: number };
const byOrder = (a: Ordered, b: Ordered) => a.order - b.order || a.createdAt - b.createdAt;

function sectionsByProject(db: Db, owner: string): Map<string, { id: string; name: string }[]> {
	const rows = db.select().from(sections).where(eq(sections.userId, owner)).all().toSorted(byOrder);
	const grouped = new Map<string, { id: string; name: string }[]>();
	for (const row of rows) {
		const list = grouped.get(row.projectId);
		if (list) list.push({ id: row.id, name: row.name });
		else grouped.set(row.projectId, [{ id: row.id, name: row.name }]);
	}
	return grouped;
}

/**
 * Every project the signed-in human may file feedback into: their own projects in order, followed by every project
 * another user shared with them for editing, grouped by owner name. Never reads tasks.
 */
export async function feedbackProjects(db: Db, actor: Actor, space?: string): Promise<FeedbackProjects> {
	const own: FeedbackProject[] = [];
	if (!space || space === actor.id) {
		const ownProjects = db.select().from(projects).where(eq(projects.userId, actor.id)).all().toSorted(byOrder);
		const ownSections = ownProjects.length ? sectionsByProject(db, actor.id) : new Map();
		for (const project of ownProjects) {
			own.push({
				id: project.id,
				name: project.name,
				icon: project.icon ?? null,
				owner: null,
				sections: ownSections.get(project.id) ?? [],
			});
		}
	}

	const shared: FeedbackProject[] = [];
	if (!space || space !== actor.id) {
		const rows = db
			.select({
				owner: access.owner,
				id: projects.id,
				name: projects.name,
				icon: projects.icon,
				order: projects.order,
				createdAt: projects.createdAt,
			})
			.from(access)
			.innerJoin(projects, and(eq(projects.userId, access.owner), eq(projects.id, access.entityId)))
			.where(
				and(
					eq(access.grantee, actor.id),
					eq(access.kind, 'project'),
					eq(access.role, 'edit'),
					space ? eq(access.owner, space) : undefined,
				),
			)
			.all();
		if (rows.length) {
			const ownerIds = [...new Set(rows.map(row => row.owner))];
			const owners = await peopleById(db, ownerIds);
			const sectionsByOwner = new Map(ownerIds.map(owner => [owner, sectionsByProject(db, owner)]));
			const grouped = [...Map.groupBy(rows, row => row.owner)].toSorted(([a], [b]) => {
				const personA = owners.get(a) ?? unknownPerson(a);
				const personB = owners.get(b) ?? unknownPerson(b);
				return compareNames(personA.name, personB.name) || (a < b ? -1 : a > b ? 1 : 0);
			});
			for (const [ownerId, ownerRows] of grouped) {
				const owner = owners.get(ownerId) ?? unknownPerson(ownerId);
				const ownerSections = sectionsByOwner.get(ownerId)!;
				for (const project of ownerRows.toSorted(byOrder)) {
					shared.push({
						id: project.id,
						name: project.name,
						icon: project.icon ?? null,
						owner,
						sections: ownerSections.get(project.id) ?? [],
					});
				}
			}
		}
	}

	return {
		user: { id: actor.id, name: actor.name, kind: actor.kind, ownerId: actor.ownerId },
		projects: [...own, ...shared],
	};
}

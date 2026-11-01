import type { CrmRoom } from './contracts';
import { boundedCrmRooms, type CrmMotionPoint } from './motion';

type Project = (x: number, y: number, z?: number) => CrmMotionPoint;
export type FacilityViewBox = { x: number; y: number; width: number; height: number };

/** Fit saved geometry, including walls and stage anchors, without moving a room. */
export function crmFacilityViewBox(input: readonly CrmRoom[], project: Project, actorPoints: readonly CrmMotionPoint[] = []): FacilityViewBox | null {
  const rooms = boundedCrmRooms(input);
  if (!rooms.length) return null;
  const points = rooms.flatMap(room => [
    project(room.x - 1, room.y - 1, 90), project(room.x + room.width + 1, room.y - 1, 90),
    project(room.x + room.width + 1, room.y + room.depth + 1, -18), project(room.x - 1, room.y + room.depth + 1, -18),
  ]);
  for (const point of actorPoints.slice(0, 500)) if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
    points.push(project(point.x, point.y, 90), project(point.x, point.y, -12));
  }
  const x = Math.min(...points.map(point => point.x)) - 24, y = Math.min(...points.map(point => point.y)) - 18;
  return { x, y, width: Math.max(260, Math.max(...points.map(point => point.x)) - x + 24),
    height: Math.max(240, Math.max(...points.map(point => point.y)) - y + 18) };
}

/** Co-located records become one honest count; no invented physical spacing/routes. */
export function crmFacilityActorGroups<T extends { key: string; point: CrmMotionPoint }>(actors: readonly T[], project: Project, roomId: (actor: T) => string) {
  const groups: { actor: T; members: T[] }[] = [];
  for (const actor of actors.slice(0, 48)) {
    const point = project(actor.point.x, actor.point.y);
    const nearby = groups.find(group => {
      const anchor = project(group.actor.point.x, group.actor.point.y);
      return roomId(group.actor) === roomId(actor) && Math.abs(point.x - anchor.x) < 44 && Math.abs(point.y - anchor.y) < 75;
    });
    if (nearby) nearby.members.push(actor); else groups.push({ actor, members: [actor] });
  }
  return groups;
}

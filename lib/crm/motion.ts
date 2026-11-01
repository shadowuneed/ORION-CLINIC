import type { CrmBuilding, CrmRoom, CrmSnapshot, CrmStaff, CrmVisit } from './contracts';

export type CrmMotionPoint = Readonly<{ x: number; y: number }>;
export const CRM_SCENE_VISIT_LIMIT = 24;
export const CRM_SCENE_STAFF_LIMIT = 24;
export const CRM_SCENE_MOVING_LIMIT = 24;
const clearance = .55;
const epsilon = .00001;

const finitePoint = (point: CrmMotionPoint) => Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 202 && Math.abs(point.y) <= 202;
const validRoom = (room: CrmRoom) => [room.x, room.y, room.width, room.depth].every(Number.isFinite) &&
  room.x >= 0 && room.y >= 0 && room.x <= 100 && room.y <= 100 && room.width > 0 && room.width <= 100 && room.depth > 0 && room.depth <= 100;
export const boundedCrmRooms = (rooms: readonly CrmRoom[]) => rooms.slice(0, 100).filter(validRoom);

/** Stable visual variation only, never a timer, status, priority or identity decision. */
export function crmMotionSeed(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return hash >>> 0;
}
export function crmSceneExtent(rooms: readonly CrmRoom[]) {
  return boundedCrmRooms(rooms).reduce((extent, room) => ({ x: Math.max(extent.x, room.x + room.width), y: Math.max(extent.y, room.y + room.depth) }), { x: 8, y: 8 });
}

export function crmMapGeometry(rooms: readonly CrmRoom[], gameMode = false, primary?: CrmBuilding) {
  const { x: extentX, y: extentY } = crmSceneExtent(rooms);
  // Keep the original six-room scale. More saved buildings enlarge the world,
  // not existing rooms/people or a forced fit of all records into one postcard.
  const scale = gameMode ? 660 / 28 : Math.min(29, 660 / (extentX + extentY));
  const centre = gameMode && primary ? primary.x + primary.width / 2 - primary.y - primary.depth / 2 : (extentX - extentY) / 2;
  const project = (x: number, y: number, z = 0) => ({
    x: 500 + (x - y - centre) * scale,
    y: 165 + (x + y) * scale * .53 - z,
  });
  return { extentX, extentY, scale, project };
}

function segmentClear(a: CrmMotionPoint, b: CrmMotionPoint, rooms: readonly CrmRoom[]) {
  if (!finitePoint(a) || !finitePoint(b) || (Math.abs(a.x - b.x) > epsilon && Math.abs(a.y - b.y) > epsilon)) return false;
  const horizontal = Math.abs(a.y - b.y) <= epsilon;
  return rooms.every(room => {
    // Keep avatars a little away from floor edges rather than clipping a wall.
    const left = room.x - .16, right = room.x + room.width + .16;
    const top = room.y - .16, bottom = room.y + room.depth + .16;
    return horizontal
      ? a.y < top || a.y > bottom || Math.max(a.x, b.x) < left || Math.min(a.x, b.x) > right
      : a.x < left || a.x > right || Math.max(a.y, b.y) < top || Math.min(a.y, b.y) > bottom;
  });
}
function compactPath(path: readonly CrmMotionPoint[]) {
  return path.filter((point, index) => !index || Math.abs(point.x - path[index - 1].x) + Math.abs(point.y - path[index - 1].y) > epsilon);
}
export function crmPathLength(path: readonly CrmMotionPoint[]) {
  return path.reduce((length, point, index) => index ? length + Math.hypot(point.x - path[index - 1].x, point.y - path[index - 1].y) : 0, 0);
}

/** Bounded Manhattan candidates. If the layout has no safe corridor, do not animate through walls. */
export function crmOrthogonalPath(start: CrmMotionPoint, end: CrmMotionPoint, inputRooms: readonly CrmRoom[]): CrmMotionPoint[] | null {
  if (!finitePoint(start) || !finitePoint(end)) return null;
  const rooms = boundedCrmRooms(inputRooms);
  const candidates: CrmMotionPoint[][] = [
    [start, { x: start.x, y: end.y }, end], [start, { x: end.x, y: start.y }, end],
  ];
  for (const room of rooms) {
    for (const x of [room.x - clearance, room.x + room.width + clearance]) candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
    for (const y of [room.y - clearance, room.y + room.depth + clearance]) candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);
  }
  let best: CrmMotionPoint[] | null = null;
  let bestLength = Infinity;
  for (const candidate of candidates) {
    const path = compactPath(candidate);
    if (!path.every((point, index) => !index || segmentClear(path[index - 1], point, rooms))) continue;
    const length = crmPathLength(path);
    if (length < bestLength - epsilon) { best = path; bestLength = length; }
  }
  return best;
}

function frontDoor(room: CrmRoom): CrmMotionPoint { return { x: room.x + room.width * .54, y: room.y + room.depth }; }
function outsideDoor(room: CrmRoom): CrmMotionPoint { const door = frontDoor(room); return { x: door.x, y: door.y + clearance }; }
function insideFront(room: CrmRoom): CrmMotionPoint { return { x: room.x + room.width * .54, y: room.y + room.depth * .8 }; }
function connectorClear(path: readonly CrmMotionPoint[], rooms: readonly CrmRoom[], allowedId: string) {
  return path.every((point, index) => !index || segmentClear(path[index - 1], point, rooms.filter(room => room.id !== allowedId)));
}

export function crmVisitVisualRoute(visit: CrmVisit, inputRooms: readonly CrmRoom[]) {
  const rooms = boundedCrmRooms(inputRooms);
  const room = rooms.find(row => row.id === visit.roomId);
  if (!room) return null;
  const reception = rooms.filter(row => row.kind === 'reception').sort((a, b) => a.id.localeCompare(b.id))[0];
  const extent = crmSceneExtent(rooms);
  const origin = reception ? insideFront(reception) : { x: -clearance, y: extent.y + clearance };
  const entry = reception ? outsideDoor(reception) : origin;
  const destination = outsideDoor(room);
  const corridor = crmOrthogonalPath(entry, destination, rooms);
  const entering = [destination, frontDoor(room), insideFront(room)];
  const leaving = reception ? [origin, frontDoor(reception), entry] : [origin];
  const full = corridor && connectorClear(leaving, rooms, reception?.id ?? '') && connectorClear(entering, rooms, room.id)
    ? compactPath([...leaving, ...corridor, ...entering]) : null;
  const seed = crmMotionSeed(`visit:${visit.id}:${visit.version}`);
  // A persisted stage only chooses a visual location. Walking never advances it.
  const offset = ((seed % 7) - 3) * Math.min(.11, room.width * .025);
  const servicePoint = { x: insideFront(room).x + offset, y: insideFront(room).y };
  const servicePath = [servicePoint, { x: servicePoint.x + Math.min(.4, room.width * .08), y: servicePoint.y }];
  let path: CrmMotionPoint[] | null = null;
  let point = destination;
  if (visit.status === 'arrived') { point = origin; path = reception && connectorClear(leaving, rooms, reception.id) ? leaving : null; }
  else if (visit.status === 'queued') { point = destination; path = corridor; }
  else if (visit.status === 'called') { point = destination; path = connectorClear(entering, rooms, room.id) ? entering : null; }
  else if (visit.status === 'in_service') {
    point = servicePoint;
    path = connectorClear(servicePath, rooms, room.id) ? servicePath : null;
  }
  // Scheduled records are visible but stationary: a booking is not an arrival.
  return { point, path: path && crmPathLength(path) > epsilon ? compactPath(path) : null, full, corridor, seed };
}

export function crmMotionAllowed(requested: boolean, documentVisible: boolean, reducedMotion: boolean) {
  return requested && documentVisible && !reducedMotion;
}

export function crmSceneActors(snapshot: CrmSnapshot, visibleVisitIds: ReadonlySet<string>) {
  const rooms = boundedCrmRooms(snapshot.rooms);
  const roomById = new Map(rooms.map(room => [room.id, room]));
  const active = snapshot.visits.slice(0, 1000).filter(visit => visibleVisitIds.has(visit.id) && !['completed', 'cancelled', 'no_show'].includes(visit.status))
    .sort((a, b) => a.id.localeCompare(b.id));
  const staff = snapshot.staff.slice(0, 200).filter(person => roomById.has(person.roomId)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, CRM_SCENE_STAFF_LIMIT);
  const working = new Set([
    ...snapshot.visits.slice(0, 1000).filter(visit => visit.status === 'in_service').map(visit => visit.staffId),
    ...snapshot.tasks.slice(0, 2000).filter(task => task.status === 'in_progress').map(task => task.ownerId),
  ]);
  // Reserve a few visual work actors; all movement together stays under one hard cap.
  const staffMovingLimit = Math.min(6, staff.filter(person => working.has(person.id)).length);
  let movingCount = 0;
  const visits = active.slice(0, CRM_SCENE_VISIT_LIMIT).flatMap(visit => {
    const route = crmVisitVisualRoute(visit, rooms);
    if (!route) return [];
    const moving = Boolean(route.path) && movingCount < CRM_SCENE_MOVING_LIMIT - staffMovingLimit;
    if (moving) movingCount++;
    return [{ visit, ...route, moving, key: `visit:${visit.id}:${visit.version}` }];
  });
  const staffActors = staff.map((person: CrmStaff) => {
    const room = roomById.get(person.roomId)!;
    const key = `staff:${person.id}:${person.roomId}`;
    const seed = crmMotionSeed(key);
    const moving = working.has(person.id) && movingCount < CRM_SCENE_MOVING_LIMIT;
    if (moving) movingCount++;
    return { person, key, seed, moving, point: { x: room.x + room.width * .75, y: room.y + room.depth * .32 } };
  });
  return { rooms, visits, staff: staffActors, movingCount, activeCount: active.length };
}

/** Exact corners and length-weighted timing; interpolation cannot cut across a room. */
export function crmMotionKeyframes(path: readonly CrmMotionPoint[]) {
  if (!path.length || path.length > 10 || !path.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 5000 && Math.abs(point.y) <= 5000)) return [];
  const length = crmPathLength(path);
  if (length <= epsilon) return [];
  let walked = 0;
  const forward = path.map((point, index) => {
    if (index) walked += Math.hypot(point.x - path[index - 1].x, point.y - path[index - 1].y);
    return { percent: walked / length * 50, point };
  });
  return [...forward, ...forward.slice(0, -1).reverse().map(frame => ({ percent: 100 - frame.percent, point: frame.point }))];
}

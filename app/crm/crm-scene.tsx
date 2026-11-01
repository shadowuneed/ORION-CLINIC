'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardList, Maximize, Minus, Pause, Play, Plus, Stethoscope, Users } from 'lucide-react';
import type { CrmBuilding, CrmRoom, CrmSnapshot } from '@/lib/crm/contracts';
import { crmMapGeometry, crmMotionAllowed, crmMotionKeyframes, crmOrthogonalPath, crmPathLength, crmSceneActors, crmVisitVisualRoute, type CrmMotionPoint } from '@/lib/crm/motion';
import { centreCrmBuildingCamera, clampCrmCameraPan, clampCrmCameraZoom, fitCrmCampusCamera, focusCrmCamera, focusCrmRenderedPoint, initialCrmGameCamera, keepCrmCampusVisible, panCrmCamera, resetCrmCamera, zoomCrmCameraAt, type CrmMapCamera } from '@/lib/crm/map-camera';
import { queueOrderSource, queueVisits } from '@/lib/crm/scheduling';
import { crmFacilityActorGroups, crmFacilityViewBox } from '@/lib/crm/facility-layout';
import styles from './crm.module.css';
import motionStyles from './crm-motion.module.css';

export type CrmSelection = { kind: 'room' | 'staff' | 'visit' | 'patient' | 'service'; id: string };
type Point = { x: number; y: number };
type Projection = (x: number, y: number, z?: number) => Point;

function motionEnvironment() {
  return 4 | (document.visibilityState === 'visible' ? 1 : 0) | (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 2 : 0);
}
function subscribeMotionEnvironment(changed: () => void) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('visibilitychange', changed);
  preference.addEventListener('change', changed);
  return () => { document.removeEventListener('visibilitychange', changed); preference.removeEventListener('change', changed); };
}
const serverMotionEnvironment = () => 0;

export function clampCrmZoom(value: number) { return clampCrmCameraZoom(value); }
export function clampCrmPan(value: number) { return clampCrmCameraPan(value); }

function points(values: Point[]) { return values.map(point => `${point.x},${point.y}`).join(' '); }
function floor(project: Projection, x: number, y: number, width: number, depth: number, z = 0) {
  return points([project(x, y, z), project(x + width, y, z), project(x + width, y + depth, z), project(x, y + depth, z)]);
}

function Box({ project, x, y, width, depth, height, className }: {
  project: Projection; x: number; y: number; width: number; depth: number; height: number; className?: string;
}) {
  return <g className={`${styles.furniture} ${className ?? ''}`}>
    <polygon className={styles.boxLeft} points={points([project(x, y + depth), project(x + width, y + depth), project(x + width, y + depth, height), project(x, y + depth, height)])} />
    <polygon className={styles.boxRight} points={points([project(x + width, y), project(x + width, y + depth), project(x + width, y + depth, height), project(x + width, y, height)])} />
    <polygon className={styles.boxTop} points={floor(project, x, y, width, depth, height)} />
  </g>;
}

function Room({ room, project, selected }: { room: CrmRoom; project: Projection; selected: boolean }) {
  const { x, y, width, depth } = room;
  const wallHeight = 52;
  const furnitureWidth = Math.min(width * .5, 2);
  const furnitureDepth = Math.min(depth * .24, .9);
  return <g className={styles.room} data-room-kind={room.kind} data-selected={selected}>
    <polygon className={styles.roomFloor} points={floor(project, x, y, width, depth)} />
    <polygon className={styles.wallLeft} points={points([project(x, y), project(x + width, y), project(x + width, y, wallHeight), project(x, y, wallHeight)])} />
    <polygon className={styles.wallRight} points={points([project(x, y), project(x, y + depth), project(x, y + depth, wallHeight), project(x, y, wallHeight)])} />
    <polyline className={styles.wallTrim} points={points([project(x + width, y, wallHeight), project(x, y, wallHeight), project(x, y + depth, wallHeight)])} />
    <Box project={project} x={x + width * .2} y={y + depth * .24} width={furnitureWidth} depth={furnitureDepth} height={room.kind === 'diagnostics' || room.kind === 'treatment' ? 14 : 24} className={room.kind === 'diagnostics' || room.kind === 'treatment' ? styles.bed : styles.desk} />
    {room.kind === 'diagnostics' || room.kind === 'treatment'
      ? <Box project={project} x={x + width * .2} y={y + depth * .24} width={furnitureWidth * .25} depth={furnitureDepth} height={20} className={styles.pillow} />
      : <>
        <Box project={project} x={x + width * .25} y={y + depth * .52} width={Math.min(.55, width * .15)} depth={Math.min(.55, depth * .15)} height={17} className={styles.chair} />
        <Box project={project} x={x + width * .6} y={y + depth * .54} width={Math.min(.55, width * .15)} depth={Math.min(.55, depth * .15)} height={17} className={styles.chair} />
        <Box project={project} x={x + width * .31} y={y + depth * .24} width={Math.min(.65, width * .2)} depth={Math.min(.18, depth * .08)} height={35} className={styles.monitor} />
      </>}
    <polygon className={styles.roomEdge} points={floor(project, x, y, width, depth)} />
  </g>;
}

function Tree({ x, y, variant = 0 }: Point & { variant?: number }) {
  return <g transform={`translate(${x} ${y})`} className={styles.tree}>
    <ellipse cx="0" cy="4" rx="26" ry="11" className={styles.treeShadow} />
    <path d="M-3 0v-36h7V0l-4 3Z" className={styles.trunk} />
    <path d={variant ? 'M0-94 26-65 24-36 1-23-24-41-27-68Z' : 'M0-88 27-66 25-39 0-23-24-40-25-65Z'} className={styles.treeLight} />
    <path d="M0-88 0-23-24-40-25-65Z" className={styles.treeDark} />
    <path d="M0-88 27-66 0-55-25-65Z" className={styles.treeTop} />
  </g>;
}

function BuildingPlatform({ building, project }: { building: CrmBuilding; project: Projection }) {
  const { x, y, width, depth } = building;
  return <g aria-hidden="true" data-building-platform={building.id}>
    <polygon className={styles.groundShadow} points={floor(project, x - 2, y - 2, width + 4, depth + 4, -16)} />
    <polygon className={styles.groundSide} points={points([project(x - 1.8, y + depth + 1.8), project(x + width + 1.8, y + depth + 1.8), project(x + width + 1.8, y + depth + 1.8, -14), project(x - 1.8, y + depth + 1.8, -14)])} />
    <polygon className={styles.ground} points={floor(project, x - 1.8, y - 1.8, width + 3.6, depth + 3.6)} />
    <polygon className={styles.walkway} points={floor(project, x - .8, y + depth + .35, width + 1.6, .8, 1)} />
    <Tree {...project(x - 1.2, y + .4)} /><Tree {...project(x + width + 1.1, y + .8)} variant={1} />
    <Tree {...project(x - 1.15, y + depth - .1)} variant={1} /><Tree {...project(x + width + 1.1, y + depth - .8)} />
  </g>;
}

function Person({ staff, seed, working }: { staff?: boolean; seed: number; working?: boolean }) {
  return <g className={`${styles.person} ${working ? motionStyles.workBody : ''}`} data-staff={staff} data-variant={seed % 3} aria-hidden="true">
    <ellipse cx="0" cy="2" rx="10" ry="5" className={styles.personShadow} />
    <path d="M-5-16-5-1h4v-12h2V0h4v-17Z" className={styles.personLegs} />
    <path d="M-7-39Q0-44 7-39l3 18-5 2v-13H4v18h-9v-18h-1v12l-4-2Z" className={styles.personCoat} />
    <circle cx="0" cy="-48" r="7" className={styles.personFace} />
    <path d="M-7-48q-1-10 8-8 7 0 6 9l-3-3-4-2-4 4Z" className={styles.personHair} />
    {staff && <path d="M-3-39v8q3 7 6 0v-8M0-27v3" className={styles.stethoscope} />}
    {working && <path d="M6-33l9 3-2 10-9-3Z" className={motionStyles.workMark} />}
  </g>;
}

function SceneActor({ identity, point, path, moving, working, seed, staff, status, label, initials, selected, onSelect }: {
  identity: string; point: Point; path?: Point[] | null; moving: boolean; working?: boolean; seed: number;
  staff?: boolean; status?: string; label: string; initials: string; selected: boolean; onSelect: (button: HTMLButtonElement) => void;
}) {
  const scope = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const name = `crmWalk_${scope}`;
  const frames = moving && path ? crmMotionKeyframes(path) : [];
  const keyframes = frames.length ? `@keyframes ${name}{${frames.map(frame => `${frame.percent.toFixed(5)}%{transform:translate(${frame.point.x.toFixed(3)}px,${frame.point.y.toFixed(3)}px)}`).join('')}}` : '';
  const duration = Math.max(7, Math.min(44, crmPathLength(path ?? []) * 2 / 32));
  return <g className={`${motionStyles.actor} ${frames.length ? motionStyles.moving : ''}`} data-sequence={identity} data-visual-moving={moving}
    style={{ transform: `translate(${point.x}px, ${point.y}px)`, animationName: frames.length ? name : undefined,
      animationDuration: `${duration}s`, animationDelay: `${-(seed % 7000) / 1000}s` }}>
    {keyframes && <style>{keyframes}</style>}
    <Person seed={seed} staff={staff} working={working && moving} />
    <foreignObject x="-24" y="-81" width="48" height="88"><button className={motionStyles.actorButton} type="button"
      data-status={status} data-staff={staff} aria-label={label} title={label} aria-pressed={selected} onClick={event => onSelect(event.currentTarget)}>
      <span aria-hidden="true">{initials}</span></button></foreignObject>
  </g>;
}

export function CrmScene({ snapshot, selection, onSelect, visibleVisitIds, gameMode = false, focusSelection, facilityMode = false }: {
  snapshot: CrmSnapshot; selection: CrmSelection | null; onSelect: (selection: CrmSelection) => void;
  visibleVisitIds: ReadonlySet<string>; gameMode?: boolean; focusSelection?: boolean; facilityMode?: boolean;
}) {
  const [camera, setCamera] = useState<CrmMapCamera>(resetCrmCamera);
  const { zoom, pan } = camera;
  const cameraValue = useRef(camera);
  useEffect(() => { cameraValue.current = camera; }, [camera]);
  const [dragging, setDragging] = useState(false);
  const [layers, setLayers] = useState({ patients: true, staff: true, tasks: true });
  const [activeBuildingId, setActiveBuildingId] = useState<string | null>(null);
  // Server/first paint is stationary. The browser enables motion only after checking preferences.
  const environment = useSyncExternalStore(subscribeMotionEnvironment, motionEnvironment, serverMotionEnvironment);
  const [requestedMotion, setRequestedMotion] = useState<boolean | null>(null);
  const ready = Boolean(environment & 4);
  const reducedMotion = !ready || Boolean(environment & 2);
  const documentVisible = Boolean(environment & 1);
  const requested = requestedMotion ?? (!facilityMode && !reducedMotion);
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; camera: CrmMapCamera } | null>(null);
  const lastFocused = useRef<string | null>(null);
  const initiallyFitted = useRef(false);
  const focusEnabled = focusSelection ?? gameMode;
  const actors = useMemo(() => crmSceneActors(snapshot, visibleVisitIds), [snapshot, visibleVisitIds]);
  const buildings = useMemo(() => (snapshot.buildings ?? []).slice(0, 20).sort((a, b) => a.id.localeCompare(b.id)), [snapshot.buildings]);
  const primary = buildings[0];
  const geometry = useMemo(() => crmMapGeometry(actors.rooms, gameMode, primary), [actors.rooms, gameMode, primary]);
  const { project, extentX, extentY } = geometry;
  const facilityView = useMemo(() => facilityMode ? crmFacilityViewBox(actors.rooms, project,
    [...actors.staff.map(actor => actor.point), ...actors.visits.flatMap(actor => [actor.point, ...(actor.path ?? [])])]) : null, [facilityMode, actors, project]);
  const roomDirectory = useMemo(() => [...actors.rooms].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id)), [actors.rooms]);
  const roomNumbers = useMemo(() => new Map(roomDirectory.map((room, index) => [room.id, index + 1])), [roomDirectory]);
  const visitGroups = useMemo(() => facilityMode ? crmFacilityActorGroups(actors.visits, project, actor => actor.visit.roomId)
    : actors.visits.map(actor => ({ actor, members: [actor] })), [facilityMode, actors.visits, project]);
  const staffGroups = useMemo(() => facilityMode ? crmFacilityActorGroups(actors.staff, project, actor => actor.person.roomId)
    : actors.staff.map(actor => ({ actor, members: [actor] })), [facilityMode, actors.staff, project]);
  const mapTitleId = useId();
  const buildingBounds = useCallback((building: CrmBuilding) => {
    const corners = [project(building.x - 2, building.y - 2), project(building.x + building.width + 2, building.y - 2),
      project(building.x + building.width + 2, building.y + building.depth + 2), project(building.x - 2, building.y + building.depth + 2)];
    return { minX: Math.min(...corners.map(point => point.x)) - 28, maxX: Math.max(...corners.map(point => point.x)) + 28,
      minY: Math.min(...corners.map(point => point.y)) - 105, maxY: Math.max(...corners.map(point => point.y)) + 20 };
  }, [project]);
  const campusBounds = useMemo(() => {
    const corners = [project(-2, -2), project(extentX + 2, -2), project(extentX + 2, extentY + 2), project(-2, extentY + 2)];
    return { minX: Math.min(...corners.map(point => point.x)) - 28, maxX: Math.max(...corners.map(point => point.x)) + 28,
      minY: Math.min(...corners.map(point => point.y)) - 105, maxY: Math.max(...corners.map(point => point.y)) + 20 };
  }, [project, extentX, extentY]);
  useEffect(() => {
    const element = viewport.current;
    if (!gameMode || !element || initiallyFitted.current) return;
    const apply = () => {
      if (initiallyFitted.current) return;
      const size = element.getBoundingClientRect();
      if (size.width <= 0 || size.height <= 0) return;
      initiallyFitted.current = true;
      setCamera(initialCrmGameCamera(size, primary ? buildingBounds(primary) : campusBounds));
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    observer?.observe(element);
    const frame = requestAnimationFrame(apply);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [gameMode, campusBounds, primary, buildingBounds]);
  const connectingPaths = useMemo(() => buildings.slice(1).flatMap((building, index) => {
    const previous = buildings[index];
    const path = crmOrthogonalPath({ x: previous.x + previous.width / 2, y: previous.y + previous.depth + .55 },
      { x: building.x + building.width / 2, y: building.y + building.depth + .55 }, actors.rooms);
    return path ? [{ id: `${previous.id}:${building.id}`, path }] : [];
  }), [buildings, actors.rooms]);
  const rooms = [...actors.rooms].sort((a, b) => a.x + a.y - b.x - b.y || a.id.localeCompare(b.id));
  const patientById = useMemo(() => new Map(snapshot.patients.slice(0, 1000).map(patient => [patient.id, patient])), [snapshot.patients]);
  const roomCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const visit of snapshot.visits.slice(0, 1000)) if (!['completed', 'cancelled', 'no_show'].includes(visit.status)) counts.set(visit.roomId, (counts.get(visit.roomId) ?? 0) + 1);
    return counts;
  }, [snapshot.visits]);
  const roomDetails = useMemo(() => {
    const result = new Map(actors.rooms.map(room => [room.id, { queued: 0, called: 0, inService: 0, tasks: 0, urgent: 0 }]));
    const visits = new Map(snapshot.visits.slice(0, 1000).map(visit => [visit.id, visit]));
    for (const visit of visits.values()) {
      const details = result.get(visit.roomId); if (!details) continue;
      if (visit.status === 'queued') details.queued++; else if (visit.status === 'called') details.called++; else if (visit.status === 'in_service') details.inService++;
    }
    for (const task of snapshot.tasks.slice(0, 2000)) {
      const roomId = visits.get(task.visitId)?.roomId;
      const details = roomId ? result.get(roomId) : undefined;
      if (!details || task.status === 'completed') continue;
      details.tasks++; if (task.priority === 'urgent') details.urgent++;
    }
    return result;
  }, [actors.rooms, snapshot.visits, snapshot.tasks]);
  const visitTasks = useMemo(() => {
    const result = new Map<string, number>();
    for (const task of snapshot.tasks.slice(0, 2000)) if (task.status !== 'completed') result.set(task.visitId, (result.get(task.visitId) ?? 0) + 1);
    return result;
  }, [snapshot.tasks]);
  const queuePositions = useMemo(() => {
    const positions = new Map<string, number>(), perRoom = new Map<string, number>();
    for (const visit of queueVisits(snapshot)) {
      const place = (perRoom.get(visit.roomId) ?? 0) + 1; perRoom.set(visit.roomId, place);
      if (queueOrderSource(visit) === 'audit_sequence') positions.set(visit.id, place);
    }
    return positions;
  }, [snapshot]);
  const selectedRoute = useMemo(() => {
    if (selection?.kind !== 'visit') return null;
    const visit = snapshot.visits.slice(0, 1000).find(row => row.id === selection.id);
    return visit ? crmVisitVisualRoute(visit, actors.rooms)?.full ?? null : null;
  }, [selection, snapshot.visits, actors.rooms]);
  const projectPath = (path: readonly CrmMotionPoint[]) => path.map(point => project(point.x, point.y, 2));
  const running = crmMotionAllowed(requested, documentVisible, reducedMotion);

  const renderedCamera = useCallback((): CrmMapCamera => {
    if (!gameMode || !world.current) return cameraValue.current;
    try {
      const matrix = new DOMMatrixReadOnly(window.getComputedStyle(world.current).transform);
      return Number.isFinite(matrix.a) && matrix.a > 0 && Number.isFinite(matrix.e) && Number.isFinite(matrix.f)
        ? { zoom: matrix.a, pan: { x: matrix.e, y: matrix.f } } : cameraValue.current;
    } catch { return cameraValue.current; }
  }, [gameMode]);
  function focus(next: CrmSelection, button?: HTMLButtonElement) {
    if ((!gameMode && !facilityMode) || !focusEnabled || !viewport.current) return;
    const size = viewport.current.getBoundingClientRect();
    const current = renderedCamera();
    if (button) {
      const rect = button.getBoundingClientRect();
      const focused = focusCrmRenderedPoint(current, { x: rect.left + rect.width / 2 - size.left - size.width / 2, y: rect.top + rect.height / 2 - size.top - size.height / 2 }, gameMode);
      setCamera(facilityMode ? focused : keepCrmCampusVisible(focused, size, campusBounds));
      return;
    }
    const staff = next.kind === 'staff' ? actors.staff.find(actor => actor.person.id === next.id) : null;
    const visit = next.kind === 'visit' ? snapshot.visits.slice(0, 1000).find(row => row.id === next.id) : null;
    const room = next.kind === 'room' ? actors.rooms.find(row => row.id === next.id) : null;
    const point = staff?.point ?? (visit ? crmVisitVisualRoute(visit, actors.rooms)?.point : null) ??
      (room ? { x: room.x + room.width / 2, y: room.y + room.depth * .65 } : null);
    if (point && facilityMode && facilityView) {
      const projected = project(point.x, point.y, 24), scale = Math.min(size.width / facilityView.width, size.height / facilityView.height);
      setCamera({ zoom: current.zoom, pan: { x: clampCrmPan(-(projected.x - facilityView.x - facilityView.width / 2) * scale * current.zoom),
        y: clampCrmPan(-(projected.y - facilityView.y - facilityView.height / 2) * scale * current.zoom) } });
    } else if (point) setCamera(keepCrmCampusVisible(focusCrmCamera(current, project(point.x, point.y, 24), size), size, campusBounds));
  }
  function choose(next: CrmSelection, button?: HTMLButtonElement) {
    onSelect(next);
    if ((gameMode || facilityMode) && focusEnabled) { lastFocused.current = `${next.kind}:${next.id}`; focus(next, next.kind === 'room' ? undefined : button); }
  }
  useEffect(() => {
    if ((!gameMode && !facilityMode) || !focusEnabled || !selection) { lastFocused.current = null; return; }
    const key = `${selection.kind}:${selection.id}`;
    if (lastFocused.current === key) return;
    // One focus frame, never a continuous camera loop or workflow timer.
    const frame = requestAnimationFrame(() => { lastFocused.current = key; focus(selection); });
    return () => cancelAnimationFrame(frame);
  });

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!gameMode && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (drag.current || event.deltaY === 0) return;
      const current = renderedCamera();
      const nextZoom = current.zoom * Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * .0015);
      const rect = element.getBoundingClientRect();
      if (gameMode) setCamera(zoomCrmCameraAt(current, nextZoom, { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }, true));
      else setCamera({ ...current, zoom: clampCrmZoom(current.zoom + (event.deltaY < 0 ? .1 : -.1)) });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [gameMode, renderedCamera]);

  function move(dx: number, dy: number) { setCamera(current => panCrmCamera(current, { x: dx, y: dy }, gameMode)); }
  function zoomBy(delta: number) { setCamera(current => gameMode ? zoomCrmCameraAt(current, current.zoom + delta, { x: 0, y: 0 }, true) : { ...current, zoom: clampCrmZoom(current.zoom + delta) }); }
  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, input, select, textarea, [role="button"]'))) return;
    const current = renderedCamera();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: current };
    if (gameMode) { event.preventDefault(); setCamera(current); }
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const reset = () => { setCamera(gameMode && viewport.current ? fitCrmCampusCamera(viewport.current.getBoundingClientRect(), campusBounds) : resetCrmCamera()); };

  const selectedRoom = selection?.kind === 'room' ? roomDirectory.find(room => room.id === selection.id) : null;
  return <section className={`${styles.mapCard} ${motionStyles.motionSurface} ${facilityMode ? motionStyles.facilitySurface : ''}`} data-game-mode={gameMode} data-motion={running ? 'running' : 'paused'} aria-labelledby={mapTitleId}>
    <header className={styles.mapHeader}><div><span className={styles.eyebrow}>{facilityMode ? 'КАБИНЕТЫ И СОХРАНЁННЫЕ ВИЗИТЫ' : 'ПРОСТРАНСТВО КЛИНИКИ'}</span><h2 id={mapTitleId}>{facilityMode ? 'Выберите кабинет на плане или в списке' : 'Один взгляд на весь маршрут'}</h2></div>{!facilityMode && <span className={styles.mapBadge}>2.5D · модель</span>}</header>
    {facilityMode && roomDirectory.length > 0 && <nav className={motionStyles.facilityRooms} aria-label="Кабинеты учреждения">{roomDirectory.map(room => <button key={room.id} type="button" aria-pressed={selection?.kind === 'room' && selection.id === room.id}
      onClick={() => choose({ kind: 'room', id: room.id })}><b>{roomNumbers.get(room.id)}</b><span>{room.name}<small>{roomCounts.get(room.id) ?? 0} активных визитов</small></span></button>)}</nav>}
    {facilityMode && <p className={motionStyles.facilitySelection} aria-live="polite">{selectedRoom ? <><strong>{selectedRoom.name}</strong><span>Очередь: {roomDetails.get(selectedRoom.id)?.queued ?? 0} · На приёме: {roomDetails.get(selectedRoom.id)?.inService ?? 0}</span></> : 'Номера на плане соответствуют кабинетам в списке. Нажмите на человека, чтобы открыть запись.'}</p>}
    {gameMode && <nav className={motionStyles.layerControls} aria-label="Слои большой карты">{[
      { id: 'patients' as const, label: 'Пациенты', icon: Users }, { id: 'staff' as const, label: 'Команда', icon: Stethoscope }, { id: 'tasks' as const, label: 'Задачи', icon: ClipboardList },
    ].map(layer => <button key={layer.id} type="button" aria-pressed={layers[layer.id]} onClick={() => setLayers(current => ({ ...current, [layer.id]: !current[layer.id] }))}><layer.icon size={14} aria-hidden="true" /><span>{layer.label}</span></button>)}</nav>}
    {gameMode && buildings.length > 0 && <nav className={motionStyles.buildingControls} aria-label="Корпуса клиники">{buildings.map(building => <button type="button" key={building.id}
      aria-pressed={(activeBuildingId ?? primary?.id) === building.id} onClick={() => {
        if (!viewport.current) return;
        setActiveBuildingId(building.id);
        setCamera(centreCrmBuildingCamera(viewport.current.getBoundingClientRect(), buildingBounds(building), renderedCamera().zoom));
      }}>{building.name}</button>)}</nav>}
    <div className={`${styles.sceneViewport} ${gameMode ? motionStyles.gameViewport : ''} ${facilityMode ? motionStyles.facilityViewport : ''}`} data-empty={facilityMode && rooms.length === 0} data-camera-dragging={dragging} ref={viewport} tabIndex={0} aria-label={`Карта клиники. Стрелки перемещают, плюс и минус меняют масштаб, Home возвращает вид.${gameMode ? ' Колесо масштабирует вокруг указателя, перетаскивание перемещает камеру.' : ''}`} onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'ArrowLeft') move(-35, 0); else if (event.key === 'ArrowRight') move(35, 0);
      else if (event.key === 'ArrowUp') move(0, -35); else if (event.key === 'ArrowDown') move(0, 35);
      else if (event.key === '+' || event.key === '=') zoomBy(.15);
      else if (event.key === '-') zoomBy(-.15); else if (event.key === 'Home') reset(); else return;
      event.preventDefault();
    }} onPointerDown={beginDrag} onPointerMove={event => {
      const current = drag.current;
      if (current?.id === event.pointerId) setCamera(panCrmCamera(current.camera, { x: event.clientX - current.x, y: event.clientY - current.y }, gameMode));
    }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      <div className={`${styles.sceneWorld} ${gameMode ? motionStyles.cameraWorld : ''}`} ref={world} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg viewBox={facilityView ? `${facilityView.x} ${facilityView.y} ${facilityView.width} ${facilityView.height}` : '0 0 1000 680'} className={styles.sceneSvg} role="group" aria-label="Условная схема кабинетов и сохранённых этапов визитов">
          <g aria-hidden="true">
            {facilityMode ? <>{rooms.map(room => <polygon key={`base:${room.id}`} className={styles.groundSide} points={floor(project, room.x - .2, room.y - .2, room.width + .4, room.depth + .4, -8)} />)}</> : buildings.length > 0 ? <>{buildings.map(building => <BuildingPlatform key={building.id} building={building} project={project} />)}
              {connectingPaths.map(connection => <polyline key={connection.id} className={motionStyles.corridor} points={points(projectPath(connection.path))} />)}</> : <>
            <polygon className={styles.groundShadow} points={floor(project, -2, -2, extentX + 4, extentY + 4, -16)} />
            <polygon className={styles.groundSide} points={points([project(-1.8, extentY + 1.8), project(extentX + 1.8, extentY + 1.8), project(extentX + 1.8, extentY + 1.8, -14), project(-1.8, extentY + 1.8, -14)])} />
            <polygon className={styles.ground} points={floor(project, -1.8, -1.8, extentX + 3.6, extentY + 3.6)} />
            <polygon className={styles.walkway} points={floor(project, -.8, extentY + .35, extentX + 1.6, .8, 1)} />
            {layers.patients && actors.visits.filter(actor => actor.corridor).map(actor => <polyline key={actor.key} className={motionStyles.corridor} points={points(projectPath(actor.corridor!))} />)}
            <Tree {...project(-1.2, .4)} /><Tree {...project(extentX + 1.1, .8)} variant={1} />
            </>}
            {rooms.map(room => <Room key={room.id} room={room} project={project} selected={selection?.kind === 'room' && selection.id === room.id} />)}
          </g>
          {layers.patients && selectedRoute && <g aria-hidden="true"><polyline className={motionStyles.selectedRoute} points={points(projectPath(selectedRoute))} />
            {[selectedRoute[0], selectedRoute[selectedRoute.length - 1]].map((point, index) => { const projected = project(point.x, point.y, 2); return <circle key={index} className={motionStyles.routeDot} cx={projected.x} cy={projected.y} r="5" />; })}</g>}
          {layers.staff && staffGroups.map(({ actor, members }) => <SceneActor key={actor.key} identity={actor.key} point={project(actor.point.x, actor.point.y)} moving={members.length === 1 && actor.moving} working={members.length === 1 && actor.moving} seed={actor.seed} staff
            label={members.length > 1 ? `${members.length} сотрудников: открыть кабинет ${roomDirectory.find(room => room.id === actor.person.roomId)?.name ?? ''}` : `Открыть сотрудника: ${actor.person.name}`} initials={members.length > 1 ? `${members.length}С` : actor.person.name.split(/\s+/).slice(-1)[0]?.[0] ?? 'С'} selected={selection?.kind === 'staff' && members.some(member => selection.id === member.person.id)} onSelect={button => choose(members.length > 1 ? { kind: 'room', id: actor.person.roomId } : { kind: 'staff', id: actor.person.id }, button)} />)}
          {layers.patients && visitGroups.map(({ actor, members }) => { const patient = patientById.get(actor.visit.patientId);
            const status = { scheduled: 'Запланирован', arrived: 'Прибыл', queued: 'В очереди', called: 'Вызван', in_service: 'На приёме', completed: 'Завершён', cancelled: 'Отменён', no_show: 'Неявка' }[actor.visit.status];
            const badge = actor.visit.status === 'queued' ? queuePositions.has(actor.visit.id) ? `#${queuePositions.get(actor.visit.id)}` : '?' : actor.visit.status === 'called' ? '↗' : actor.visit.status === 'in_service' ? '✚' : patient?.mrn.slice(-2) ?? 'П';
            return <SceneActor key={actor.key} identity={actor.key} point={project(actor.point.x, actor.point.y)} path={actor.path ? projectPath(actor.path) : null}
            moving={members.length === 1 && actor.moving && ready} seed={actor.seed} status={members.length === 1 ? actor.visit.status : undefined} label={members.length > 1 ? `${members.length} визитов: открыть кабинет ${roomDirectory.find(room => room.id === actor.visit.roomId)?.name ?? ''}` : `Открыть визит: ${patient?.name ?? actor.visit.id}${gameMode || facilityMode ? ` · ${status} · открытых задач: ${visitTasks.get(actor.visit.id) ?? 0}` : ''}`}
            initials={members.length > 1 ? `${members.length}П` : gameMode ? badge : patient?.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('') ?? 'П'} selected={selection?.kind === 'visit' && members.some(member => selection.id === member.visit.id)} onSelect={button => choose(members.length > 1 ? { kind: 'room', id: actor.visit.roomId } : { kind: 'visit', id: actor.visit.id }, button)} />; })}
          {gameMode && layers.tasks && rooms.filter(room => (roomDetails.get(room.id)?.tasks ?? 0) > 0).map(room => {
            const details = roomDetails.get(room.id)!; const point = project(room.x + room.width * .87, room.y + room.depth * .76, 10);
            return <foreignObject key={`tasks:${room.id}`} x={point.x - 18} y={point.y - 18} width="46" height="38"><button type="button" className={motionStyles.taskPin}
              data-urgent={details.urgent > 0} title={`Открытых задач: ${details.tasks}${details.urgent ? ` · срочных: ${details.urgent}` : ''}`} aria-label={`${room.name}: открыть задачи CRM, ${details.tasks}${details.urgent ? `, срочных ${details.urgent}` : ''}`} onClick={() => choose({ kind: 'room', id: room.id })}>
              <ClipboardList size={15} aria-hidden="true" /><span>{details.tasks}</span></button></foreignObject>;
          })}
          {!facilityMode && buildings.length === 0 && <g aria-hidden="true"><Tree {...project(-1.15, extentY - .1)} variant={1} /><Tree {...project(extentX + 1.1, extentY - .8)} /></g>}
          {!facilityMode && buildings.map(building => { const point = project(building.x + building.width / 2, building.y - 1.4, 48); return <text key={`name:${building.id}`} className={motionStyles.buildingName} x={point.x} y={point.y} textAnchor="middle" aria-hidden="true">{building.name}</text>; })}
          {rooms.map(room => { const point = project(room.x + room.width * .5, room.y + room.depth * .15, 72); const count = roomCounts.get(room.id) ?? 0; const details = roomDetails.get(room.id)!;
            if (facilityMode) return <foreignObject key={room.id} x={point.x - 18} y={point.y - 14} width="36" height="36"><button type="button" className={motionStyles.facilityRoomIndex}
              title={`${room.name} · активных визитов: ${count}`} aria-label={`${room.name}, активных визитов: ${count}`} aria-pressed={selection?.kind === 'room' && selection.id === room.id}
              onClick={() => choose({ kind: 'room', id: room.id })}>{roomNumbers.get(room.id)}</button></foreignObject>;
            return <foreignObject key={room.id} x={point.x - (gameMode ? 80 : 75)} y={point.y - 18} width={gameMode ? 164 : 150} height={gameMode ? 40 : 52}><button className={`${styles.roomPin} ${gameMode ? motionStyles.gameRoomPin : ''}`} type="button" aria-pressed={selection?.kind === 'room' && selection.id === room.id} onClick={() => choose({ kind: 'room', id: room.id })} aria-label={`${room.name}, активных визитов: ${count}`}
              title={gameMode ? `Очередь ${details.queued} · вызваны ${details.called} · приём ${details.inService} · задачи ${details.tasks}${details.urgent ? ` · срочные ${details.urgent}` : ''}` : undefined}><span>{room.name}</span><b>{count}</b></button></foreignObject>; })}
        </svg>
      </div>
      {snapshot.rooms.length === 0 && <p className={styles.mapEmpty}>План помещений в БД пока пуст.</p>}
    </div>
    {facilityMode && (actors.staff.length > 0 || actors.visits.length > 0) && <details className={motionStyles.facilityPeople}><summary>Люди и визиты на плане · {actors.staff.length + actors.visits.length}</summary><div>
      {actors.staff.map(actor => <button type="button" key={actor.key} aria-pressed={selection?.kind === 'staff' && selection.id === actor.person.id} onClick={() => choose({ kind: 'staff', id: actor.person.id })}><Stethoscope size={15} /><span>{actor.person.name}<small>{roomDirectory.find(room => room.id === actor.person.roomId)?.name}</small></span></button>)}
      {actors.visits.map(actor => <button type="button" key={actor.key} aria-pressed={selection?.kind === 'visit' && selection.id === actor.visit.id} onClick={() => choose({ kind: 'visit', id: actor.visit.id })}><Users size={15} /><span>{patientById.get(actor.visit.patientId)?.name ?? 'Визит'}<small>{roomDirectory.find(room => room.id === actor.visit.roomId)?.name}</small></span></button>)}
    </div></details>}
    <div className={styles.mapFooter}><p>Позиции условны — это этапы записей, не отслеживание людей. Движение — визуальная модель; местоположение и этапы не меняет.{facilityMode ? ' Совпадающие позиции объединены: П — визиты, С — сотрудники. Все доступны в списке выше.' : ''}{actors.visits.length < actors.activeCount ? ' На карте до 24 активных визитов; остальные доступны списком.' : ''}
      {reducedMotion && ready && <span className={motionStyles.motionStatus}>Уменьшение движения: анимация выключена.</span>}</p><div className={styles.mapControls} aria-label="Управление схемой">
      <button className={motionStyles.motionToggle} type="button" disabled={!ready || reducedMotion} aria-pressed={requested && !reducedMotion}
        aria-label={requested ? 'Движение: поставить на паузу' : 'Движение: включить'} onClick={() => setRequestedMotion(!requested)}>
        {running ? <Pause size={15} /> : <Play size={15} />}<span>Движение: {running ? 'вкл.' : 'пауза'}</span></button>
      <button type="button" aria-label="Переместить схему влево" onClick={() => move(-35, 0)}><ArrowLeft size={16} /></button><button type="button" aria-label="Переместить схему вверх" onClick={() => move(0, -35)}><ArrowUp size={16} /></button><button type="button" aria-label="Переместить схему вниз" onClick={() => move(0, 35)}><ArrowDown size={16} /></button><button type="button" aria-label="Переместить схему вправо" onClick={() => move(35, 0)}><ArrowRight size={16} /></button>
      <button type="button" aria-label="Уменьшить масштаб" disabled={zoom <= (gameMode ? .4 : .65)} onClick={() => zoomBy(-.15)}><Minus size={16} /></button><output aria-label="Масштаб схемы">{Math.round(zoom * 100)}%</output><button type="button" aria-label="Увеличить масштаб" disabled={zoom >= (gameMode ? 2.8 : 1.8)} onClick={() => zoomBy(.15)}><Plus size={16} /></button><button type="button" aria-label={gameMode ? 'Показать всю клинику' : 'Вернуть исходный вид схемы'} title={gameMode ? 'Общий обзор · Home' : undefined} onClick={reset}><Maximize size={16} /></button>
    </div></div>
  </section>;
}

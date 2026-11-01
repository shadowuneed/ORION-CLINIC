import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CrmSnapshot } from '@/lib/crm/contracts';
import { CrmWorkspace, createdCrmVisit, crmSummary, filterCrmVisits, readCrmResponse, crmHistoryDescription } from './crm-workspace';
import { CrmScene, clampCrmPan, clampCrmZoom } from './crm-scene';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const now = '2026-10-06T07:00:00.000Z';
function snapshot(): CrmSnapshot {
  return { schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'clinic-test', name: 'Искусственная клиника' },
    rooms: [{ id: 'room-a', name: 'Кабинет А', kind: 'consultation', x: 0, y: 0, width: 5, depth: 4 }],
    staff: [{ id: 'staff-a', name: 'Тестовый врач', role: 'doctor', roomId: 'room-a' }],
    services: [{ id: 'service-a', name: 'Тестовая консультация', durationMinutes: 20, roomKind: 'consultation' }],
    patients: [{ id: 'patient-a', name: 'Искусственный пациент', mrn: 'SIM-001', sex: 'unknown' }],
    visits: [{ id: 'visit-a', patientId: 'patient-a', staffId: 'staff-a', roomId: 'room-a', serviceId: 'service-a', scheduledAt: now, status: 'queued', version: 2, updatedAt: now }],
    tasks: [{ id: 'task-a', visitId: 'visit-a', patientId: 'patient-a', ownerId: 'staff-a', kind: 'preparation', title: 'Тестовая подготовка', priority: 'routine', dueAt: now, status: 'pending', version: 1 }],
    events: [], capabilities: { read: true, manage: true }, generatedAt: now };
}

describe('CRM server snapshot presentation', () => {
  it('renders an honest initial loading state without invented scene records or zero metrics', () => {
    const html = renderToStaticMarkup(createElement(CrmWorkspace));
    expect(html).toContain('Открываем CRM');
    expect(html).not.toContain('Активные визиты');
    expect(html).not.toContain('Искусственный пациент');
    expect(html).not.toContain('<svg viewBox="0 0 1000 680"');
  });
  it('keeps the explicit simulation boundary and presents the saved visit through native controls', () => {
    const html = renderToStaticMarkup(createElement(CrmWorkspace, { initialSnapshot: snapshot() }));
    expect(html).toContain('Учебная БД');
    expect(html).toContain('не отслеживание людей');
    expect(html).toContain('CRM, карточка пациента и очный приём используют одну базу');
    expect(html).toContain('Искусственный пациент');
    expect(html).toContain('В очереди');
    expect(html).toContain('Визиты списком');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('href="/patients');
    expect(html).not.toContain('href="/scheduling');
  });
  it('does not offer write access when the server snapshot is read-only', () => {
    const data = snapshot(); data.capabilities.manage = false;
    const html = renderToStaticMarkup(createElement(CrmWorkspace, { initialSnapshot: data }));
    expect(html).toContain('Только просмотр');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Новый визит<\/button>/);
    expect(html).not.toContain('type="checkbox"');
  });
  it('makes an empty database visible without creating a fallback visit', () => {
    const data = snapshot(); data.visits = []; data.tasks = [];
    const html = renderToStaticMarkup(createElement(CrmWorkspace, { initialSnapshot: data }));
    expect(html).toContain('Визитов пока нет. Создайте первый визит');
    expect(html).not.toContain('Открыть визит:');
    expect(crmSummary(data)).toEqual({ active: 0, queued: 0, occupiedRooms: 0, openTasks: 0 });
  });
  it('has six understandable local CRM sections without sending a command while rendering', () => {
    const html = renderToStaticMarkup(createElement(CrmWorkspace, { initialSnapshot: snapshot() }));
    for (const label of ['План клиники', 'Рабочий центр', 'Записи и очередь', 'Задачи', 'Пациенты CRM', 'Команда и услуги']) expect(html).toContain(label);
    expect(html).toContain('aria-label="Инструменты единой карты CRM"');
    expect(html).toContain('Работаю с учебной БД');
  });
  it('opens the patient catalogue above the persistent map without another loading state', () => {
    const html = renderToStaticMarkup(createElement(CrmWorkspace, { initialSnapshot: snapshot(), initialView: 'patients' }));
    expect(html).toContain('Каталог пациентов CRM');
    expect(html).toContain('Искусственный пациент');
    expect(html).toContain('Карта клиники');
    expect(html).toContain('data-crm-map-console="operations"');
    expect(html).not.toContain('Открываем CRM');
  });
  it('uses the unified calendar and queue for the scheduling view rather than the earlier schedule panel', () => {
    const html = renderToStaticMarkup(createElement(CrmWorkspace, { initialSnapshot: snapshot(), initialView: 'schedule' }));
    expect(html).toContain('Календарная политика');
    expect(html).not.toContain('Проверка пересечений будущих записей пока не подключена');
    expect(html).toContain('Карта клиники');
    expect(html).toContain('data-game-mode="true"');
  });
  it('labels rescheduling and task history without conflating them with visit completion', () => {
    const event = { id: 'event', resourceId: 'task-a', kind: 'task.transitioned' as const, actorLabel: 'Synthetic',
      createdAt: now, fromStatus: 'in_progress', toStatus: 'completed' as const };
    expect(crmHistoryDescription(event)).toBe('В работе → Завершена');
    expect(crmHistoryDescription({ ...event, kind: 'visit.rescheduled', fromStatus: 'scheduled', toStatus: 'scheduled' })).toContain('Время запланированного визита изменено');
  });
  it('derives counts from exact stored stages, without counting cancelled/completed visits as active', () => {
    const data = snapshot();
    data.visits.push(...(['in_service', 'completed', 'cancelled'] as const).map((status, index) => ({ ...data.visits[0], id: `visit-${index}`, status })));
    data.tasks.push({ ...data.tasks[0], id: 'task-complete', status: 'completed' }, { ...data.tasks[0], id: 'task-escalated', status: 'escalated' });
    expect(crmSummary(data)).toEqual({ active: 2, queued: 1, occupiedRooms: 1, openTasks: 2 });
    expect(filterCrmVisits(data, 'sim-001', 'queued').map(visit => visit.id)).toEqual(['visit-a']);
    expect(filterCrmVisits(data, 'ТЕСТОВЫЙ ВРАЧ', 'completed')).toHaveLength(1);
    expect(filterCrmVisits(data, 'Нет такого пациента', 'all')).toEqual([]);
  });
  it('reserves a called room and excludes no-show from active visits and avatars', () => {
    const data = snapshot();
    data.visits[0].status = 'called';
    data.visits.push({ ...data.visits[0], id: 'no-show-visit', status: 'no_show' });
    expect(crmSummary(data)).toMatchObject({ active: 1, queued: 0, occupiedRooms: 1 });
    const html = renderToStaticMarkup(createElement(CrmScene, { snapshot: data, selection: null, onSelect: vi.fn(), visibleVisitIds: new Set(data.visits.map(visit=>visit.id)) }));
    expect(html).toContain('data-status="called"');
    expect(html).not.toContain('data-status="no_show"');
  });
});

describe('CRM response publication boundary', () => {
  it('uses the validated response snapshot, including server capabilities and versions', async () => {
    const data = snapshot();
    expect(await readCrmResponse(Response.json(data))).toEqual(data);
  });
  it.each([
    { mode: 'clinical' }, { schemaVersion: 2 }, { patients: [] },
    { capabilities: { read: true, manage: 'yes' } }, { generatedAt: 'invalid' },
  ])('rejects an incompatible/partial response instead of showing fixture data: %j', async override => {
    await expect(readCrmResponse(Response.json({ ...snapshot(), ...override }))).rejects.toThrow('неполное состояние');
  });
  it('preserves a server conflict as a failed operation and never accepts its body as a successful snapshot', async () => {
    await expect(readCrmResponse(Response.json({ error: { code: 'VERSION_CONFLICT', message: 'Версия изменилась. Обновите.' } }, { status: 409 }))).rejects.toMatchObject({ status: 409, message: 'Версия изменилась. Обновите.' });
    await expect(readCrmResponse(new Response('Unavailable', { status: 503 }))).rejects.toMatchObject({ status: 503 });
  });
});

describe('CRM created-record selection across concurrent snapshots', () => {
  const command = { type: 'visit.create' as const, patientId: 'patient-a', staffId: 'staff-a', roomId: 'room-a', serviceId: 'service-a', scheduledAt: now, testDataAcknowledged: true as const, idempotencyKey: '00000000-0000-4000-8000-000000000001' };
  it('selects the exact submitted patient/room/staff/service/time rather than the first new row from another tab', () => {
    const data = snapshot(); const ours = data.visits[0];
    data.visits.unshift({ ...ours, id: 'other-created', patientId: 'patient-other' });
    expect(createdCrmVisit(data, command, new Set())).toBe(ours);
  });
  it('refuses to select a record when multiple newly added visits match the entire submitted tuple', () => {
    const data = snapshot(); data.visits.push({ ...data.visits[0], id: 'concurrent-identical' });
    expect(createdCrmVisit(data, command, new Set())).toBeNull();
  });
  it('can reopen a unique exact record after an idempotent replay with no newly added IDs', () => {
    const data = snapshot();
    expect(createdCrmVisit(data, command, new Set(['visit-a']))?.id).toBe('visit-a');
    data.visits.push({ ...data.visits[0], id: 'old-identical' });
    expect(createdCrmVisit(data, command, new Set(['visit-a', 'old-identical']))).toBeNull();
  });
  it('does not confuse an unrelated new timestamp or service with the submitted visit', () => {
    const data = snapshot(); data.visits[0].scheduledAt = '2026-10-06T08:00:00.000Z';
    expect(createdCrmVisit(data, command, new Set())).toBeNull();
  });
});

describe('CRM scene interaction alternatives', () => {
  it('includes native room/visit buttons and keyboard pan/zoom/reset controls with no automatic stage advancement', () => {
    const data = snapshot(); const select = vi.fn();
    const html = renderToStaticMarkup(createElement(CrmScene, { snapshot: data, selection: null, onSelect: select, visibleVisitIds: new Set(['visit-a']) }));
    expect(html).toContain('<foreignObject');
    expect(html).toContain('aria-label="Открыть визит: Искусственный пациент"');
    expect(html).toContain('aria-label="Кабинет А, активных визитов: 1"');
    expect(html).toContain('aria-label="Вернуть исходный вид схемы"');
    expect(html).toContain('Home возвращает вид');
    expect(select).not.toHaveBeenCalled();
    expect(clampCrmZoom(.1)).toBe(.65); expect(clampCrmZoom(10)).toBe(1.8);
    expect(clampCrmPan(-1000)).toBe(-260); expect(clampCrmPan(1000)).toBe(260);
  });
  it('shows only current active stages in the scene while retaining a terminal record in the snapshot/list', () => {
    const data = snapshot(); data.visits[0].status = 'completed';
    const html = renderToStaticMarkup(createElement(CrmScene, { snapshot: data, selection: null, onSelect: vi.fn(), visibleVisitIds: new Set(['visit-a']) }));
    expect(html).not.toContain('Открыть визит:');
    expect(data.visits).toHaveLength(1);
  });
});

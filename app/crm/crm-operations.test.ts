import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CrmSnapshot } from '@/lib/crm/contracts';
import { CrmOperations, type CrmOperationsView } from './crm-operations';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const now = '2026-10-06T07:00:00.000Z';
function snapshot(): CrmSnapshot {
  return { schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'clinic-test', name: 'Тестовая клиника' }, generatedAt: now,
    rooms: [{ id: 'room-a', name: 'Кабинет А', kind: 'consultation', x: 0, y: 0, width: 5, depth: 4 }],
    staff: [{ id: 'staff-a', name: 'Тестовый врач', role: 'doctor', roomId: 'room-a' }],
    services: [{ id: 'service-a', name: 'Тестовая консультация', durationMinutes: 20, roomKind: 'consultation' }],
    patients: [{ id: 'patient-a', name: 'Искусственная пациентка', mrn: 'SIM-001', sex: 'female' }, { id: 'patient-no-visit', name: 'Тест без визитов', mrn: 'SIM-002', sex: 'unknown' }],
    visits: [{ id: 'visit-a', patientId: 'patient-a', staffId: 'staff-a', roomId: 'room-a', serviceId: 'service-a', scheduledAt: now, updatedAt: now, status: 'scheduled', version: 1 }],
    tasks: [{ id: 'task-a', visitId: 'visit-a', patientId: 'patient-a', ownerId: 'staff-a', kind: 'preparation', title: 'Тестовая подготовка', status: 'escalated', priority: 'urgent', dueAt: '2026-10-06T06:00:00.000Z', version: 2 }],
    events: [{ id: 'event-a', kind: 'visit.rescheduled', resourceId: 'visit-a', actorLabel: 'Сотрудник симуляции', createdAt: now, fromStatus: 'scheduled', toStatus: 'scheduled' }],
    capabilities: { read: true, manage: true } };
}
function render(view: CrmOperationsView, canWrite = false, blocked = false, data = snapshot()) {
  const onSelect = vi.fn(); const onCommand = vi.fn().mockResolvedValue(true);
  const html = renderToStaticMarkup(createElement(CrmOperations, { view, snapshot: data, onSelect, onCommand, canWrite, blocked }));
  return { html, onSelect, onCommand };
}

describe('CRM operational simulation views', () => {
  it.each(['overview', 'tasks', 'patients', 'resources'] as const)('renders %s from the passed snapshot with no automatic command or synthetic acknowledgment', view => {
    const { html, onCommand, onSelect } = render(view);
    expect(html).toContain('Действия CRM');
    expect(html).toContain('Время устройства');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('href="/patients');
    expect(onCommand).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
  });
  it('shows snapshot-based priorities and the exact saved rescheduling event', () => {
    const { html } = render('overview');
    expect(html).toContain('Тестовая подготовка'); expect(html).toContain('Перенесён визит');
    expect(html).toContain('Сотрудник симуляции'); expect(html).toContain('не оценка здоровья');
  });
  it('keeps patients without visits selectable, with saved sex/MRN and honest empty visit context', () => {
    const { html } = render('patients');
    expect(html).toContain('Тест без визитов'); expect(html).toContain('SIM-002 · Не указан');
    expect(html).toContain('Визитов пока нет. Карта доступна для просмотра.');
    expect(html).toContain('SIM-001 · Женский');
    expect(html).toMatch(/<button[^>]*>[^<]*<span[\s\S]*?Тест без визитов/);
    expect(html).not.toContain('disabled=""');
  });
  it('shows saved birth date and manual training provenance without claiming real people or inferring age', () => {
    const data = snapshot(); data.patients[0].birthDate = '1991-03-08'; data.patients[0].registrationSource = 'manual_training';
    const { html, onCommand } = render('patients', false, false, data);
    expect(html).toContain('Пациенты CRM'); expect(html).toContain('Карточки пациентов из базы CRM');
    expect(html).not.toContain('реальные пациенты'); expect(html).toContain('Дата рождения: 08.03.1991');
    expect(html).toContain('Профиль введён вручную'); expect(html).not.toContain('Возраст');
    expect(onCommand).not.toHaveBeenCalled();
  });
  it('keeps missing birth dates and registration provenance explicit for older rows', () => {
    const { html } = render('patients');
    expect(html.match(/Дата рождения: Не указана/g)).toHaveLength(2);
    expect(html.match(/Источник регистрации не указан/g)).toHaveLength(2);
    expect(html).not.toContain('Профиль введён вручную');
    expect(html).not.toContain('Дата рождения: 01.01');
  });
  it('delegates the legacy schedule component entry to the same durable calendar without invented hours', () => {
    const { html, onCommand } = render('schedule');
    expect(html).toContain('Календарная политика');
    expect(html).not.toContain('Проверка пересечений будущих записей пока не подключена');
    expect(html).toContain('подтвердите работу с учебной БД');
    expect(onCommand).not.toHaveBeenCalled();
  });
  it('keeps task actions aligned with current stage, including explicit reopening after review', () => {
    const html = render('tasks', true).html;
    expect(html).toContain('Вернуть в работу'); expect(html).not.toContain('>Завершить</button>');
    expect(html).toContain('Создать задачу'); expect(html).not.toContain('disabled=""');
    const data = snapshot(); data.tasks[0].status = 'completed';
    expect(render('tasks', true, false, data).html).not.toContain('Вернуть в работу');
  });
  it('locks every selectable resource and write control during a pending root operation', () => {
    expect(render('tasks', true, true).html).toContain('Дождитесь завершения операции');
    expect(render('tasks', true, true).html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Создать задачу<\/button>/);
    const data = snapshot(); data.capabilities.manage = false;
    expect(render('tasks', true, false, data).html).toContain('позволяет только просмотр');
    expect(render('tasks', true, false, data).html).toContain('disabled=""');
  });
  it('shows actual resources and bounded meaning of room occupancy instead of promising real slots', () => {
    const { html } = render('resources');
    expect(html).toContain('Кабинет А'); expect(html).toContain('Тестовый врач');
    expect(html).toContain('Нет визита на приёме'); expect(html).toContain('не означает доступный слот');
  });
  it('bounds the patient directory to 100 rendered cards while reporting all matching records and pagination', () => {
    const data = snapshot(); data.visits = []; data.tasks = []; data.events = [];
    data.patients = Array.from({ length: 103 }, (_, number) => ({ id: `patient-${number}`, name: `Тестовый пациент ${String(number).padStart(3, '0')}`, mrn: `SIM-${number}`, sex: 'unknown' as const }));
    const html = render('patients', true, false, data).html;
    expect(html.match(/<article/g)).toHaveLength(100);
    expect(html).toContain('Найдено пациентов: 103'); expect(html).toContain('1–100 из 103 найденных записей');
    expect(html).toContain('Следующие'); expect(html).not.toContain('Тестовый пациент 102');
  });
  it('bounds the whole task board to 100 cards without truncating its matched count', () => {
    const data = snapshot();
    data.tasks = Array.from({ length: 103 }, (_, number) => ({ ...data.tasks[0], id: `task-${number}`, title: `Тестовая задача ${number}`, status: 'pending' as const }));
    const html = render('tasks', true, false, data).html;
    expect(html.match(/<article/g)).toHaveLength(100);
    expect(html).toContain('1–100 из 103 найденных записей');
    expect(html).toContain('>103</b>');
  });
  it.each(['overview', 'schedule', 'tasks', 'patients', 'resources'] as const)('renders understandable emptiness for %s without creating records', view => {
    const data = snapshot(); data.visits = []; data.tasks = []; data.events = []; data.patients = []; data.rooms = []; data.staff = []; data.services = [];
    const { html } = render(view, true, false, data);
    expect(html).not.toContain('Искусственная пациентка'); expect(html).not.toContain('Тестовая подготовка');
    expect(html).toMatch(/нет|пуста|ещё|не найдены/i);
  });
});

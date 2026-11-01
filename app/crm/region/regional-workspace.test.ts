import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { regionalFacilitySnapshotSchema } from '@/lib/regional/contracts';
import { RegionalConfirmation, RegionalFacilityWorkspace, RegionalVisitCard, regionalActiveVisits, regionalCommandAllowed, regionalVisitActions } from './regional-facility';
import { RegionalKpi, RegionalWorkspace, regionalDate, regionalResponse, regionalWriteRejected, RegionalRequestError, regionalAccessLost } from './regional-workspace';

const time = '2026-10-08T10:00:00.000Z';
function snapshot() {
  return regionalFacilitySnapshotSchema.parse({ schemaVersion: 1, dataMode: 'training', generatedAt: time,
    kpiDefinition: { title: 'Задачи вовремя', formula: 'Вовремя / с наступившим сроком', periodStart: time, periodEnd: time }, insights: [],
    facility: { id: 'turkestan-hospital', clinicId: 'regional-turkestan-hospital', districtId: 'turkestan', name: 'Больница Туркестана',
      kind: 'hospital', latitude: 43.295, longitude: 68.297, address: 'Учебная территория', populated: true,
      hospitalCount: 1, polyclinicCount: 0, patientCount: 2, activeVisits: 1, queuedVisits: 1, openTasks: 0, overdueTasks: 0,
      completedTasks: 0, totalTasks: 0, onTimeTasks: 0, dueTasks: 0, kpiPercent: null },
    crm: { schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'regional-turkestan-hospital', name: 'Больница Туркестана' },
      rooms: [{ id: 'room-a', name: 'Приёмная', kind: 'consultation', x: 0, y: 0, width: 4, depth: 4 }],
      staff: [{ id: 'doctor-a', name: 'Айша С.', role: 'doctor', roomId: 'room-a' }],
      services: [{ id: 'consultation', name: 'Консультация', durationMinutes: 30, roomKind: 'consultation' }],
      patients: [{ id: 'patient-a', name: 'Пациент <script>alert(1)</script>', mrn: 'REG-001', sex: 'female' },
        { id: 'patient-b', name: 'Дана К.', mrn: 'REG-002', sex: 'female' }],
      visits: [{ id: 'visit-a', patientId: 'patient-a', staffId: 'doctor-a', roomId: 'room-a', serviceId: 'consultation',
        scheduledAt: time, updatedAt: time, status: 'queued', version: 1, queueOrder: 1 }],
      tasks: [], events: [], capabilities: { read: true, manage: false }, generatedAt: time },
    medicalRecords: [], prescriptions: [], labs: [], stocks: [], procurements: [], workTasks: [], events: [],
    capabilities: { manage: false, readPatients: true, readClinical: true, manageVisits: false, startVisits: false, manageTasks: false,
      manageLabs: false, reviewLabs: false, dispense: false, receiveProcurement: false },
  });
}

describe('regional workspace boundary and first render', () => {
  it('treats a changed session as an access loss on every read, not as an ordinary conflict', () => {
    expect(regionalAccessLost(new RegionalRequestError('changed', 409, 'SESSION_CHANGED'))).toBe(true);
    expect(regionalAccessLost(new RegionalRequestError('denied', 403))).toBe(true);
    expect(regionalAccessLost(new RegionalRequestError('expired', 401))).toBe(true);
    expect(regionalAccessLost(new RegionalRequestError('stale', 409, 'REGIONAL_VERSION_CONFLICT'))).toBe(false);
  });
  it('keeps the original command key for uncertain post-commit permission or snapshot failures', () => {
    for (const code of ['SESSION_CHANGED', 'REGIONAL_ACCESS_DENIED', 'REGIONAL_NOT_FOUND', 'REGIONAL_UNAVAILABLE', undefined]) expect(regionalWriteRejected(code)).toBe(false);
    for (const code of ['REGIONAL_VERSION_CONFLICT', 'REGIONAL_INVALID_TRANSITION', 'REGIONAL_STOCK_UNAVAILABLE', 'REGIONAL_QUEUE_CONFLICT']) expect(regionalWriteRejected(code)).toBe(true);
  });
  it('distinguishes a missing KPI denominator from a genuine zero result', () => {
    const absent = renderToStaticMarkup(createElement(RegionalKpi, { value: null }));
    const zero = renderToStaticMarkup(createElement(RegionalKpi, { value: 0 }));
    expect(absent).toContain('—'); expect(absent).not.toContain('0%');
    expect(zero).toContain('0%'); expect(zero).not.toContain('—');
  });
  it('does not manufacture clinical counts or provider summaries before an API read', () => {
    const html = renderToStaticMarkup(createElement(RegionalWorkspace));
    expect(html).toContain('Загрузка из базы');
    expect(html).not.toContain('задач вовремя');
    expect(html).not.toContain('Рекомендации ИИ');
    expect(html).not.toContain('REG-001');
  });
  it('renders only supplied persisted patients and escapes their names without executing commands', () => {
    const execute = vi.fn(async () => true);
    const html = renderToStaticMarkup(createElement(RegionalFacilityWorkspace, { snapshot: snapshot(), busy: false, execute }));
    expect(html).toContain('REG-001'); expect(html).toContain('REG-002'); expect(html).toContain('Дана К.');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('Тестовый пациент');
    expect(execute).not.toHaveBeenCalled();
  });
  it('shows no invented patient or queued actor in an empty institution', () => {
    const value = snapshot();
    value.crm.patients = []; value.crm.visits = []; value.facility.patientCount = 0; value.facility.queuedVisits = 0; value.facility.activeVisits = 0;
    const html = renderToStaticMarkup(createElement(RegionalFacilityWorkspace, { snapshot: value, busy: false, execute: async () => true }));
    expect(html).toContain('ещё нет карт пациентов'); expect(html).not.toContain('REG-001');
    expect(html).not.toContain('aria-label="Пациент ');
  });
  it('formats clinical dates in the clinic timezone rather than the operator computer timezone', () => {
    expect(regionalDate('2026-10-07T22:10:00.000Z')).toContain('08');
    expect(regionalDate('2026-10-07T22:10:00.000Z')).toContain('03:10');
    expect(regionalDate('1980-04-12', true)).toContain('1980');
  });
  it('validates successful API payloads instead of treating an arbitrary 200 as valid data', async () => {
    const schema = z.object({ total: z.number().nonnegative() }).strict();
    await expect(regionalResponse(Response.json({ total: 2 }), schema)).resolves.toEqual({ total: 2 });
    await expect(regionalResponse(Response.json({ total: -1 }), schema)).rejects.toThrow();
    await expect(regionalResponse(Response.json({ total: 2, patientToken: 'unexpected' }), schema)).rejects.toThrow();
  });
  it('preserves a safe server denial message and refuses malformed error or login HTML', async () => {
    const schema = z.object({ total: z.number() });
    await expect(regionalResponse(Response.json({ error: { message: 'Нет доступа к учреждению.' } }, { status: 403 }), schema)).rejects.toThrow('Нет доступа к учреждению.');
    await expect(regionalResponse(new Response('<html>secret internal error</html>', { status: 500 }), schema)).rejects.toThrow('Сервис временно недоступен');
    await expect(regionalResponse(new Response('<html>Sign in</html>', { status: 200 }), schema)).rejects.toThrow();
  });
});

describe('regional visit actions and role-aware facility rendering', () => {
  function editable() {
    const value = snapshot();
    value.crm.capabilities.manage = true;
    value.capabilities.manage = true;
    value.capabilities.manageVisits = true;
    value.capabilities.startVisits = true;
    return value;
  }
  it('offers only valid visit transitions and never bypasses clinician note completion', () => {
    const value = editable(), visit = value.crm.visits[0];
    const matrix = { scheduled: ['arrive', 'cancel'], arrived: ['queue', 'cancel'], queued: ['call', 'cancel'],
      called: ['requeue', 'start', 'cancel'], in_service: [], completed: [], cancelled: [], no_show: [] } as const;
    for (const [status, actions] of Object.entries(matrix)) {
      visit.status = status as typeof visit.status;
      expect(regionalVisitActions(value, visit).map(choice => choice.action)).toEqual(actions);
    }
    visit.status = 'in_service';
    const html = renderToStaticMarkup(createElement(RegionalVisitCard, { snapshot: value, visit, busy: false, onAction: vi.fn() }));
    expect(html).toContain('требует медицинской записи врача');
    expect(html).not.toContain('>Завершить');
  });
  it('blocks a later FIFO entry and a reserved room instead of silently calling out of order', () => {
    const value = editable(), first = value.crm.visits[0];
    const second = { ...first, id: 'visit-b', patientId: 'patient-b', queueOrder: 2 };
    value.crm.visits.push(second);
    expect(regionalVisitActions(value, first).find(choice => choice.action === 'call')?.disabledReason).toBeNull();
    expect(regionalVisitActions(value, second).find(choice => choice.action === 'call')?.disabledReason).toContain('первую запись');
    first.status = 'called';
    expect(regionalVisitActions(value, second).find(choice => choice.action === 'call')?.disabledReason).toContain('уже занят');
  });
  it('uses regional visit permissions while the embedded legacy CRM remains read-only', () => {
    const value = editable(), visit = value.crm.visits[0];
    value.crm.capabilities.manage = false;
    expect(regionalVisitActions(value, visit).find(choice => choice.action === 'call')?.disabledReason).toBeNull();
    expect(value.crm.capabilities.manage).toBe(false);
    value.capabilities.manageVisits = false;
    expect(regionalVisitActions(value, visit).every(choice => choice.disabledReason?.includes('просмотр'))).toBe(true);
    value.capabilities.manageVisits = true; value.capabilities.manage = false;
    expect(regionalVisitActions(value, visit).every(choice => choice.disabledReason?.includes('просмотр'))).toBe(true);
  });
  it('shows the resource queue position rather than its global audit sequence', () => {
    const value = editable(), visit = value.crm.visits[0];
    visit.queueOrder = 1262;
    const html = renderToStaticMarkup(createElement(RegionalVisitCard, { snapshot: value, visit, busy: false, onAction: vi.fn() }));
    expect(html).toContain('Место в очереди: 1'); expect(html).not.toContain('1262');
    expect(visit.queueOrder).toBe(1262);
  });
  it('preserves canonical queue order and excludes terminal visits from the active worklist', () => {
    const value = editable(), base = value.crm.visits[0];
    value.crm.visits = [{ ...base, id: 'second', queueOrder: 8, scheduledAt: '2026-10-08T08:00:00.000Z' },
      { ...base, id: 'first', queueOrder: 7 }, { ...base, id: 'done', status: 'completed' },
      { ...base, id: 'cancelled', status: 'cancelled' }, { ...base, id: 'no-show', status: 'no_show' },
      { ...base, id: 'current', status: 'in_service' }];
    expect(regionalActiveVisits(value).map(visit => visit.id)).toEqual(['current', 'first', 'second']);
  });
  it('explains stale snapshot and read-only actions, and disables every button while saving', () => {
    const value = editable(), visit = value.crm.visits[0];
    expect(regionalVisitActions(value, { ...visit, version: 2 }).every(choice => choice.disabledReason?.includes('изменилось'))).toBe(true);
    value.capabilities.manageVisits = false;
    expect(regionalVisitActions(value, visit).every(choice => choice.disabledReason?.includes('просмотр'))).toBe(true);
    value.capabilities.manageVisits = true;
    const html = renderToStaticMarkup(createElement(RegionalVisitCard, { snapshot: value, visit, busy: true, onAction: vi.fn() }));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBe(2); expect(buttons.every(button => button.includes('disabled'))).toBe(true);
  });
  it('does not let a visit manager approve labs, dispense medicine or receive procurement', () => {
    const value = editable();
    expect(regionalCommandAllowed(value, { type: 'visit.transition' })).toBe(true);
    for (const type of ['task.transition', 'lab.complete', 'lab.review', 'prescription.dispense', 'procurement.receive'] as const) {
      expect(regionalCommandAllowed(value, { type })).toBe(false);
    }
    value.capabilities.reviewLabs = true;
    expect(regionalCommandAllowed(value, { type: 'lab.review' })).toBe(true);
    value.capabilities.manage = false;
    expect(regionalCommandAllowed(value, { type: 'lab.review' })).toBe(false);
  });
  it('lets a registrar call or requeue but reserves start of an encounter to clinical permission', () => {
    const value = editable(), visit = value.crm.visits[0];
    value.capabilities.startVisits = false;
    visit.status = 'called';
    const choices = regionalVisitActions(value, visit);
    expect(choices.find(choice => choice.action === 'start')?.disabledReason).toContain('врач');
    expect(choices.find(choice => choice.action === 'requeue')?.disabledReason).toBeNull();
    expect(regionalCommandAllowed(value, { type: 'visit.transition', action: 'start' })).toBe(false);
    expect(regionalCommandAllowed(value, { type: 'visit.transition', action: 'requeue' })).toBe(true);
    value.capabilities.startVisits = true;
    expect(regionalCommandAllowed(value, { type: 'visit.transition', action: 'start' })).toBe(true);
  });
  it('hides clinical details from registration and patient identities from an administrative-only snapshot', () => {
    const value = editable();
    value.medicalRecords.push({ patientId: 'patient-b', trainingIin: 'TRAIN-ONLY', birthDate: '1980-04-12', allergies: [],
      conditions: [{ code: 'X', name: 'Закрытый клинический диагноз', since: '2026-01-01', status: 'active' }], history: [] });
    value.capabilities.readClinical = false;
    const registrar = renderToStaticMarkup(createElement(RegionalFacilityWorkspace, { snapshot: value, busy: false, execute: async () => true }));
    expect(registrar).toContain('REG-002'); expect(registrar).not.toContain('Закрытый клинический диагноз');
    expect(registrar).not.toContain('>Анализы</button>'); expect(registrar).not.toContain('>Аптека</button>');
    value.capabilities.readPatients = false;
    value.workTasks.push({ id: 'clinical-task', patientId: 'patient-b', visitId: null, ownerId: 'doctor-a',
      title: 'Секретное лекарство пациента', category: 'care', priority: 'routine', status: 'pending', dueAt: time, completedAt: null, version: 1 });
    const administrator = renderToStaticMarkup(createElement(RegionalFacilityWorkspace, { snapshot: value, busy: false, execute: async () => true }));
    expect(administrator).not.toContain('REG-002'); expect(administrator).not.toContain('Дана К.');
    expect(administrator).not.toContain('Закрытый клинический диагноз');
    expect(administrator).not.toContain('Секретное лекарство пациента');
    expect(regionalVisitActions(value, value.crm.visits[0])).toEqual([]);
  });
  it('keeps a read-only clinician able to read clinical cards without gaining medication-write permission', () => {
    const value = snapshot();
    value.medicalRecords.push({ patientId: 'patient-b', trainingIin: 'TRAIN-ONLY', birthDate: '1980-04-12', allergies: [],
      conditions: [{ code: 'X', name: 'Сохранённая клиническая запись', since: '2026-01-01', status: 'active' }], history: [] });
    const html = renderToStaticMarkup(createElement(RegionalFacilityWorkspace, { snapshot: value, busy: false, execute: async () => true }));
    expect(html).toContain('Сохранённая клиническая запись');
    expect(regionalCommandAllowed(value, { type: 'prescription.dispense' })).toBe(false);
  });
  it('keeps server errors visible in the manual confirmation and prevents confirmation after a permission loss', () => {
    const html = renderToStaticMarkup(createElement(RegionalConfirmation, { title: 'Изменить визит?', detail: 'Имена только из БД',
      error: 'Запись уже изменилась. Обновите данные.', busy: false, allowed: false, onConfirm: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain('aria-labelledby="regional-command-title"');
    expect(html).toContain('role="alert"'); expect(html).toContain('Запись уже изменилась');
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>Подтвердить<\/button>/);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Отмена<\/button>/);
  });
});

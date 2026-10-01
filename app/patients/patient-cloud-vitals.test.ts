import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { PatientDetail } from '@/lib/repositories/patient-registry';
import type { LatestPatientVitals } from '@/lib/repositories/patient-observations';

// Real client handlers with a small explicit hook driver, matching the existing
// pagination UI acceptance pattern. No API, request fence, measurement panel or
// payload-binding mock; only React's scheduling and HTTP responses are doubled.
// These artificial local UI scenarios are NOT provider/browser acceptance.
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[],
  memos: [] as { value: unknown; deps: unknown[] }[], effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0, push: vi.fn() }));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const unchanged = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return { ...actual,
    useState(initial: unknown) {
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = hooks.refIndex++;
      if (!hooks.refs[index]) hooks.refs[index] = { current: initial };
      return hooks.refs[index];
    },
    useCallback(value: unknown, deps: unknown[]) {
      const index = hooks.memoIndex++;
      if (!hooks.memos[index] || !unchanged(hooks.memos[index].deps, deps)) hooks.memos[index] = { value, deps };
      return hooks.memos[index].value;
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = hooks.effectIndex++; const previous = hooks.effects[index];
      if (previous && unchanged(previous.deps, deps)) return;
      hooks.pending.push(() => { previous?.cleanup?.(); hooks.effects[index] = { deps, cleanup: effect() }; });
    },
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hooks.push }) }));
vi.mock('next/link', () => ({ default: 'a' }));

import { PatientDetailView } from './[patientId]/patient-detail';
import { PatientVitalsPanel } from './[patientId]/patient-vitals-panel';

type Element = ReactElement<Record<string, unknown>>;
type DetailProps = Parameters<typeof PatientDetailView>[0];
type VitalsProps = Parameters<typeof PatientVitalsPanel>[0];
const facility = 'facility-a'; const assignment = 'assignment-a';
const props: DetailProps = { patientId: 'patient-a', facilityId: facility, accessAssignmentId: assignment,
  vitalsAvailable: true, photoAvailable: false, encounterWorkspaceAvailable: false };
const now = 1790840000000;
function patient(id = 'patient-a'): PatientDetail {
  return { id, displayName: `Artificial ${id}`, medicalRecordNumber: `SYN-${id}`, birthDate: '1990-01-02',
    sexAtBirth: 'female', testIin: null, phone: null, email: null, address: null, photoUrl: null, status: 'active',
    version: 1, encounterCount: 0, latestEncounter: null, createdAt: now, updatedAt: now, encounters: [],
    profileHistory: [], profileHistoryCount: 0, profileHistoryPage: { hasMore: false, nextCursor: null },
    encountersPage: { hasMore: false, nextCursor: null } };
}
function detail(id = 'patient-a', facilityId = facility, assignmentId = assignment) {
  return { organization: { id: 'org-a', name: 'Artificial organization' }, facility: { id: facilityId, name: 'Artificial clinic' },
    accessAssignment: { assignmentId }, patient: patient(id) };
}
function vitals(weightKg = 64): LatestPatientVitals {
  const source = { observationId: 'observation-a', version: 1, measuredAt: now - 10000,
    recordedBy: 'Artificial recorder', sourceLabel: 'Облачный ручной ввод · тестовые данные' };
  return { anthropometry: { ...source, heightCm: 165, weightKg, bmi: weightKg === 64 ? 23.51 : 20.2 },
    bloodPressure: { ...source, systolicMmhg: 118, diastolicMmhg: 76 }, temperature: { ...source, temperatureC: 36.5 } };
}
function measurement(changes: Record<string, unknown> = {}) {
  return { organizationId: 'org-a', patientId: 'patient-a', facilityId: facility, accessAssignmentId: assignment,
    assignmentVersionId: 'assignment-version-a', role: 'clinician', sourceLabel: 'Облачный ручной ввод · тестовые данные',
    observedAt: now, timeZone: 'Asia/Almaty', persistence: 'supabase', clinicalInterpretation: 'not_performed', vitals: vitals(), ...changes };
}
function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
function deferredResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  return { response: new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    resolve(value: unknown) { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); } };
}
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join(' ').replace(/\s+/g, ' ').trim();
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'object' && 'props' in node) return text((node as Element).props.children as ReactNode);
  return String(node);
}
function render(component: () => ReactElement) {
  hooks.stateIndex = hooks.refIndex = hooks.memoIndex = hooks.effectIndex = 0;
  return component();
}
function flushEffects() { hooks.pending.splice(0).forEach(effect => effect()); }
async function mount(component: () => ReactElement) {
  render(component); flushEffects(); await vi.runOnlyPendingTimersAsync();
  render(component); flushEffects(); await vi.runOnlyPendingTimersAsync();
  return render(component);
}
function panel(tree: ReactNode) {
  const found = elements(tree).find(element => element.type === PatientVitalsPanel);
  expect(found, 'real measurement panel').toBeDefined();
  return found!.props as VitalsProps;
}
function mountPanel(tree: ReactNode) {
  // Reserve a separate child hook slot. Execute the actual child component,
  // not just inspect an unmounted ReactElement's href prop.
  const previous = hooks.stateIndex; hooks.stateIndex = 1000;
  try { return PatientVitalsPanel(panel(tree)); }
  finally { hooks.stateIndex = previous; }
}

beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.pending = []; hooks.push.mockReset();
  vi.useFakeTimers();
  vi.stubGlobal('document', { cookie: '__Host-orion-cloud-generation=' + 'a'.repeat(32) });
  vi.stubGlobal('window', { location: { search: `?facilityId=${facility}&accessAssignmentId=${assignment}`,
    href: `https://orion.test/patients/patient-a?facilityId=${facility}&accessAssignmentId=${assignment}` },
  history: { replaceState: vi.fn() }, setTimeout, clearTimeout });
});
afterEach(() => {
  hooks.effects.forEach(effect => effect.cleanup?.()); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('prepared cloud patient vitals client acceptance (NOT live provider proof)', () => {
  it('fetches the exact patient/assignment/facility API and mounts measurements linking to observations, not legacy pathway', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(detail())).mockResolvedValueOnce(response(measurement()));
    vi.stubGlobal('fetch', fetchMock);
    const tree = await mount(() => PatientDetailView(props));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL(String(fetchMock.mock.calls[0][0]), 'https://orion.test');
    const second = new URL(String(fetchMock.mock.calls[1][0]), 'https://orion.test');
    expect(first.pathname).toBe('/api/patients/patient-a');
    expect(Object.fromEntries(first.searchParams)).toEqual({ facilityId: facility, accessAssignmentId: assignment });
    expect(second.pathname).toBe('/api/observations/latest-vitals');
    expect(Object.fromEntries(second.searchParams)).toEqual({ patientId: 'patient-a', facilityId: facility, accessAssignmentId: assignment });
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
      expect(call[1].signal).toBeInstanceOf(AbortSignal); expect(call[1].signal.aborted).toBe(false);
    }
    expect(panel(tree).measurement).toMatchObject({ state: 'ready', value: vitals(), timeZone: 'Asia/Almaty' });
    const mounted = mountPanel(tree);
    expect(text(mounted)).toContain('118/76'); expect(text(mounted)).toContain('23,51'); expect(text(mounted)).toContain('Artificial recorder');
    const facilityTime = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty',
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(now - 10000)).replace(/\s+/g, ' ');
    expect(text(mounted)).toContain(facilityTime);
    const link = elements(mounted).find(element => element.type === 'a' && text(element.props.children as ReactNode) === 'Все измерения');
    expect(link).toBeDefined(); const destination = new URL(String(link!.props.href), 'https://orion.test');
    expect(destination.pathname).toBe('/observations');
    expect(Object.fromEntries(destination.searchParams)).toEqual({ patientId: 'patient-a', accessAssignmentId: assignment, facilityId: facility });
    expect(elements(mounted).filter(element => element.type === 'a').every(element => !String(element.props.href).startsWith('/pathway'))).toBe(true);
    expect(elements(mounted).find(element => element.type === 'img')?.props.src).toBe('/patient-body/anatomy-female-v1.png');
  });

  it.each([
    ['organization binding', { organizationId: 'another-organization' }],
    ['patient binding', { patientId: 'another-patient' }],
    ['facility binding', { facilityId: 'another-facility' }],
    ['assignment binding', { accessAssignmentId: 'another-assignment' }],
    ['cloud persistence', { persistence: 'd1' }],
    ['clinical boundary', { clinicalInterpretation: 'performed' }],
    ['invalid facility time zone', { timeZone: 'Mars/Olympus' }],
    ['absent facility time zone', { timeZone: null }],
    ['absent measurement DTO', { vitals: null }],
    ['invalid pressure measurement group', { vitals: { ...vitals(), bloodPressure: { ...vitals().bloodPressure!, systolicMmhg: 39 } } }],
    ['invalid temperature measurement group', { vitals: { ...vitals(), temperature: { ...vitals().temperature!, temperatureC: 46 } } }],
  ])('does not publish a200 body with a wrong %s', async (_name, changes) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(detail())).mockResolvedValueOnce(response(measurement(changes))));
    const tree = await mount(() => PatientDetailView(props));
    expect(panel(tree).measurement).toMatchObject({ state: 'unavailable', value: null });
    const mounted = mountPanel(tree);
    expect(text(mounted)).toContain('Измерения недоступны'); expect(text(mounted)).not.toContain('118/76');
    expect(elements(mounted).filter(element => element.type === 'a')).toHaveLength(0);
  });

  it.each([401, 403, 404, 503])('does not replace missing measurements with invented values after API%s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(detail())).mockResolvedValueOnce(response({ error: { code: 'Artificial failure' } }, status)));
    const tree = await mount(() => PatientDetailView(props));
    expect(panel(tree).measurement).toMatchObject({ state: 'unavailable', value: null });
    expect(text(mountPanel(tree))).not.toContain('118/76');
  });

  it('shows honest no-measurement state for a verified empty cloud response while retaining the observations link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(detail())).mockResolvedValueOnce(response(measurement({
      vitals: { anthropometry: null, bloodPressure: null, temperature: null },
    }))));
    const tree = await mount(() => PatientDetailView(props));
    expect(panel(tree).measurement.state).toBe('ready');
    const mounted = mountPanel(tree);
    expect(text(mounted)).toContain('Измерений пока нет'); expect(text(mounted)).toContain('Не записано');
    expect(text(mounted)).not.toContain('118/76'); expect(text(mounted)).not.toContain('23,51');
    expect(elements(mounted).find(element => element.type === 'a')?.props.href).toContain('/observations?');
  });

  it('never emits a legacy encounter workspace link from the mounted panel while that cloud capability is disabled', async () => {
    const value = detail();
    value.patient.latestEncounter = { id: 'encounter-a', reasonForVisit: 'Artificial previous visit',
      status: 'draft', updatedAt: now };
    value.patient.encounterCount = 1;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(value)).mockResolvedValueOnce(response(measurement())));
    const tree = await mount(() => PatientDetailView(props));
    const mounted = mountPanel(tree);
    expect(text(mounted)).toContain('Artificial previous visit');
    const destinations = elements(mounted).filter(element => element.type === 'a').map(element => new URL(String(element.props.href), 'https://orion.test'));
    expect(destinations).toHaveLength(1); expect(destinations[0].pathname).toBe('/observations');
    expect(destinations.some(url => url.searchParams.has('encounterId'))).toBe(false);
    expect(panel(tree).encounterUrl).toBeNull();
  });

  it('does not publish a delayed streamed measurement body after the account generation changes', async () => {
    const body = deferredResponse();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(detail()))
      .mockResolvedValueOnce(body.response);
    vi.stubGlobal('fetch', fetchMock);
    const component = () => PatientDetailView(props);
    const pending = await mount(component); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body.response.bodyUsed).toBe(true);
    expect(panel(pending).measurement).toMatchObject({ state: 'loading', value: null });
    document.cookie = '__Host-orion-cloud-generation=' + 'b'.repeat(32);
    body.resolve(measurement()); await vi.runAllTimersAsync();
    const tree = render(component);
    expect(panel(tree).measurement.value).toBeNull(); expect(panel(tree).measurement.state).not.toBe('ready');
    expect(text(mountPanel(tree))).not.toContain('118/76');
  });

  it('retires delayed streamed JSON across patient/scope change and publishes only the new patient scope', async () => {
    const oldBody = deferredResponse();
    const changed: DetailProps = { ...props, patientId: 'patient-b', facilityId: 'facility-b', accessAssignmentId: 'assignment-b' };
    const currentMeasurement = measurement({ patientId: 'patient-b', facilityId: 'facility-b', accessAssignmentId: 'assignment-b', vitals: vitals(55) });
    const fetchMock = vi.fn().mockResolvedValueOnce(response(detail()))
      .mockResolvedValueOnce(oldBody.response)
      .mockResolvedValueOnce(response(detail('patient-b', 'facility-b', 'assignment-b')))
      .mockResolvedValueOnce(response(currentMeasurement));
    vi.stubGlobal('fetch', fetchMock);
    const pending = await mount(() => PatientDetailView(props));
    expect(oldBody.response.bodyUsed).toBe(true);
    expect(panel(pending).measurement).toMatchObject({ state: 'loading', value: null });
    const hidden = render(() => PatientDetailView(changed));
    expect(elements(hidden).some(element => element.type === PatientVitalsPanel)).toBe(false);
    flushEffects(); await vi.runOnlyPendingTimersAsync();
    render(() => PatientDetailView(changed)); flushEffects(); await vi.runOnlyPendingTimersAsync();
    const beforeOld = render(() => PatientDetailView(changed));
    expect(panel(beforeOld).measurement).toMatchObject({ state: 'ready', value: vitals(55) });
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    oldBody.resolve(measurement()); await vi.runAllTimersAsync();
    const afterOld = render(() => PatientDetailView(changed));
    expect(panel(afterOld).patient.id).toBe('patient-b'); expect(panel(afterOld).measurement.value).toEqual(vitals(55));
    const latest = new URL(String(fetchMock.mock.calls[3][0]), 'https://orion.test');
    expect(Object.fromEntries(latest.searchParams)).toEqual({ patientId: 'patient-b', facilityId: 'facility-b', accessAssignmentId: 'assignment-b' });
  });

  it('performs no measurement or legacy API request when vitalsAvailable is false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(detail())); vi.stubGlobal('fetch', fetchMock);
    const tree = await mount(() => PatientDetailView({ ...props, vitalsAvailable: false }));
    flushEffects(); await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0]), 'https://orion.test').pathname).toBe('/api/patients/patient-a');
    expect(elements(tree).some(element => element.type === PatientVitalsPanel)).toBe(false);
    expect(text(tree)).toContain('Измерения и клинический рабочий стол пока недоступны');
    expect(hooks.push).not.toHaveBeenCalled();
  });
});

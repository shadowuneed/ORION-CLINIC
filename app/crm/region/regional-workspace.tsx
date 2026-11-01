'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Building2, Check, ChevronRight, ClipboardCheck, Database, Hospital, MapPinned, RefreshCw, Search, Sparkles, Stethoscope, X } from 'lucide-react';
import { z } from 'zod';
import { regionalScopeSchema, regionalOverviewSchema, regionalFacilitySnapshotSchema, type RegionalScope, type RegionalOverview, type RegionalFacilitySnapshot, type RegionalCommand, type RegionalDistrict } from '@/lib/regional/contracts';
import { regionalBriefingResponseSchema, type RegionalBriefing } from '@/lib/regional/briefing';
import { regionalLanding, regionalLocationUrl } from '@/lib/regional/workspace-access';
import { isRegionalLocation, regionalBackTarget, regionalDoorwayOrigin, regionalInteriorReady, regionalNavigationTarget } from '@/lib/regional/journey';
import { regionalAnalyticsScope } from '@/lib/regional/analytics-scope';
import { RegionalMap } from './regional-map';
import { RegionalFacilityWorkspace } from './regional-facility';
import { RegionalMetrics } from './regional-metrics';
import { RegionalKpiPanel } from './regional-kpi-panel';
import { RegionalFacilityPreview } from './regional-facility-preview';
import styles from './regional-workspace.module.css';

export class RegionalRequestError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); } }
export function regionalAccessLost(cause: unknown) { return cause instanceof RegionalRequestError && ([401, 403].includes(cause.status) || cause.code === 'SESSION_CHANGED'); }
export async function regionalResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ message: z.string().max(600), code: z.string().max(100).optional() }) }).safeParse(payload);
    throw new RegionalRequestError(parsed.success ? parsed.data.error.message : 'Сервис временно недоступен. Повторите загрузку.', response.status, parsed.success ? parsed.data.error.code : undefined);
  }
  return schema.parse(payload);
}
export function regionalDate(value: string, dateOnly = false) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Qyzylorda', day: '2-digit', month: 'short',
    ...(dateOnly ? { year: 'numeric' } as const : { hour: '2-digit', minute: '2-digit' } as const) }).format(new Date(value));
}
export function RegionalKpi({ value, compact = false }: { value: number | null; compact?: boolean }) {
  return <span className={compact ? styles.kpiSmall : styles.kpi} data-tone={value === null ? 'empty' : value >= 80 ? 'good' : value >= 50 ? 'warning' : 'danger'}>
    <strong>{value === null ? '—' : `${Math.round(value)}%`}</strong>{!compact && <span>задач вовремя</span>}
  </span>;
}

export function RegionalWorkspace({ initialDistrictId = null, initialFacilityId = null }: { initialDistrictId?: string | null; initialFacilityId?: string | null }) {
  const [access, setAccess] = useState<RegionalScope | null>(null);
  const [overview, setOverview] = useState<RegionalOverview | null>(null);
  const [facility, setFacility] = useState<RegionalFacilitySnapshot | null>(null);
  const [districtId, setDistrictId] = useState(initialDistrictId);
  const [facilityId, setFacilityId] = useState(initialFacilityId);
  const [search, setSearch] = useState('');
  const [previewFacilityId, setPreviewFacilityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [facilityLoading, setFacilityLoading] = useState(Boolean(initialFacilityId));
  const [facilityReload, setFacilityReload] = useState(0);
  const [focusedFacility, setFocusedFacility] = useState<string | null>(null);
  const [doorwayOrigin, setDoorwayOrigin] = useState<{ x: number; y: number } | null>(null);
  const [leavingInterior, setLeavingInterior] = useState(false);
  const journeyStage = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [ai, setAi] = useState<RegionalBriefing | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [showAi, setShowAi] = useState(false);
  const overviewRequest = useRef(0); const facilityRequest = useRef(0); const aiRequest = useRef(0);
  const writeLock = useRef(false); const aiLock = useRef(false);
  const pendingWrite = useRef<RegionalCommand | null>(null);
  const [pendingRecovery, setPendingRecovery] = useState<RegionalCommand | null>(null);
  const [dataView, setDataView] = useState<'map' | 'indicators'>('map');
  const [indicatorsOpened, setIndicatorsOpened] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const currentUrl = useRef('');
  const activeFacility = useRef(initialFacilityId);
  const previewContainer = useRef<HTMLDivElement>(null);
  const completeFacilityFocus = useCallback((id: string, anchor?: { clientX: number; clientY: number }) => {
    if (activeFacility.current !== id) return;
    const bounds = journeyStage.current?.getBoundingClientRect();
    setDoorwayOrigin(bounds ? regionalDoorwayOrigin(anchor, bounds) : null);
    setFocusedFacility(id);
  }, []);
  useEffect(() => {
    if (!leavingInterior) return;
    const timer = setTimeout(() => setLeavingInterior(false), 640);
    return () => clearTimeout(timer);
  }, [leavingInterior]);
  const invalidateAccess = useCallback(() => {
    ++overviewRequest.current; ++facilityRequest.current; ++aiRequest.current; requestController.current?.abort();
    activeFacility.current = null; setAccess(null); setOverview(null); setFacility(null); setAi(null); setPreviewFacilityId(null); setFocusedFacility(null); setDoorwayOrigin(null); setLeavingInterior(false); setLoading(false); setFacilityLoading(false); setAiBusy(false);
  }, []);

  const loadOverview = useCallback(async () => {
    const run = ++overviewRequest.current; setLoading(true); setError(''); ++aiRequest.current; setAi(null); setShowAi(false); setAiBusy(false);
    // A role downgrade can keep the same hospital ID. Invalidate its entire
    // prior payload before checking the next scope, not just the URL selection.
    ++facilityRequest.current; requestController.current?.abort(); activeFacility.current = null; setFacility(null); setAccess(null); setOverview(null);
    try {
      const scope = await regionalResponse(await fetch('/api/regional/v1/scope', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) }), regionalScopeSchema);
      if (run !== overviewRequest.current) return;
      setAccess(scope);
      setFacilityReload(value => value + 1);
      const query = new URLSearchParams(window.location.search);
      const landing = regionalLanding(scope, { districtId: query.get('area'), facilityId: query.get('facility') });
      activeFacility.current = landing.facilityId;
      // Refreshing an already-open hospital revalidates data, not the camera journey.
      // A new target (or a denied target) must still complete its own camera focus.
      setFocusedFacility(previous => previous === landing.facilityId ? previous : null);
      setDistrictId(landing.districtId); setFacilityId(landing.facilityId); setPreviewFacilityId(null);
      currentUrl.current = regionalLocationUrl(landing.districtId, landing.facilityId);
      window.history.replaceState(window.history.state, '', currentUrl.current);
      if (landing.denied) { setFacility(null); setError('Этот раздел не входит в ваш рабочий доступ. Доступны только назначенные учреждения.'); }
      if (!scope.canViewRegion) { setOverview(null); return; }
      const value = await regionalResponse(await fetch('/api/regional/v1/overview', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) }), regionalOverviewSchema);
      if (run === overviewRequest.current) setOverview(value);
    } catch (cause) { if (run === overviewRequest.current) {
      if (regionalAccessLost(cause)) invalidateAccess();
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить сеть.');
    } }
    finally { if (run === overviewRequest.current) setLoading(false); }
  }, [invalidateAccess]);
  useEffect(() => { const fence = overviewRequest; const timer = setTimeout(() => void loadOverview(), 0); return () => { clearTimeout(timer); ++fence.current; }; }, [loadOverview]);
  const facilityAllowed = Boolean(access?.facilities.some(row => row.id === facilityId));
  useEffect(() => {
    const run = ++facilityRequest.current;
    const scopeRun = overviewRequest.current;
    const controller = new AbortController(); requestController.current = controller;
    const timer = setTimeout(() => {
      setFacility(null); setFacilityLoading(Boolean(facilityId && facilityAllowed));
      if (!facilityId || !facilityAllowed) return;
      void (async () => {
        try {
          const value = await regionalResponse(await fetch(`/api/regional/v1/facilities/${encodeURIComponent(facilityId)}`, {
            credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          }), regionalFacilitySnapshotSchema);
          if (value.facility.id !== facilityId) throw new Error('Получены данные другого учреждения. Повторите загрузку.');
          if (run === facilityRequest.current && scopeRun === overviewRequest.current && !controller.signal.aborted) setFacility(value);
        } catch (cause) { if (run === facilityRequest.current && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Не удалось открыть учреждение.');
          if (regionalAccessLost(cause)) invalidateAccess();
        } }
        finally { if (run === facilityRequest.current && !controller.signal.aborted) setFacilityLoading(false); }
      })();
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [facilityId, facilityReload, facilityAllowed, invalidateAccess]);
  useEffect(() => {
    const sync = (event: PopStateEvent) => {
      if (writeLock.current || pendingWrite.current) { event.stopImmediatePropagation(); window.history.replaceState(window.history.state, '', currentUrl.current); setNotice('Сначала подтвердите сохранение текущего действия.'); return; }
      // The router owns other pages and the legacy clinic/schedule views.
      if (!isRegionalLocation(window.location.pathname, window.location.search)) return;
      setDataView('map');
      ++facilityRequest.current; requestController.current?.abort();
      const query = new URLSearchParams(window.location.search);
      const landing = access ? regionalLanding(access, { districtId: query.get('area'), facilityId: query.get('facility') }) : { districtId: null, facilityId: null };
      activeFacility.current = landing.facilityId;
      setDistrictId(landing.districtId); setFacilityId(landing.facilityId); setPreviewFacilityId(null);
      setFacility(null); setFocusedFacility(null); setLeavingInterior(false); setFacilityReload(value => value + 1); currentUrl.current = regionalLocationUrl(landing.districtId, landing.facilityId);
      window.history.replaceState(window.history.state, '', currentUrl.current);
      ++aiRequest.current; setAi(null); setAiError(''); setAiBusy(false); setShowAi(false);
    };
    currentUrl.current = `${window.location.pathname}${window.location.search}`;
    window.addEventListener('popstate', sync, true);
    return () => { window.removeEventListener('popstate', sync, true); };
  }, [access]);
  useEffect(() => {
    const fence = aiRequest; const requests = requestController;
    const warn = (event: BeforeUnloadEvent) => { if (writeLock.current || pendingWrite.current) event.preventDefault(); };
    const protectSpaLeave = (event: MouseEvent) => {
      if (!writeLock.current && !pendingWrite.current) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin || `${target.pathname}${target.search}` === currentUrl.current) return;
      event.preventDefault(); event.stopPropagation(); setError('Сначала подтвердите результат сохранения. Переход в другой раздел пока приостановлен.');
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', protectSpaLeave, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', protectSpaLeave, true); ++fence.current; requests.current?.abort(); };
  }, []);

  function navigate(area: string | null, hospital: string | null = null) {
    if (writeLock.current || !access) return;
    const destination = regionalNavigationTarget(access, overview?.districts.map(row => row.id) ?? access.facilities.map(row => row.districtId), area, hospital);
    if (!destination) return;
    area = destination.districtId; hospital = destination.facilityId;
    if (pendingWrite.current && hospital !== pendingWrite.current.facilityId) { setError('Сначала проверьте результат сохранения в этом учреждении.'); return; }
    setDataView('map');
    if (area === districtId && hospital === facilityId) { clearOperationalAi(); setPreviewFacilityId(null); return; }
    setLeavingInterior(Boolean(access.canViewRegion && facility && focusedFacility === facilityId && !hospital && area === facility.facility.districtId));
    ++facilityRequest.current; requestController.current?.abort();
    activeFacility.current = hospital;
    setFacility(null); setFocusedFacility(null); setDistrictId(area); setFacilityId(hospital); setPreviewFacilityId(null); setError(''); setNotice('');
    setFacilityReload(value => value + 1);
    ++aiRequest.current; setAi(null); setAiError(''); setAiBusy(false); setShowAi(false);
    currentUrl.current = regionalLocationUrl(area, hospital);
    window.history.pushState(window.history.state, '', currentUrl.current);
  }
  function refresh() { if (writeLock.current) return; setError(''); void loadOverview(); }
  function clearOperationalAi() {
    ++aiRequest.current; setAi(null); setShowAi(false); setAiError(''); setAiBusy(false);
  }
  function closePreview() { clearOperationalAi(); setPreviewFacilityId(null); }
  function previewInstitution(id: string) {
    if (!access || writeLock.current || pendingWrite.current) return;
    const row = access.facilities.find(item => item.id === id);
    if (!row) return;
    clearOperationalAi();
    setDataView('map');
    // A preview uses aggregate metadata only. Clinical records are fetched only
    // when the separate entry action chooses facilityId.
    if (access.canViewRegion && (districtId !== row.districtId || facilityId)) navigate(row.districtId);
    else if (!access.canViewRegion && facilityId) navigate(null);
    setPreviewFacilityId(id);
  }
  const district = overview?.districts.find(row => row.id === (facility?.facility.districtId ?? districtId));
  const selectedFacilities = useMemo(() => overview?.facilities.filter(row => districtId ? row.districtId === districtId : overview.districts.find(d => d.id === row.districtId)?.regionId === 'turkestan') ?? [], [overview, districtId]);
  const matchedDistricts = overview?.districts.filter(row => `${row.name}`.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU'))) ?? [];
  const matchedFacilities = (search.trim() ? overview?.facilities ?? [] : selectedFacilities).filter(row => `${row.name} ${row.address}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
  const previewAllowed = Boolean(access?.facilities.some(row => row.id === previewFacilityId));
  const previewFacility = previewAllowed ? overview?.facilities.find(row => row.id === previewFacilityId) ?? access?.facilities.find(row => row.id === previewFacilityId) : undefined;
  const facilityName = facility?.facility.name ?? access?.facilities.find(row => row.id === facilityId)?.name;
  const interiorReady = regionalInteriorReady(access, facilityId, facility?.facility.id, focusedFacility);
  const displayedFacilityName = interiorReady ? facilityName : undefined;
  const metrics = interiorReady ? facility?.facility : district ?? overview?.totals;
  const backTarget = access ? regionalBackTarget(access, districtId, facilityId) : null;
  const analytics = regionalAnalyticsScope({ access, overview, facility, districtId, facilityId, previewFacilityId });
  const visibleInsights = analytics?.insights.slice(0, 4) ?? [];
  const kpiDefinition = analytics?.definition;
  function showIndicators() { setIndicatorsOpened(true); setDataView('indicators'); }
  const hasPreview = Boolean(access && previewFacility && !facilityId);
  useEffect(() => {
    if (!hasPreview || dataView !== 'map' || !window.matchMedia('(max-width: 900px)').matches) return;
    previewContainer.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [previewFacilityId, dataView, hasPreview]);
  const preview = access && previewFacility && !facilityId ? <div ref={previewContainer} className={styles.previewAnchor} aria-label="Сводка выбранного учреждения"><RegionalFacilityPreview facility={previewFacility}
    districtName={overview?.districts.find(row => row.id === previewFacility.districtId)?.name}
    disabled={busy || Boolean(pendingRecovery)} onEnter={() => navigate(access.canViewRegion ? previewFacility.districtId : null, previewFacility.id)}
    onClose={closePreview} onIndicators={showIndicators} /></div> : null;

  async function execute(command: RegionalCommand) {
    if (writeLock.current || command.facilityId !== facilityId) return false;
    if (!facility?.capabilities.manage) { setError('Право изменения больше недоступно. Для проверки сохранения обратитесь к администратору; новое действие не отправлено.'); return false; }
    const pending = pendingWrite.current;
    if (pending && JSON.stringify({ ...pending, idempotencyKey: '' }) !== JSON.stringify({ ...command, idempotencyKey: '' })) {
      setError('Предыдущее действие ещё не подтверждено. Повторите его, чтобы проверить результат.'); return false;
    }
    const actual = pending ?? command; pendingWrite.current = actual; setPendingRecovery(null);
    ++aiRequest.current; setAi(null); setAiBusy(false);
    writeLock.current = true; setBusy(true); setError(''); setNotice(''); const run = facilityRequest.current;
    try {
      const value = await regionalResponse(await fetch('/api/regional/v1/commands', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(actual), signal: AbortSignal.timeout(20000) }),
      z.object({ result: z.object({ resourceId: z.string(), version: z.number(), replayed: z.boolean() }), snapshot: regionalFacilitySnapshotSchema }));
      if (value.snapshot.facility.id !== actual.facilityId) throw new Error('Не удалось подтвердить сохранение в выбранном учреждении. Повторите проверку.');
      pendingWrite.current = null; setPendingRecovery(null);
      if (run === facilityRequest.current) { setFacility(value.snapshot); setNotice(value.result.replayed ? 'Действие уже сохранено. Показано актуальное состояние.' : 'Сохранено. Связанные записи и показатели обновлены.'); }
      setAi(null); await loadOverview(); return true;
    } catch (cause) {
      // A command can commit before the subsequent snapshot/session check fails.
      // Keep its key unless the server positively rejected the write itself.
      if (cause instanceof RegionalRequestError && regionalWriteRejected(cause.code)) pendingWrite.current = null;
      setPendingRecovery(pendingWrite.current);
      if (regionalAccessLost(cause)) invalidateAccess();
      setError(cause instanceof Error ? cause.message : 'Не удалось подтвердить запись. Повторите действие.'); return false;
    }
    finally { writeLock.current = false; setBusy(false); }
  }
  async function analyze() {
    if (aiLock.current || loading || busy || !analytics) return;
    aiLock.current = true; const run = ++aiRequest.current; setShowAi(true); setAiBusy(true); setAiError('');
    try {
      const value = await regionalResponse(await fetch('/api/regional/v1/briefing', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(analytics.request), signal: AbortSignal.timeout(30000) }), regionalBriefingResponseSchema);
      if (run === aiRequest.current) setAi(value);
    } catch (cause) { if (run === aiRequest.current) {
      if (regionalAccessLost(cause)) {
        invalidateAccess();
      }
      setAiError(cause instanceof Error ? cause.message : 'Не удалось получить сводку.');
      setError(cause instanceof Error ? cause.message : 'Не удалось получить сводку.');
    } }
    finally { aiLock.current = false; if (run === aiRequest.current) setAiBusy(false); }
  }

  return <main className={styles.workspace} data-view={dataView}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>ORION · {access ? access.canViewRegion ? 'МЕДИЦИНСКАЯ СЕТЬ' : 'МОИ УЧРЕЖДЕНИЯ' : 'CRM'}</span><h1>{displayedFacilityName ?? district?.name ?? (access ? access.canViewRegion ? 'Туркестанская область' : 'Мои больницы' : 'Открываем CRM')}</h1>
        <p>{interiorReady ? 'Кабинеты, пациенты и работа учреждения' : district ? 'Выберите больницу или поликлинику на карте' : access?.canViewRegion ? 'Выберите район, затем здание больницы' : access ? 'Ваши учреждения и рабочие записи' : 'Загружаем назначенные учреждения'}</p></div>
      <div className={styles.headerActions}>
        <Link className={styles.button} href="/crm?view=directives" aria-disabled={busy || Boolean(pendingRecovery)} onClick={event => {
          if (busy || pendingRecovery) event.preventDefault();
        }}><ClipboardCheck size={16} />Поручения</Link>
        <span className={styles.dataset}><Database size={14} />Учебная база</span>
        <Link className={styles.button} href="/crm?view=clinic" aria-disabled={busy || Boolean(pendingRecovery)} onClick={event => {
          if (writeLock.current || pendingWrite.current) { event.preventDefault(); setError('Сначала подтвердите результат сохранения в исходном учреждении.'); }
        }}><Building2 size={16} />Моя клиника</Link>
        <button className={styles.button} type="button" onClick={refresh} disabled={loading || busy} aria-label="Обновить показатели сети"><RefreshCw size={16} />Обновить</button>
      </div>
    </header>
    {access && <div className={styles.workspaceToolbar}>
      <nav className={styles.viewSwitch} aria-label="Представление CRM">
        <button type="button" aria-pressed={dataView === 'map'} onClick={() => setDataView('map')}><MapPinned size={16} />{interiorReady ? 'План учреждения' : 'Карта и больницы'}</button>
        <button type="button" aria-pressed={dataView === 'indicators'} onClick={showIndicators}><BarChart3 size={16} />Показатели и отчёты</button>
      </nav>
      {access.canViewRegion && !facilityId && <label className={styles.globalSearch}><Search size={17} /><input value={search}
        onChange={event => { setSearch(event.target.value); setDataView('map'); }} placeholder="Найти больницу или район…" aria-label="Поиск по всей медицинской сети" />
        {search && <button type="button" onClick={() => setSearch('')} aria-label="Очистить поиск"><X size={15} /></button>}
      </label>}
    </div>}
    <div className={styles.navigationLine}>
      {backTarget && <button className={styles.returnButton} type="button" disabled={busy || Boolean(pendingRecovery)} onClick={() => navigate(backTarget.districtId, backTarget.facilityId)}><ArrowLeft size={18} /><span>{facilityId && access?.canViewRegion && district ? `К учреждениям: ${district.name}` : backTarget.label}<small>{facilityId && access?.canViewRegion ? district?.name ?? 'Учреждения территории' : 'Все доступные территории'}</small></span></button>}
      <nav aria-label="Уровни медицинской сети" className={styles.breadcrumb}>
        {access && <button type="button" onClick={() => navigate(null)} disabled={busy || Boolean(pendingRecovery)} aria-current={!districtId && !facilityId ? 'location' : undefined}><span className={styles.levelNumber}>01</span>{access.canViewRegion ? 'Карта области' : 'Мои больницы'}</button>}
        {access?.canViewRegion && district && <><ChevronRight size={14} /><button type="button" onClick={() => navigate(district.id)} disabled={busy || Boolean(pendingRecovery)} aria-current={!facilityId ? 'location' : undefined}><span className={styles.levelNumber}>02</span>{district.name}</button></>}
        {facilityId && <><ChevronRight size={14} /><span aria-current="location"><span className={styles.levelNumber}>{access?.canViewRegion ? '03' : '02'}</span>{facilityName ?? 'Учреждение'}</span></>}
      </nav><span className={styles.updated}>{access ? `Обновлено ${regionalDate(facility?.generatedAt ?? overview?.generatedAt ?? access.generatedAt)}` : 'Загрузка из базы…'}</span>
    </div>
    {error && <div role="alert" className={styles.error}>{error}<button type="button" onClick={refresh} disabled={busy}>Обновить</button></div>}
    {notice && <div role="status" className={styles.notice}><Check size={16} />{notice}</div>}
    {pendingRecovery && <div role="status" className={styles.recovery}><span>Ответ на сохранение не получен. Проверьте результат перед следующим изменением — повтор не создаст вторую запись.</span>
      <button type="button" className={styles.button} disabled={busy} onClick={() => {
        if (facilityId === pendingRecovery.facilityId && facility) void execute(pendingRecovery);
        else { const row = access?.facilities.find(item => item.id === pendingRecovery.facilityId); if (row) navigate(access?.canViewRegion ? row.districtId : null, row.id); }
      }}>{facilityId === pendingRecovery.facilityId ? 'Проверить сохранение' : 'Открыть исходное учреждение'}</button></div>}
    {!access && loading && <div className={styles.loading} role="status"><MapPinned size={30} /><h2>Открываем рабочее пространство</h2><p>Проверяем назначенные учреждения</p></div>}
    {access && !access.canViewRegion && !facilityId && dataView === 'map' && <section className={styles.assignedFacilities} aria-label="Мои назначенные учреждения">
      <h2>Доступные больницы</h2><p>Областная карта доступна только региональному администратору.</p>
      {preview}
      {access.facilities.map(row => <button type="button" className={styles.facilityRow} key={row.id} onClick={() => previewInstitution(row.id)} disabled={busy}>
        <span className={styles.facilityIcon}><Hospital size={20} /></span><span><strong>{row.name}</strong><small>{row.kind === 'hospital' ? 'Больница' : 'Поликлиника'} · {row.canManage ? 'Рабочий доступ' : 'Просмотр'}</small></span><ChevronRight size={16} />
      </button>)}
      {!access.facilities.length && <p>Новые учреждения вам пока не назначены. Прежний доступ сохранён: <Link href="/crm?view=clinic">открыть свою клинику</Link>. Для нового назначения обратитесь к администратору.</p>}
    </section>}
    <div ref={journeyStage} className={styles.journeyStage} hidden={dataView !== 'map'} data-interior={interiorReady} data-leaving={leavingInterior && !interiorReady}
      style={doorwayOrigin ? { '--doorway-x': `${doorwayOrigin.x}px`, '--doorway-y': `${doorwayOrigin.y}px` } as CSSProperties : undefined} aria-label="Карта и учреждение">
    {access?.canViewRegion && overview && <div className={`${styles.explorer} ${styles.geographyLayer}`} aria-hidden={interiorReady} inert={interiorReady}>
      <section className={styles.mapPanel} aria-label="Карта медицинской сети">
        <RegionalMap districts={overview.districts} facilities={overview.facilities} selectedDistrictId={districtId} selectedFacilityId={facilityId} previewFacilityId={previewFacilityId}
          active={!interiorReady && dataView === 'map'} onFacilityFocusComplete={completeFacilityFocus}
          onFacilityFocusCancel={id => { if (id === facilityId) navigate(districtId); }}
          onSelectDistrict={id => { setSearch(''); setPreviewFacilityId(null); navigate(id); }} onOpenFacility={previewInstitution} />
      </section>
      <aside className={styles.sidebar} aria-label={search.trim() ? 'Результаты по всей сети' : districtId ? 'Учреждения территории' : 'Территории области'}>
        {preview}
        {!preview && metrics && <div className={styles.networkPulse} aria-label="Сейчас в базе">
          <div><strong>{metrics.hospitalCount + metrics.polyclinicCount}</strong><span>учреждений</span></div>
          <div><strong>{metrics.patientCount}</strong><span>пациентов</span></div>
          <div><strong>{metrics.queuedVisits}</strong><span>в очереди</span></div>
        </div>}
        <div className={styles.panelHeading}><div><span className={styles.eyebrow}>{search.trim() ? 'ПОИСК ПО ВСЕЙ СЕТИ' : districtId ? 'ВЫБЕРИТЕ ЗДАНИЕ ИЛИ СТРОКУ' : 'ВЫБЕРИТЕ НА КАРТЕ ИЛИ В СПИСКЕ'}</span><h2>{search.trim() ? 'Результаты поиска' : districtId ? 'Учреждения района' : 'Районы и города'}</h2></div><span className={styles.count}>{search.trim() ? matchedFacilities.length + matchedDistricts.length : districtId ? selectedFacilities.length : overview.districts.length}</span></div>
        <div className={styles.directory}>
          {(!districtId || search.trim()) && matchedDistricts.map(row => <DistrictRow key={row.id} district={row} onSelect={() => { setSearch(''); navigate(row.id); }} />)}
          {(districtId || search.trim()) && matchedFacilities.map(row => <button key={row.id} className={styles.facilityRow} aria-pressed={previewFacilityId === row.id} type="button" onClick={() => previewInstitution(row.id)}>
            <span className={styles.facilityIcon}>{row.kind === 'hospital' ? <Hospital size={20} /> : <Stethoscope size={20} />}</span>
            <span><strong>{row.name}</strong><small>{row.patientCount} пациентов · {row.queuedVisits} в очереди</small><small>{row.openTasks} задач{row.overdueTasks ? ` · ${row.overdueTasks} просрочено` : ''}</small></span>
            <ChevronRight size={15} />
          </button>)}
          {(districtId ? matchedFacilities.length === 0 : matchedDistricts.length === 0 && (!search.trim() || matchedFacilities.length === 0)) && <p className={styles.empty}>Ничего не найдено. Попробуйте другое название.</p>}
        </div>
        <div className={styles.scopeNote}><Database size={12} /> {district?.regionId === 'shymkent' ? 'Шымкент учитывается отдельно от области.' : 'Записи из PostgreSQL · учебные данные'}</div>
      </aside>
    </div>}
    {facilityId && !interiorReady && (facilityLoading || facility) && <div className={styles.arrivalNotice} role="status"><Hospital size={22} /><span><strong>{facilityName ?? 'Открываем учреждение'}</strong><small>{facilityLoading ? 'Загружаем кабинеты и записи из базы…' : 'Приближаемся к зданию…'}</small></span></div>}
    {interiorReady && facility && <div className={styles.interiorLayer}><RegionalFacilityWorkspace key={facility.facility.id} snapshot={facility} busy={busy || loading} actionError={error} execute={execute} /></div>}
    </div>
    {access && indicatorsOpened && <section hidden={dataView !== 'indicators'} className={styles.indicatorsView} aria-label="Отчёты и показатели">
      <RegionalKpiPanel scopeKey={access.generatedAt} canViewRegion={access.canViewRegion}
        districtId={districtId} facilityId={facilityId ?? previewFacilityId}
        scopeLabel={facilityId ? facilityName : previewFacility?.name ?? district?.name}
        onAccessLost={() => { invalidateAccess(); setError('Сеанс или доступ изменился. Обновите страницу для проверки прав.'); }}
        onSelectFacility={previewInstitution} />
      {metrics && interiorReady && <RegionalMetrics metrics={metrics} name={displayedFacilityName ?? 'Учреждение'} level="Учреждение" />}
    </section>}
    {access && dataView === 'indicators' && (facility || (access.canViewRegion && overview)) && kpiDefinition && <section className={styles.intelligence}>
      <div className={styles.insightIntro}><span className={styles.aiIcon}><Sparkles size={22} /></span><div><span className={styles.eyebrow}>ОПЕРАЦИОННЫЕ ЗАДАЧИ</span><h2>Очередь и задачи</h2><p>{analytics?.label} · текущая работа, отдельно от отчётного периода KPI</p></div><button className={styles.primary} type="button" onClick={() => void analyze()} disabled={aiBusy || busy || loading}><Sparkles size={16} />{aiBusy ? 'Анализируем…' : 'Сводка ИИ по задачам'}</button></div>
      <div className={styles.insightGrid}>
        <div className={styles.kpiExplanation}><ClipboardCheck size={20} /><strong>{kpiDefinition.title}</strong><p>{kpiDefinition.formula}</p>
          <span>{regionalDate(kpiDefinition.periodStart, true)} — {regionalDate(kpiDefinition.periodEnd, true)}</span>
          {analytics?.metrics && <small>{analytics.metrics.onTimeTasks} вовремя из {analytics.metrics.dueTasks} с наступившим сроком. Не оценка качества лечения.</small>}
        </div>
        {visibleInsights.length ? visibleInsights.map(item => <button type="button" key={item.id} className={styles.insight} data-severity={item.severity}
          onClick={() => navigate(access.canViewRegion ? item.districtId ?? districtId : null, item.facilityId ?? facilityId)} disabled={busy}>
          <strong>{item.title}</strong><p>{item.detail}</p><span>Открыть записи <ArrowRight size={14} /></span>
        </button>) : <div className={styles.kpiExplanation}><Check size={20} /><strong>Нет выделенных отклонений</strong><p>По доступным записям выбранной территории.</p></div>}
      </div>
      {showAi && <div className={styles.aiReport} aria-live="polite"><div className={styles.panelHeading}><strong><Sparkles size={16} />Сводка Groq</strong><button type="button" aria-label="Скрыть сводку ИИ" onClick={() => setShowAi(false)}><X size={16} /></button></div>
        {aiBusy && <p>ИИ анализирует только агрегированные показатели…</p>}{aiError && <p role="alert">{aiError}</p>}
        {ai && <><p>{ai.summary}</p><ul>{ai.priorities.map((priority, index) => <li key={index}>{priority}</li>)}</ul><small>Черновик для проверки · {ai.model} · {regionalDate(ai.generatedAt)} · сохранён в базе</small></>}
        <p className={styles.scopeNote}>В ИИ передаются счётчики выбранной территории. Имена, ИИН и медицинские тексты пациентов не передаются. Рекомендации не выполняют действия автоматически.</p>
      </div>}
    </section>}
  </main>;
}
export function regionalWriteRejected(code: string | undefined) {
  return Boolean(code && ['REGIONAL_INVALID_COMMAND', 'REGIONAL_VERSION_CONFLICT', 'REGIONAL_IDEMPOTENCY_CONFLICT',
    'REGIONAL_INVALID_TRANSITION', 'REGIONAL_STOCK_UNAVAILABLE', 'REGIONAL_CAPACITY_CONFLICT', 'REGIONAL_QUEUE_CONFLICT'].includes(code));
}
function DistrictRow({ district, onSelect }: { district: RegionalDistrict; onSelect: () => void }) {
  return <button type="button" className={styles.districtRow} onClick={onSelect} data-neighbor={district.regionId === 'shymkent'}>
    <span><strong>{district.name}</strong><small>{district.regionId === 'shymkent' ? 'Отдельный город · ' : ''}{district.hospitalCount} больниц · {district.polyclinicCount} поликлиник</small></span>
    <ChevronRight size={15} />
  </button>;
}

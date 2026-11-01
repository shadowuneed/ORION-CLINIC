'use client';

import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, CalendarDays, ChevronDown, ClipboardCheck, ExternalLink, FlaskConical, RefreshCw, Search, ShieldCheck, Sparkles, Table2, Users, X } from 'lucide-react';
import {
  aggregateRegionalKpi,
  regionalKpiEvidenceQuerySchema,
  regionalKpiEvidenceSchema,
  regionalKpiQuerySchema,
  regionalKpiSnapshotSchema,
  type RegionalKpiDefinition,
  type RegionalKpiEvidence,
  type RegionalKpiEvidenceQuery,
  type RegionalKpiQuery,
  type RegionalKpiSnapshot,
} from '@/lib/regional/kpi';
import { regionalKpiBriefingRequestSchema, regionalKpiBriefingResponseSchema, type RegionalKpiBriefing, type RegionalKpiBriefingRequest } from '@/lib/regional/kpi-briefing';
import styles from './regional-kpi-panel.module.css';

type KpiScope = { regionId?: string; districtId?: string; facilityId?: string };
type Period = { start: string; end: string };
type KpiResult = ReturnType<typeof aggregateRegionalKpi>;
export type RegionalKpiGroup = 'medical' | 'operations';
export function regionalKpiGroup(definition: RegionalKpiDefinition): RegionalKpiGroup {
  return definition.category === 'operations' ? 'operations' : 'medical';
}

export interface RegionalKpiPanelProps {
  /** Changes whenever the parent revalidates identity/permissions, not only the URL. */
  scopeKey: string;
  canViewRegion: boolean;
  districtId?: string | null;
  facilityId?: string | null;
  scopeLabel?: string;
  onAccessLost: () => void;
  /** Selects an institution summary; never starts a clinical or transactional action. */
  onSelectFacility: (facilityId: string) => void;
}

const formatNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const formatDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatUpdated = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Qyzylorda' });
const formatSnapshotDate = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Qyzylorda' });
const statusLabels: Record<KpiResult['status'], string> = {
  no_data: 'Нет данных',
  within_target: 'В пределах ориентира',
  outside_target: 'За пределами ориентира',
  no_target: 'Без оценки по нормативу',
};
const evidenceKindLabels: Record<RegionalKpiEvidence['items'][number]['kind'], string> = {
  care_episode: 'Случай медицинской помощи', complaint_decision: 'Решение по жалобе', lab_sample: 'Лабораторный образец',
  doctor_position: 'Штатная позиция', main_doctor: 'Основной врач', prescription: 'Рецепт', procurement: 'Закупка',
  work_task: 'Рабочая задача', visit: 'Визит', encounter: 'Документация приёма',
};

/** Reporting dates are clinic-local dates; they do not depend on the PC timezone. */
export function lastCompletedKpiMonth(now: Date): Period {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  return {
    start: new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10),
  };
}

export function currentKpiMonth(now: Date): Period {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  const prefix = `${part('year')}-${part('month')}`;
  return { start: `${prefix}-01`, end: `${prefix}-${part('day')}` };
}

export function regionalKpiPanelScope({ canViewRegion, districtId, facilityId }: Pick<RegionalKpiPanelProps, 'canViewRegion' | 'districtId' | 'facilityId'>): KpiScope {
  if (facilityId) return { facilityId };
  if (districtId) return { districtId };
  // Shymkent is a separate city. Assigned employees still see their exact
  // server-returned institution even when that institution is in Shymkent.
  return canViewRegion ? { regionId: 'turkestan' } : {};
}

export class RegionalKpiAccessLostError extends Error {
  constructor() { super('Рабочий доступ изменился. Войдите заново или обновите права.'); }
}

async function protectedKpiResponse(url: string, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const response = await fetch(url, {
    credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal,
  });
  signal.throwIfAborted();
  if (response.status === 401 || response.status === 403) throw new RegionalKpiAccessLostError();
  const body: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    if (body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
      && 'code' in body.error && body.error.code === 'SESSION_CHANGED') throw new RegionalKpiAccessLostError();
    // Do not display database/provider errors or echo a protected server payload.
    throw new Error('Не удалось загрузить показатели. Повторите запрос.');
  }
  return body;
}

/** The response is validated before entering component state. No local fallback data. */
export async function loadRegionalKpi(query: RegionalKpiQuery, signal: AbortSignal): Promise<RegionalKpiSnapshot> {
  const input = regionalKpiQuerySchema.parse(query);
  const params = new URLSearchParams({ start: input.start, end: input.end });
  if (input.facilityId) params.set('facilityId', input.facilityId);
  const body = await protectedKpiResponse(`/api/regional/v1/kpi?${params}`, signal);
  const parsed = regionalKpiSnapshotSchema.safeParse(body);
  if (!parsed.success || parsed.data.period.start !== input.start || parsed.data.period.end !== input.end
    || (input.facilityId && parsed.data.facilities.some(facility => facility.id !== input.facilityId))) {
    throw new Error('Ответ не соответствует выбранному периоду или учреждению. Обновите показатели.');
  }
  signal.throwIfAborted();
  return parsed.data;
}

export async function loadRegionalKpiEvidence(query: RegionalKpiEvidenceQuery, signal: AbortSignal): Promise<RegionalKpiEvidence> {
  const input = regionalKpiEvidenceQuerySchema.parse(query);
  const params = new URLSearchParams({ start: input.start, end: input.end, facilityId: input.facilityId,
    indicatorId: input.indicatorId, offset: String(input.offset ?? 0) });
  const body = await protectedKpiResponse(`/api/regional/v1/kpi/evidence?${params}`, signal);
  const parsed = regionalKpiEvidenceSchema.safeParse(body);
  if (!parsed.success || parsed.data.period.start !== input.start || parsed.data.period.end !== input.end
    || parsed.data.facilityId !== input.facilityId || parsed.data.indicatorId !== input.indicatorId
    || parsed.data.offset !== (input.offset ?? 0)) throw new Error('Получены записи другого расчёта. Повторите запрос.');
  signal.throwIfAborted();
  return parsed.data;
}

export class RegionalKpiBriefingCooldownError extends Error {
  constructor(readonly seconds: number) { super(`Повторный запрос будет доступен через ${seconds} сек.`); }
}

export async function loadRegionalKpiBriefing(query: RegionalKpiBriefingRequest, signal: AbortSignal): Promise<RegionalKpiBriefing> {
  const input = regionalKpiBriefingRequestSchema.parse(query);
  signal.throwIfAborted();
  const response = await fetch('/api/regional/v1/kpi/briefing', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(input), signal });
  signal.throwIfAborted();
  if (response.status === 401 || response.status === 403) throw new RegionalKpiAccessLostError();
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After'));
    throw new RegionalKpiBriefingCooldownError(Number.isFinite(seconds) && seconds > 0 ? Math.min(300, Math.ceil(seconds)) : 60);
  }
  const body: unknown = await response.json().catch(() => null); signal.throwIfAborted();
  if (!response.ok) {
    if (body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object'
      && 'code' in body.error && body.error.code === 'SESSION_CHANGED') throw new RegionalKpiAccessLostError();
    throw new Error('Сводка ИИ временно недоступна. Показатели и исходные записи остаются доступны.');
  }
  const parsed = regionalKpiBriefingResponseSchema.safeParse(body);
  const scopeType = input.facilityId ? 'facility' : input.districtId ? 'district' : 'region';
  const scopeId = input.facilityId ?? input.districtId ?? 'turkestan';
  if (!parsed.success || parsed.data.period.start !== input.start || parsed.data.period.end !== input.end
    || parsed.data.scopeType !== scopeType || parsed.data.scopeId !== scopeId) throw new Error('Сводка относится к другому периоду или учреждению. Повторите запрос.');
  signal.throwIfAborted();
  return parsed.data;
}

export function RegionalKpiBriefingContent({ value }: { value: RegionalKpiBriefing }) {
  return <div className={styles.aiContent}><p>{value.summary}</p>
    {value.priorities.length > 0 && <ol>{value.priorities.slice(0, 3).map((priority, index) => <li key={index}>{priority}</li>)}</ol>}
    <details className={styles.aiSource}><summary>Основание сводки</summary><p>{periodLabel(value.period)} · {formatUpdated.format(new Date(value.generatedAt))}</p>
      <p>Модель: {value.model} · версия данных: <code>{value.sourceHash}</code></p></details>
    <small>Черновик ИИ для проверки человеком. Основан на агрегатах БД; решения и действия не выполняются автоматически.</small>
  </div>;
}

export function RegionalKpiAiBriefing({ snapshot, scope, canViewRegion, onAccessLost }: { snapshot: RegionalKpiSnapshot; scope: KpiScope; canViewRegion: boolean; onAccessLost: () => void }) {
  const [value, setValue] = useState<RegionalKpiBriefing | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [cooldown, setCooldown] = useState(0);
  const request = useRef<AbortController | null>(null); const generation = useRef(0); const lock = useRef(false);
  const query: RegionalKpiBriefingRequest | null = scope.facilityId ? { ...snapshot.period, facilityId: scope.facilityId }
    : canViewRegion ? { ...snapshot.period, ...(scope.districtId ? { districtId: scope.districtId } : {}) }
      : snapshot.facilities.length === 1 ? { ...snapshot.period, facilityId: snapshot.facilities[0].id } : null;
  const hasSources = snapshot.definitions.some(definition => aggregateRegionalKpi(snapshot, definition.id, scope).sourceCount > 0);
  useEffect(() => { const fence = generation; const controller = request; return () => { ++fence.current; controller.current?.abort(); }; }, []);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(0), cooldown * 1000); return () => clearTimeout(timer); }, [cooldown]);
  async function analyze() {
    if (lock.current || !query || !hasSources || cooldown) return;
    lock.current = true; setBusy(true); setValue(null); setError('');
    const run = ++generation.current; const controller = new AbortController(); request.current?.abort(); request.current = controller;
    try {
      const result = await loadRegionalKpiBriefing(query, AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]));
      if (run === generation.current && !controller.signal.aborted) setValue(result);
    } catch (cause) {
      if (run !== generation.current || controller.signal.aborted) return;
      if (cause instanceof RegionalKpiBriefingCooldownError) setCooldown(cause.seconds);
      setError(cause instanceof RegionalKpiBriefingCooldownError ? cause.message : 'Сводка ИИ не получена. Данные KPI доступны без неё.');
      if (cause instanceof RegionalKpiAccessLostError) onAccessLost();
    } finally { if (run === generation.current) { lock.current = false; setBusy(false); } }
  }
  return <section className={styles.ai} aria-label="ИИ по медицинским показателям"><div className={styles.aiHeader}>
    <div><strong><Sparkles size={15} aria-hidden="true" />Кратко о KPI</strong><small>{!query ? 'Выберите одно учреждение для сводки.' : !hasSources ? 'Для сводки нужны исходные записи.' : 'Только выбранный период и доступная территория.'}</small></div>
    <button type="button" className={styles.button} onClick={() => void analyze()} disabled={busy || !query || !hasSources || cooldown > 0}>{busy ? 'Готовим сводку…' : cooldown ? 'Пауза между запросами' : value ? 'Обновить сводку ИИ' : 'Объяснить показатели'}</button>
    {value && <button type="button" className={styles.iconButton} onClick={() => setValue(null)} aria-label="Скрыть сводку KPI"><X size={15} /></button>}
  </div>{busy && <p className={styles.aiStatus} role="status">ИИ анализирует агрегированные показатели из базы…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}{value && <RegionalKpiBriefingContent value={value} />}
  </section>;
}

function periodLabel(period: Period) {
  return `${formatDate.format(new Date(`${period.start}T12:00:00Z`))} — ${formatDate.format(new Date(`${period.end}T12:00:00Z`))}`;
}

function valueLabel(value: number | null) { return value === null ? '—' : formatNumber.format(value); }

function targetLabel(result: KpiResult) {
  return result.effectiveTarget === null ? 'Норматив для периода не задан'
    : `${result.definition.direction === 'lower' ? 'Не более' : 'Не менее'} ${formatNumber.format(result.effectiveTarget)} ${result.definition.unit}`;
}

function formulaLabel(definition: RegionalKpiDefinition) {
  const multiplier = definition.basis === 'ratio_per_1000' ? ' × 1000' : definition.basis === 'percent' ? ' × 100%' : '';
  return `${definition.numeratorLabel} ÷ ${definition.denominatorLabel}${multiplier}`;
}

function IndicatorIcon({ category }: { category: RegionalKpiDefinition['category'] }) {
  const Icon = category === 'resources' ? Users : category === 'laboratory' ? FlaskConical : category === 'operations' ? ClipboardCheck : ShieldCheck;
  return <Icon size={16} aria-hidden="true" />;
}

function Status({ result }: { result: KpiResult }) {
  return <span className={styles.status} data-status={result.status}>{result.incompleteDenominator ? 'Нет данных для знаменателя' : statusLabels[result.status]}</span>;
}

function missingLabel(result: KpiResult) {
  return result.incompleteDenominator ? 'Нет данных для знаменателя' : 'Нет записей для расчёта';
}

function snapshotDateLabel(result: KpiResult) {
  const prefix = result.definition.id === 'doctor-staffing' ? 'Кадровый срез' : 'Срез данных';
  return `${prefix}: ${result.lastObservedAt ? formatSnapshotDate.format(new Date(result.lastObservedAt)) : 'нет данных'}`;
}

function SourceDetails({ result }: { result: KpiResult }) {
  const { definition } = result;
  return <details className={styles.sourceDetails}>
    <summary><ChevronDown size={15} aria-hidden="true" />Как считается · источник и ограничения</summary>
    <dl>
      <div><dt>Формула</dt><dd>{formulaLabel(definition)}</dd></div>
      <div><dt>Основание</dt><dd>{definition.sourceUrl
        ? <a href={definition.sourceUrl} target="_blank" rel="noopener noreferrer">{definition.sourceTitle}<ExternalLink size={13} aria-hidden="true" /></a>
        : definition.sourceTitle}<small>{definition.sourceVersion}</small></dd></div>
      <div><dt>Применяется</dt><dd>{definition.applicableKinds.map(kind => kind === 'hospital' ? 'Больницы' : 'Поликлиники').join(', ')}
        <small>{definition.periodKind === 'snapshot' ? 'Последний сохранённый срез не позднее конца периода.' : 'Записи, относящиеся к выбранному периоду.'}</small></dd></div>
      <div><dt>Ориентир</dt><dd>{targetLabel(result)}
        {result.effectiveTarget === null && definition.target !== null && <small>Сравнение с установленным ориентиром доступно только за полный календарный месяц.</small>}</dd></div>
    </dl>
    <p>{definition.note}</p>
    <p>Общий показатель рассчитан из сумм исходных величин, а не из среднего процентов больниц. Отсутствующие данные не считаются нулём.</p>
  </details>;
}

export function RegionalKpiResults({ snapshot, scope, selectedIndicatorId, group, onGroupChange, tableOpen, filter, onChooseIndicator, onToggleTable, onFilterChange, onSelectFacility, onAccessLost }: {
  snapshot: RegionalKpiSnapshot;
  scope: KpiScope;
  selectedIndicatorId: string | null;
  group: RegionalKpiGroup;
  onGroupChange: (group: RegionalKpiGroup) => void;
  tableOpen: boolean;
  filter: string;
  onChooseIndicator: (id: string) => void;
  onToggleTable: () => void;
  onFilterChange: (value: string) => void;
  onSelectFacility: (id: string) => void;
  onAccessLost: () => void;
}) {
  const tableId = useId();
  const [evidenceFacilityId, setEvidenceFacilityId] = useState<string | null>(null);
  const allResults = useMemo(() => snapshot.definitions.map(definition => aggregateRegionalKpi(snapshot, definition.id, scope))
    .filter(result => result.coverage.eligible > 0), [snapshot, scope]);
  const results = useMemo(() => allResults.filter(result => regionalKpiGroup(result.definition) === group), [allResults, group]);
  const selected = results.find(result => result.definition.id === selectedIndicatorId) ?? results[0];
  const selectedRows = useMemo(() => {
    if (!selected) return [];
    const normalizedFilter = filter.trim().toLocaleLowerCase('ru-RU');
    return snapshot.facilities.filter(facility => (!scope.regionId || facility.regionId === scope.regionId)
      && (!scope.districtId || facility.districtId === scope.districtId)
      && (!scope.facilityId || facility.id === scope.facilityId)
      && selected.definition.applicableKinds.includes(facility.kind)
      && facility.name.toLocaleLowerCase('ru-RU').includes(normalizedFilter))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru-RU'))
      .map(facility => ({ facility, result: aggregateRegionalKpi(snapshot, selected.definition.id, { facilityId: facility.id }) }));
  }, [filter, scope, selected, snapshot]);

  return <>
    <div className={styles.groupFilter} role="group" aria-label="Группа показателей">
      <button type="button" aria-pressed={group === 'medical'} onClick={() => onGroupChange('medical')}>Медицина и ресурсы <span>{allResults.filter(result => regionalKpiGroup(result.definition) === 'medical').length}</span></button>
      <button type="button" aria-pressed={group === 'operations'} onClick={() => onGroupChange('operations')}>Операционная работа <span>{allResults.filter(result => regionalKpiGroup(result.definition) === 'operations').length}</span></button>
    </div>
    {!selected ? <p className={styles.empty}>В этой группе нет применимых показателей для выбранных учреждений.</p> : <>
    <div className={styles.cards} aria-label="Показатели выбранной территории">
      {results.map(result => <button key={result.definition.id} type="button" className={styles.card}
        onClick={() => onChooseIndicator(result.definition.id)} aria-pressed={tableOpen && selected.definition.id === result.definition.id}
        aria-controls={tableId} aria-label={`${result.definition.title}: ${valueLabel(result.value)}${result.value === null ? '' : ` ${result.definition.unit}`}. Таблица учреждений`}>
        <span className={styles.cardTitle}><IndicatorIcon category={result.definition.category} />{result.definition.title}</span>
        <span className={styles.cardValue}><strong>{valueLabel(result.value)}</strong><span>{result.definition.unit}</span></span>
        <span className={styles.cardTarget}>{result.value === null ? missingLabel(result) : targetLabel(result)}</span>
        {result.definition.periodKind === 'snapshot' && <span className={styles.snapshotDate}>{snapshotDateLabel(result)}</span>}
        <span className={styles.cardFoot}><span>{result.definition.sourceType === 'official' ? 'Методика МЗ РК' : 'Внутренний показатель'}</span>
          <span>Данные: {result.coverage.reporting}/{result.coverage.eligible}</span></span>
      </button>)}
    </div>
    <div className={styles.resultsBar}>
      <span>Данные — число учреждений с записями для расчёта. Показатели не складываются в общий балл.</span>
      <button type="button" className={styles.textButton} onClick={onToggleTable} aria-expanded={tableOpen} aria-controls={tableId}>
        <Table2 size={16} aria-hidden="true" />{tableOpen ? 'Скрыть таблицу' : 'Таблица по учреждениям'}
      </button>
    </div>
    {tableOpen && <div id={tableId} className={styles.tableSection}>
      <div className={styles.tableHeader}>
        <div><h3>{selected.definition.title}</h3><p>{periodLabel(snapshot.period)} · {selected.definition.applicableKinds.map(kind => kind === 'hospital' ? 'больницы' : 'поликлиники').join(', ')}</p></div>
        <label className={styles.search}><Search size={16} aria-hidden="true" /><input type="search" aria-label="Поиск учреждения в таблице KPI" placeholder="Найти учреждение" value={filter} onChange={event => onFilterChange(event.target.value)} maxLength={120} /></label>
      </div>
      <div className={styles.coverageLine}>
        <span>Есть данные <strong>{selected.coverage.reporting} из {selected.coverage.eligible}</strong></span>
        {selected.coverage.missing > 0 && <span>Нет данных <strong>{selected.coverage.missing}</strong></span>}
        <span>Итог по доступным записям <strong>{valueLabel(selected.value)} {selected.value === null ? '' : selected.definition.unit}</strong></span>
      </div>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`Таблица: ${selected.definition.title}`}>
        <table>
          <caption className={styles.visuallyHidden}>Учреждения отсортированы по названию, не по оценке качества. {selected.definition.title}.</caption>
          <thead><tr><th scope="col">Учреждение</th><th scope="col">Факт</th><th scope="col">Ориентир</th><th scope="col">Исходные данные</th><th scope="col">Состояние</th></tr></thead>
          <tbody>{selectedRows.map(({ facility, result }) => <tr key={facility.id}>
            <th scope="row"><button type="button" className={styles.facilityButton} onClick={() => onSelectFacility(facility.id)}
              aria-label={`Выбрать учреждение: ${facility.name}`}>{facility.name}<ArrowUpRight size={15} aria-hidden="true" /></button>
              <small>{facility.kind === 'hospital' ? 'Больница' : 'Поликлиника'}</small></th>
            <td className={styles.numeric}><strong>{valueLabel(result.value)}</strong>{result.value !== null && <small>{selected.definition.unit}</small>}
              {result.definition.periodKind === 'snapshot' && <small>{snapshotDateLabel(result)}</small>}</td>
            <td>{targetLabel(result)}</td>
            <td>{result.sourceCount === 0 ? missingLabel(result) : <><span>{valueLabel(result.numerator)} / {valueLabel(result.denominator)}</span><small>{formatNumber.format(result.sourceCount)} исходных записей</small>
              <button type="button" className={styles.evidenceButton} onClick={() => setEvidenceFacilityId(facility.id)} aria-label={`Записи расчёта: ${facility.name}`}>Записи расчёта</button></>}</td>
            <td><Status result={result} /></td>
          </tr>)}</tbody>
        </table>
        {selectedRows.length === 0 && <p className={styles.empty}>{filter.trim() ? 'По этому названию учреждений не найдено.' : 'В выбранной территории нет учреждений этого профиля.'}</p>}
      </div>
      {evidenceFacilityId && selectedRows.some(row => row.facility.id === evidenceFacilityId) && <RegionalKpiEvidencePanel
        key={`${selected.definition.id}:${evidenceFacilityId}`} period={snapshot.period} facilityId={evidenceFacilityId}
        facilityName={snapshot.facilities.find(row => row.id === evidenceFacilityId)!.name} indicatorId={selected.definition.id}
        onAccessLost={onAccessLost} onClose={() => setEvidenceFacilityId(null)} />}
      <SourceDetails result={selected} />
    </div>}
    </>}
  </>;
}

function RegionalKpiEvidencePanel({ period, facilityId, facilityName, indicatorId, onAccessLost, onClose }: {
  period: Period; facilityId: string; facilityName: string; indicatorId: string;
  onAccessLost: () => void; onClose: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{ key: string; data: RegionalKpiEvidence | null; error: string } | null>(null);
  const generation = useRef(0);
  const accessLost = useEffectEvent(onAccessLost);
  const requestKey = JSON.stringify([period.start, period.end, facilityId, indicatorId, offset, retry]);
  const active = response?.key === requestKey ? response : null;
  const headingId = useId();
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    const run = ++generation.current;
    let retired = false;
    void Promise.resolve().then(() => loadRegionalKpiEvidence(regionalKpiEvidenceQuerySchema.parse({ start: period.start, end: period.end, facilityId, indicatorId, offset }), signal))
      .then(data => {
        if (!retired && !signal.aborted && generation.current === run) setResponse({ key: requestKey, data, error: '' });
      }).catch(cause => {
        if (retired || controller.signal.aborted || generation.current !== run) return;
        setResponse({ key: requestKey, data: null, error: cause instanceof RegionalKpiAccessLostError ? cause.message : 'Записи расчёта не загрузились. Повторите запрос.' });
        if (cause instanceof RegionalKpiAccessLostError) accessLost();
      });
    return () => { retired = true; controller.abort(); };
  }, [requestKey, period.start, period.end, facilityId, indicatorId, offset]);
  return <section className={styles.evidence} aria-labelledby={headingId}>
    <div className={styles.tableHeader}><div><h4 id={headingId}>Записи расчёта · {facilityName}</h4>
      <p>Только основания показателя: без ФИО, ИИН и медицинских текстов.</p></div>
      <button className={styles.textButton} type="button" onClick={onClose}>Закрыть записи</button></div>
    {!active ? <p role="status">Загружаем исходные записи…</p> : active.error ? <div role="alert"><p>{active.error}</p>
      <button type="button" className={styles.button} onClick={() => setRetry(value => value + 1)}>Повторить загрузку записей</button></div>
      : active.data && <>
        <p className={styles.evidenceCount}>{active.data.total === 0 ? 'Записей за выбранный период нет.'
          : active.data.items.length === 0 ? 'На этой странице больше нет записей. Вернитесь к предыдущим записям.'
            : `${active.data.offset + 1}–${active.data.offset + active.data.items.length} из ${formatNumber.format(active.data.total)}`}</p>
        <ol className={styles.evidenceList} tabIndex={0} aria-label="Исходные записи расчёта">{active.data.items.map(item => <li key={item.id}>
          <div><strong>{item.label}</strong><small>{evidenceKindLabels[item.kind]} · {item.id}</small></div>
          <time dateTime={item.observedAt}>{formatUpdated.format(new Date(item.observedAt))}</time>
          {item.value !== null && <span>{valueLabel(item.value)} {item.unit}</span>}
        </li>)}</ol>
        {active.data.nextOffset === null && active.data.offset + active.data.items.length < active.data.total
          && <p className={styles.evidenceCount}>Достигнут предел просмотра записей. Сузьте отчётный период, чтобы посмотреть оставшиеся основания.</p>}
        {(offset > 0 || active.data.nextOffset !== null) && <div className={styles.evidencePagination}>
          <button type="button" className={styles.button} onClick={() => setOffset(value => Math.max(0, value - 20))} disabled={offset === 0}>Предыдущие записи</button>
          <button type="button" className={styles.button} onClick={() => setOffset(active.data!.nextOffset!)} disabled={active.data.nextOffset === null}>Следующие записи</button>
        </div>}
      </>}
  </section>;
}

/** A changed authority key destroys old view state even before a new fetch effect. */
export function RegionalKpiPanel(props: RegionalKpiPanelProps) {
  return <RegionalKpiPanelSession key={props.scopeKey} {...props} />;
}

function RegionalKpiPanelSession({ scopeKey, canViewRegion, districtId, facilityId, scopeLabel, onAccessLost, onSelectFacility }: RegionalKpiPanelProps) {
  const [period, setPeriod] = useState<Period>(() => lastCompletedKpiMonth(new Date()));
  const [draft, setDraft] = useState(period);
  const [periodError, setPeriodError] = useState('');
  const [reload, setReload] = useState(0);
  const [group, setGroup] = useState<RegionalKpiGroup>('medical');
  const [selectedIndicators, setSelectedIndicators] = useState<Partial<Record<RegionalKpiGroup, string>>>({});
  const selectedIndicatorId = selectedIndicators[group] ?? null;
  const [tableOpen, setTableOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [responseState, setResponseState] = useState<{ key: string; snapshot: RegionalKpiSnapshot | null; error: string } | null>(null);
  const generation = useRef(0);
  const accessLost = useEffectEvent(onAccessLost);
  const requestKey = JSON.stringify([scopeKey, facilityId ?? null, period.start, period.end, reload]);
  const scope = useMemo(() => regionalKpiPanelScope({ canViewRegion, districtId, facilityId }), [canViewRegion, districtId, facilityId]);
  // Checking the request key during render avoids a frame of old figures under
  // new dates or a newly selected hospital before effect cleanup has happened.
  const activeResponse = responseState?.key === requestKey ? responseState : null;
  const snapshot = activeResponse?.snapshot ?? null;
  const loading = activeResponse === null;
  const errorId = useId();
  const headingId = useId();
  const defaultLabel = facilityId ? snapshot?.facilities.find(facility => facility.id === facilityId)?.name ?? 'Выбранное учреждение'
    : districtId ? 'Выбранная территория' : canViewRegion ? 'Туркестанская область' : 'Мои учреждения';

  useEffect(() => {
    const run = ++generation.current;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    let retired = false;
    void loadRegionalKpi({ start: period.start, end: period.end, ...(facilityId ? { facilityId } : {}) }, signal).then(value => {
      if (retired || signal.aborted || run !== generation.current) return;
      setResponseState({ key: requestKey, snapshot: value, error: '' });
    }).catch(cause => {
      if (retired || controller.signal.aborted || run !== generation.current) return;
      setResponseState({ key: requestKey, snapshot: null, error: cause instanceof RegionalKpiAccessLostError ? cause.message
        : signal.aborted ? 'Загрузка заняла слишком много времени. Повторите запрос.' : 'Показатели временно недоступны. Повторите запрос.' });
      if (cause instanceof RegionalKpiAccessLostError) accessLost();
    });
    return () => { retired = true; controller.abort(); };
  }, [requestKey, period.start, period.end, facilityId]);

  function applyPeriod(event: FormEvent) {
    event.preventDefault();
    const parsed = regionalKpiQuerySchema.safeParse(draft);
    if (!parsed.success) { setPeriodError('Выберите корректные даты: начало не позже конца, период — не более 366 дней.'); return; }
    setPeriodError('');
    if (parsed.data.start === period.start && parsed.data.end === period.end) setReload(value => value + 1);
    else setPeriod({ start: parsed.data.start, end: parsed.data.end });
  }
  function choosePeriod(next: Period) {
    setDraft(next); setPeriodError('');
    if (next.start === period.start && next.end === period.end) setReload(value => value + 1);
    else setPeriod(next);
  }
  const currentMonth = currentKpiMonth(new Date());
  const previousMonth = lastCompletedKpiMonth(new Date());

  return <section className={styles.panel} aria-labelledby={headingId}>
    <header className={styles.header}>
      <div className={styles.title}><h2 id={headingId}>Показатели учреждений</h2><p>{scopeLabel ?? defaultLabel}<span aria-hidden="true"> · </span><span>Учебная БД</span></p></div>
      <form className={styles.periodForm} onSubmit={applyPeriod} aria-label="Отчётный период KPI">
        <CalendarDays size={17} aria-hidden="true" />
        <label>С<input type="date" required value={draft.start} onChange={event => { setDraft(previous => ({ ...previous, start: event.target.value })); setPeriodError(''); }} aria-label="Начало отчётного периода" aria-describedby={periodError ? errorId : undefined} aria-invalid={Boolean(periodError)} /></label>
        <label>По<input type="date" required value={draft.end} onChange={event => { setDraft(previous => ({ ...previous, end: event.target.value })); setPeriodError(''); }} aria-label="Конец отчётного периода включительно" aria-describedby={periodError ? errorId : undefined} aria-invalid={Boolean(periodError)} /></label>
        <button type="submit" className={styles.button}>Показать</button>
        <button type="button" className={styles.iconButton} onClick={() => setReload(value => value + 1)} aria-label="Обновить показатели" disabled={loading}><RefreshCw size={16} aria-hidden="true" /></button>
      </form>
    </header>
    <div className={styles.periodShortcuts} role="group" aria-label="Быстрый выбор периода">
      <button type="button" aria-pressed={period.start === currentMonth.start && period.end === currentMonth.end} onClick={() => choosePeriod(currentMonth)}>Текущий месяц · по сегодня</button>
      <button type="button" aria-pressed={period.start === previousMonth.start && period.end === previousMonth.end} onClick={() => choosePeriod(previousMonth)}>Прошлый месяц</button>
    </div>
    {periodError && <p className={styles.error} id={errorId} role="alert">{periodError}</p>}
    <div className={styles.periodLine}><span>{periodLabel(period)} · по времени Казахстана</span>
      {snapshot && <span>Обновлено {formatUpdated.format(new Date(snapshot.generatedAt))}</span>}</div>
    {loading ? <div className={styles.loading} role="status"><span className={styles.loadingDot} aria-hidden="true" />Загружаем показатели из базы…</div>
      : activeResponse?.error ? <div className={styles.errorState} role="alert"><p>{activeResponse.error}</p><button type="button" className={styles.button} onClick={() => setReload(value => value + 1)}>Повторить</button></div>
        : snapshot && <><RegionalKpiResults key={JSON.stringify([requestKey, scope, group, selectedIndicatorId])} snapshot={snapshot} scope={scope} group={group} onGroupChange={setGroup} selectedIndicatorId={selectedIndicatorId} tableOpen={tableOpen} filter={filter}
          onChooseIndicator={id => { setSelectedIndicators(previous => ({ ...previous, [group]: id })); setTableOpen(true); }} onToggleTable={() => setTableOpen(value => !value)} onFilterChange={setFilter} onSelectFacility={onSelectFacility} onAccessLost={onAccessLost} />
          <RegionalKpiAiBriefing key={JSON.stringify([requestKey, scope, canViewRegion])} snapshot={snapshot} scope={scope} canViewRegion={canViewRegion} onAccessLost={onAccessLost} /></>}
  </section>;
}

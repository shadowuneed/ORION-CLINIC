import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RegionalMetrics } from './regional-metrics';
import { regionalMetricsSchema } from '@/lib/regional/contracts';

const metrics = regionalMetricsSchema.parse({ hospitalCount: 1, polyclinicCount: 2, patientCount: 18, activeVisits: 7,
  queuedVisits: 3, openTasks: 9, overdueTasks: 2, completedTasks: 4, totalTasks: 13, onTimeTasks: 3, dueTasks: 5, kpiPercent: 60 });
describe('territory summary', () => {
  it('groups actual saved counts and states the KPI denominator, without fictitious trends', () => {
    const html = renderToStaticMarkup(createElement(RegionalMetrics, { metrics, name: 'Туркестан', level: 'Город' }));
    for (const text of ['Сводка: Туркестан', 'Медицинская сеть', 'Пациенты и приёмы', 'Работа команды', '60% выполнены вовремя', '3 из 5 задач', '2 просрочено', 'Не оценка качества лечения']) expect(html).toContain(text);
    expect(html).not.toContain('рост'); expect(html).not.toContain('по сравнению');
  });
  it('distinguishes no KPI data from a real 0% and escapes scope titles', () => {
    const absent = renderToStaticMarkup(createElement(RegionalMetrics, { metrics: { ...metrics, kpiPercent: null, dueTasks: 0 }, name: '<script>', level: 'Район' }));
    expect(absent).toContain('Пока нет расчёта'); expect(absent).not.toContain('0% выполнены'); expect(absent).toContain('&lt;script&gt;');
    const zero = renderToStaticMarkup(createElement(RegionalMetrics, { metrics: { ...metrics, kpiPercent: 0, onTimeTasks: 0 }, name: 'Район', level: 'Район' }));
    expect(zero).toContain('0% выполнены вовремя'); expect(zero).not.toContain('Пока нет расчёта');
  });
});

import type { CSSProperties } from 'react';
import { Activity, Building2, CheckCheck, ClipboardCheck, Hospital, Users } from 'lucide-react';
import type { RegionalOverview } from '@/lib/regional/contracts';
import styles from './regional-workspace.module.css';

const plural = new Intl.PluralRules('ru-RU');
const noun = (value: number, one: string, few: string, many: string) => ({ one, few, many, other: many, zero: many, two: few })[plural.select(value)];
/** All numbers are scoped server aggregates; no illustrative trend or target. */
export function RegionalMetrics({ metrics, name, level }: {
  metrics: RegionalOverview['totals']; name: string; level: string;
}) {
  const number = (value: number) => value.toLocaleString('ru-RU');
  const kpi = metrics.kpiPercent;
  return <section className={styles.summary} aria-label={`Сводка: ${name}`}>
    <div className={styles.summaryHeading}><span>{level} <span aria-hidden="true">/</span> <strong>{name}</strong></span><small>По записям в базе</small></div>
    <div className={styles.summaryCards}>
      <article className={styles.summaryCard}>
        <div className={styles.summaryLabel}><Building2 size={17} />Медицинская сеть</div>
        <div className={styles.summaryValue}><strong>{number(metrics.hospitalCount + metrics.polyclinicCount)}</strong><span>{noun(metrics.hospitalCount + metrics.polyclinicCount, 'учреждение', 'учреждения', 'учреждений')}</span></div>
        <div className={styles.summarySplit}><span><Hospital size={13} /><b>{number(metrics.hospitalCount)}</b> {noun(metrics.hospitalCount, 'больница', 'больницы', 'больниц')}</span><span><Building2 size={13} /><b>{number(metrics.polyclinicCount)}</b> {noun(metrics.polyclinicCount, 'поликлиника', 'поликлиники', 'поликлиник')}</span></div>
      </article>
      <article className={styles.summaryCard}>
        <div className={styles.summaryLabel}><Users size={17} />Пациенты и приёмы</div>
        <div className={styles.summaryValue}><strong>{number(metrics.patientCount)}</strong><span>{noun(metrics.patientCount, 'карта пациента', 'карты пациентов', 'карт пациентов')}</span></div>
        <div className={styles.summarySplit}><span><Activity size={13} /><b>{number(metrics.activeVisits)}</b> {noun(metrics.activeVisits, 'активный визит', 'активных визита', 'активных визитов')}</span><span className={metrics.queuedVisits ? styles.summaryAttention : undefined}><b>{number(metrics.queuedVisits)}</b> в очереди</span></div>
      </article>
      <article className={styles.summaryCard} data-attention={metrics.overdueTasks > 0}>
        <div className={styles.summaryLabel}><ClipboardCheck size={17} />Работа команды</div>
        <div className={styles.summaryValue}><strong>{number(metrics.openTasks)}</strong><span>{noun(metrics.openTasks, 'открытая задача', 'открытые задачи', 'открытых задач')}</span></div>
        <div className={styles.summarySplit}><span className={metrics.overdueTasks ? styles.summaryAttention : undefined}><i />{metrics.overdueTasks ? `${number(metrics.overdueTasks)} просрочено` : 'Без просроченных задач'}</span><span><CheckCheck size={13} />{number(metrics.completedTasks)} выполнено</span></div>
      </article>
      <article className={`${styles.summaryCard} ${styles.summaryKpi}`}>
        <div className={styles.kpiRing} data-empty={kpi === null} style={{ '--kpi-angle': `${(kpi ?? 0) * 3.6}deg` } as CSSProperties} aria-hidden="true"><strong>{kpi === null ? '—' : `${Math.round(kpi)}%`}</strong></div>
        <div><div className={styles.summaryLabel}>KPI · задачи в срок</div><strong className={styles.kpiCaption}>{kpi === null ? 'Пока нет расчёта' : `${Math.round(kpi)}% выполнены вовремя`}</strong><p>{kpi === null ? 'Нет задач с наступившим сроком' : `${number(metrics.onTimeTasks)} из ${number(metrics.dueTasks)} задач с наступившим сроком`}</p><small>Не оценка качества лечения</small></div>
      </article>
    </div>
  </section>;
}

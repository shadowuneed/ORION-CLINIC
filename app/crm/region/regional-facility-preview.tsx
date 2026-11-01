'use client';

import { ArrowRight, Building2, ClipboardCheck, Clock3, Hospital, Users, X } from 'lucide-react';
import type { RegionalFacility, RegionalScope } from '@/lib/regional/contracts';
import styles from './regional-workspace.module.css';

export type FacilityPreviewProps = {
  facility: RegionalFacility | RegionalScope['facilities'][number];
  districtName?: string;
  disabled: boolean;
  onEnter: () => void;
  onClose: () => void;
  onIndicators: () => void;
};

/** One entry point shared by map and directory selection; never fetches patient records. */
export function RegionalFacilityPreview({ facility, districtName, disabled, onEnter, onClose, onIndicators }: FacilityPreviewProps) {
  const hospital = facility.kind === 'hospital';
  const metrics = 'patientCount' in facility ? facility : null;
  return <section className={styles.facilityPreview} aria-label="Краткая сводка учреждения">
    <div className={styles.previewHeading}>
      <span className={styles.previewIcon}>{hospital ? <Hospital size={26} /> : <Building2 size={26} />}</span>
      <span className={styles.eyebrow}>{hospital ? 'БОЛЬНИЦА' : 'ПОЛИКЛИНИКА'} · ВЫБРАНО</span>
      <button type="button" className={styles.closePreview} disabled={disabled} onClick={onClose} aria-label="Закрыть сводку учреждения"><X size={17} /></button>
    </div>
    <h2>{facility.name}</h2>
    {districtName && <p className={styles.previewDistrict}>{districtName}</p>}
    <button type="button" className={styles.enterFacility} disabled={disabled} onClick={onEnter}>
      {hospital ? 'Войти в больницу' : 'Войти в поликлинику'} <ArrowRight size={18} />
    </button>
    <p className={styles.previewHint}>Кабинеты, пациенты и работа учреждения</p>
    {metrics && <dl className={styles.previewMetrics}>
      <div><dt><Users size={14} />Пациенты</dt><dd>{metrics.patientCount}</dd></div>
      <div><dt><Clock3 size={14} />В очереди</dt><dd>{metrics.queuedVisits}</dd></div>
      <div><dt><Hospital size={14} />Активные визиты</dt><dd>{metrics.activeVisits}</dd></div>
      <div data-attention={metrics.overdueTasks > 0}><dt><ClipboardCheck size={14} />Открытые задачи</dt><dd>{metrics.openTasks}</dd></div>
    </dl>}
    <button type="button" className={styles.previewKpi} disabled={disabled} onClick={onIndicators}>Показатели и отчёты <ArrowRight size={14} /></button>
  </section>;
}

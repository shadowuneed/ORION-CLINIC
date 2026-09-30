'use client';

import Link from 'next/link';
import { Activity, ArrowUpRight, Clock3, HeartPulse, Ruler, Scale, Stethoscope, Thermometer, UserRound } from 'lucide-react';
import { useState } from 'react';
import type { LatestPatientVitals } from '@/lib/repositories/patient-observations';
import type { PatientDetail } from '@/lib/repositories/patient-registry';
import styles from '../patients.module.css';

type MeasurementGroup = keyof LatestPatientVitals;
export type PatientVitalsState = {
  state: 'loading' | 'ready' | 'unavailable';
  value: LatestPatientVitals | null;
};

const labels = { anthropometry: 'Рост, вес и ИМТ', bloodPressure: 'Артериальное давление', temperature: 'Температура' };
const formatNumber = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const formatDate = (value: number) => new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

export function PatientVitalsPanel({ measurement, patient, measurementsUrl, encounterUrl, encounterStatus }: {
  measurement: PatientVitalsState;
  patient: PatientDetail;
  measurementsUrl: string;
  encounterUrl: string | null;
  encounterStatus: string | null;
}) {
  const [chosenGroup, setChosenGroup] = useState<MeasurementGroup | null>(null);
  const vitals = measurement.state === 'ready' ? measurement.value : null;
  const entries = vitals ? Object.entries(vitals).filter((entry) => entry[1] !== null) : [];
  const latestGroup = entries.sort((a, b) => b[1]!.measuredAt - a[1]!.measuredAt)[0]?.[0] as MeasurementGroup | undefined;
  const selectedGroup = chosenGroup && vitals?.[chosenGroup] ? chosenGroup : latestGroup ?? null;
  const selected = selectedGroup && vitals ? vitals[selectedGroup] : null;
  const anthropometry = vitals?.anthropometry;
  const pressure = vitals?.bloodPressure;
  const temperature = vitals?.temperature;
  const latestEncounter = patient.latestEncounter;
  const loading = measurement.state === 'loading';
  // Choose only from the recorded field; never infer sex from a name or vitals.
  const bodyIllustration = patient.sexAtBirth === 'female'
    ? { src: '/patient-body/anatomy-female-v1.png', alt: 'Женская анатомическая схема — иллюстрация' }
    : { src: '/patient-body/anatomy-v1.png', alt: patient.sexAtBirth === 'male'
      ? 'Мужская анатомическая схема — иллюстрация'
      : 'Общая анатомическая схема — пол не указан' };
  const missing = loading ? 'Загружаем…' : measurement.state === 'unavailable' ? 'Нет доступа к измерениям' : 'Не записано';

  return <section className={styles.patientVitals} aria-labelledby="patient-vitals-title">
    <div className={styles.bodyMap}>
      <div className={styles.bodyMapHeader}><Activity size={15} aria-hidden="true" /><span>Карта показателей</span></div>
      <div className={styles.bodyMapCanvas}>
        {/* Illustrative anatomy, not an individual scan. Only callouts contain measurements. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.bodyMapImage} src={bodyIllustration.src} alt={bodyIllustration.alt} width="1024" height="1536" />
        <span className={styles.bodyMapAxis} aria-hidden="true" />
        {temperature && <button className={`${styles.bodyCallout} ${styles.bodyTemperature}`} type="button"
          aria-pressed={selectedGroup === 'temperature'} onClick={() => setChosenGroup('temperature')}>
          <Thermometer size={14} aria-hidden="true" /><span><small>Температура</small><strong>{formatNumber(temperature.temperatureC)} °C</strong></span>
        </button>}
        {pressure && <button className={`${styles.bodyCallout} ${styles.bodyPressure}`} type="button"
          aria-pressed={selectedGroup === 'bloodPressure'} onClick={() => setChosenGroup('bloodPressure')}>
          <HeartPulse size={14} aria-hidden="true" /><span><small>Давление</small><strong>{pressure.systolicMmhg}/{pressure.diastolicMmhg}</strong></span>
        </button>}
        {anthropometry && <button className={`${styles.bodyCallout} ${styles.bodyWeight}`} type="button"
          aria-pressed={selectedGroup === 'anthropometry'} onClick={() => setChosenGroup('anthropometry')}>
          <Scale size={14} aria-hidden="true" /><span><small>Вес</small><strong>{formatNumber(anthropometry.weightKg)} кг</strong></span>
        </button>}
        {anthropometry && <span className={styles.bodyHeight}><Ruler size={13} aria-hidden="true" />{formatNumber(anthropometry.heightCm)} см</span>}
      </div>
      <span className={styles.bodyMapCaption}>Иллюстративная схема · показатели из записей</span>
    </div>

    <div className={styles.vitalsContent}>
      <header className={styles.vitalsHeader}>
        <div><span className={styles.eyebrow}>Клинический обзор</span><h2 id="patient-vitals-title">Показатели пациента</h2></div>
        {measurement.state === 'ready' && <Link className={styles.vitalsOpen} href={measurementsUrl}>Все измерения<ArrowUpRight size={16} aria-hidden="true" /></Link>}
      </header>

      <div className={styles.vitalPair}>
        <button type="button" className={styles.vitalTile} disabled={!pressure} aria-pressed={selectedGroup === 'bloodPressure'} onClick={() => setChosenGroup('bloodPressure')}>
          <span className={styles.vitalLabel}><HeartPulse size={17} aria-hidden="true" />Давление</span>
          <span className={styles.vitalValue}>{pressure ? `${pressure.systolicMmhg}/${pressure.diastolicMmhg}` : '—'}{pressure && <small>мм рт. ст.</small>}</span>
          <span className={styles.vitalTime}>{pressure ? formatDate(pressure.measuredAt) : missing}</span>
        </button>
        <button type="button" className={styles.vitalTile} disabled={!temperature} aria-pressed={selectedGroup === 'temperature'} onClick={() => setChosenGroup('temperature')}>
          <span className={styles.vitalLabel}><Thermometer size={17} aria-hidden="true" />Температура</span>
          <span className={styles.vitalValue}>{temperature ? formatNumber(temperature.temperatureC) : '—'}{temperature && <small>°C</small>}</span>
          <span className={styles.vitalTime}>{temperature ? formatDate(temperature.measuredAt) : missing}</span>
        </button>
      </div>
      <div className={styles.vitalTriple}>
        {[
          { key: 'height', label: 'Рост', value: anthropometry?.heightCm, unit: 'см', icon: Ruler },
          { key: 'weight', label: 'Вес', value: anthropometry?.weightKg, unit: 'кг', icon: Scale },
          { key: 'bmi', label: 'ИМТ', value: anthropometry?.bmi, unit: 'кг/м²', icon: UserRound },
        ].map(({ key, label, value, unit, icon: Icon }) => <button key={key} type="button" className={styles.vitalTile}
          disabled={value === null || value === undefined} aria-pressed={selectedGroup === 'anthropometry'} onClick={() => setChosenGroup('anthropometry')}>
          <span className={styles.vitalLabel}><Icon size={16} aria-hidden="true" />{label}</span>
          <span className={styles.vitalValue}>{value !== null && value !== undefined ? formatNumber(value) : '—'}{value !== null && value !== undefined && <small>{unit}</small>}</span>
          <span className={styles.vitalTime}>{anthropometry ? formatDate(anthropometry.measuredAt) : missing}</span>
        </button>)}
      </div>

      <div className={styles.vitalProvenance} aria-live="polite">
        {selected && selectedGroup ? <><Clock3 size={16} aria-hidden="true" /><div><strong>{labels[selectedGroup]}</strong><span>Измерено {formatDate(selected.measuredAt)} · {selected.recordedBy}</span></div></>
          : <><Activity size={16} aria-hidden="true" /><div><strong>{loading ? 'Загружаем измерения' : measurement.state === 'unavailable' ? 'Измерения недоступны' : 'Измерений пока нет'}</strong><span>{loading ? 'Получаем последние сохранённые значения.' : measurement.state === 'unavailable' ? 'Для этого рабочего доступа показатели не получены.' : 'Записанные показатели появятся на карте тела и в обзоре.'}</span></div></>}
      </div>

      <div className={styles.patientCurrentEncounter}>
        <span className={styles.encounterContextIcon}><Stethoscope size={19} aria-hidden="true" /></span>
        <div><span className={styles.encounterContextLabel}>Последний приём{encounterStatus && <b>{encounterStatus}</b>}</span><strong>{latestEncounter?.reasonForVisit ?? (latestEncounter ? 'Причина обращения не указана' : 'Приёмов пока нет')}</strong>
          {latestEncounter && <small>Обновлён {formatDate(latestEncounter.updatedAt)}</small>}</div>
        {encounterUrl && <Link href={encounterUrl} aria-label="Открыть последний приём" className={styles.encounterContextLink}><ArrowUpRight size={20} aria-hidden="true" /></Link>}
      </div>
    </div>
  </section>;
}

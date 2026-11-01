'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Map as MapIcon, RotateCcw } from 'lucide-react';
import type { RegionalDistrict, RegionalFacility } from '@/lib/regional/contracts';
import { REGIONAL_GEOJSON_URL, type RegionalFeature, type RegionalFeatureCollection } from '@/lib/regional/geography';
import { RegionalMap3d } from './regional-map-3d';
import styles from './regional-map.module.css';

export type RegionalMapProps = {
  districts: readonly RegionalDistrict[];
  facilities: readonly RegionalFacility[];
  selectedDistrictId: string | null;
  selectedFacilityId?: string | null;
  /** Summary selection does not request the building-entry camera animation. */
  previewFacilityId?: string | null;
  onSelectDistrict: (id: string | null) => void;
  onOpenFacility: (id: string) => void;
  onFacilityFocusComplete?: (id: string, anchor?: { clientX: number; clientY: number }) => void;
  onFacilityFocusCancel?: (id: string) => void;
  /** Preserve the camera behind the interior while stopping all hidden GPU work. */
  active?: boolean;
};
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function RegionalMap(props: RegionalMapProps) {
  const [features, setFeatures] = useState<RegionalFeature[] | null>(null);
  const [geographyFailed, setGeographyFailed] = useState(false);
  const [geographyAttempt, setGeographyAttempt] = useState(0);
  const [webglFailed, setWebglFailed] = useState(false);
  const [webglAttempt, setWebglAttempt] = useState(0);
  const fallbackCompleted = useRef<string | null>(null);
  const { selectedFacilityId, active, onFacilityFocusComplete } = props;
  const failWebgl = useCallback(() => setWebglFailed(true), []);
  useEffect(() => {
    const abort = new AbortController();
    fetch(REGIONAL_GEOJSON_URL, { signal: abort.signal, credentials: 'same-origin', cache: 'force-cache' }).then(async response => {
      if (!response.ok) throw new Error('geography-unavailable');
      const collection = await response.json() as RegionalFeatureCollection;
      if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features) || !collection.features.length) throw new Error('invalid-geography');
      if (!abort.signal.aborted) { setFeatures(collection.features); setGeographyFailed(false); }
    }).catch(() => { if (!abort.signal.aborted) setGeographyFailed(true); });
    return () => abort.abort();
  }, [geographyAttempt]);
  useEffect(() => {
    // An unsupported GPU must not prevent navigation to authorized data via the adjacent list.
    if ((!webglFailed && !geographyFailed) || !selectedFacilityId) { fallbackCompleted.current = null; return; }
    if (active !== false && fallbackCompleted.current !== selectedFacilityId) {
      fallbackCompleted.current = selectedFacilityId; onFacilityFocusComplete?.(selectedFacilityId);
    }
  }, [webglFailed, geographyFailed, selectedFacilityId, active, onFacilityFocusComplete]);
  const selected = props.districts.find(district => district.id === props.selectedDistrictId);
  const availableFacilities = props.facilities.filter(facility => facility.districtId === props.selectedDistrictId);
  return <section className={styles.map} aria-label="Трёхмерная региональная карта медицинской сети">
    <div className={styles.heading}>
      <div><h2 className={styles.title}>{selected ? <><span className={styles.selectedDot} />{selected.name}</> : 'Карта медицинской сети'}</h2>
        <p className={styles.subline}>{selected ? `Учреждений: ${selected.hospitalCount + selected.polyclinicCount} · Пациентов: ${number.format(selected.patientCount)}`
          : 'Туркестанская область · Шымкент учитывается отдельно'}</p>
      </div>
      <span className={styles.modeBadge}>3D · {selected ? 'Выберите здание' : 'Выберите район'}</span>
    </div>
    {features && !webglFailed ? <RegionalMap3d key={webglAttempt} {...props} features={features} onFallback={failWebgl} />
      : <div className={styles.placeholder} role="status"><MapIcon size={38} strokeWidth={1} />
        <p>{webglFailed ? 'Браузер не смог запустить 3D. Проверьте аппаратное ускорение и повторите попытку. Данные и переходы в организации доступны ниже и в списке рядом.'
          : geographyFailed ? 'Географические границы не загрузились. Данные медицинской сети доступны в списке рядом.' : 'Загружаем географические границы…'}</p>
        {(geographyFailed || webglFailed) && <button className={styles.back} type="button" onClick={() => {
          if (geographyFailed) { setGeographyFailed(false); setGeographyAttempt(value => value + 1); }
          setWebglFailed(false); setWebglAttempt(value => value + 1);
        }}><RotateCcw size={15} />Повторить 3D</button>}
        {(geographyFailed || webglFailed) && <div className={styles.mapNavigation}>
          <label>Территория<select value={props.selectedDistrictId ?? ''} onChange={event => props.onSelectDistrict(event.target.value || null)}>
            <option value="">Вся область и Шымкент</option>{props.districts.map(district => <option key={district.id} value={district.id}>{district.name}</option>)}
          </select></label>
          {props.selectedDistrictId && <label>Организация<select value={props.selectedFacilityId ?? props.previewFacilityId ?? ''} onChange={event => { if (event.target.value) props.onOpenFacility(event.target.value); }}>
            <option value="">Выбрать организацию</option>{availableFacilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
          </select></label>}
        </div>}
      </div>}
  </section>;
}

'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Building2, ChevronDown, Hospital, Layers3, LocateFixed, Minus, Plus, RotateCcw, RotateCw } from 'lucide-react';
import { REGIONAL_ATTRIBUTION, REGIONAL_ATTRIBUTION_URL, regionalPolygons, type RegionalFeature } from '@/lib/regional/geography';
import { placeRegionalLabels, projectRegionalPosition, regionalBounds } from '@/lib/regional/map-camera';
import type { RegionalMapProps } from './regional-map';
import type { Regional3dController, Regional3dFrame } from './regional-webgl-renderer';
import styles from './regional-map.module.css';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export function RegionalMap3d(props: RegionalMapProps & { features: readonly RegionalFeature[]; onFallback: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<Regional3dController | null>(null);
  const latest = useRef(props);
  const [frame, setFrame] = useState<Regional3dFrame | null>(null);
  const [loading, setLoading] = useState(true);
  useLayoutEffect(() => { latest.current = props; controller.current?.update(props); }, [props]);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    let cancelled = false;
    // Three and its geometries do not enter the server graph or the initial clinical UI bundle.
    import('./regional-webgl-renderer').then(({ createRegionalWebgl }) => {
      if (cancelled) return;
      controller.current = createRegionalWebgl(node, {
        ...latest.current,
        onSelectDistrict: id => latest.current.onSelectDistrict(id),
        onOpenFacility: id => latest.current.onOpenFacility(id),
        onFacilityFocusComplete: (id, anchor) => latest.current.onFacilityFocusComplete?.(id, anchor),
        onFacilityFocusCancel: id => latest.current.onFacilityFocusCancel?.(id),
        onFrame: next => { if (!cancelled) { setFrame(next); setLoading(false); } },
        onFailure: () => { if (!cancelled) latest.current.onFallback(); },
      });
    }).catch(() => { if (!cancelled) latest.current.onFallback(); });
    return () => { cancelled = true; controller.current?.dispose(); controller.current = null; };
  }, []);

  const districts = useMemo(() => new Map(props.districts.map(district => [district.id, district])), [props.districts]);
  const prioritized = useMemo(() => {
    const area = (feature: RegionalFeature) => { const bounds = regionalBounds(regionalPolygons(feature.geometry).flat().flatMap(ring => ring.map(point => projectRegionalPosition(...point))));
      return (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY); };
    return [...props.features].sort((a, b) => Number(['turkestan', 'shymkent'].includes(b.id)) - Number(['turkestan', 'shymkent'].includes(a.id)) || area(b) - area(a));
  }, [props.features]);
  const districtAnchors = new Map(frame?.districts.map(anchor => [anchor.id, anchor]));
  const districtLabels = !props.selectedDistrictId && frame ? placeRegionalLabels(prioritized.flatMap(feature => {
    const anchor = districtAnchors.get(feature.id);
    return anchor?.visible ? [{ ...anchor, width: frame.size.width < 550 ? 124 : 145, height: 43 }] : [];
  }), frame.size) : [];
  const visibleFacilities = [...props.facilities].filter(facility => facility.districtId === props.selectedDistrictId).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const facilityAnchors = new Map(frame?.facilities.map(anchor => [anchor.id, anchor]));
  const facilityLabels = frame ? placeRegionalLabels(visibleFacilities.flatMap(facility => {
    const anchor = facilityAnchors.get(facility.id);
    return anchor?.visible ? [{ id: facility.id, x: anchor.x, y: anchor.y - 56,
      width: frame.size.width < 550 ? 190 : 220, height: 87 }] : [];
  }), frame.size, 160, (frame.facilities ?? []).filter(anchor => anchor.visible).map(anchor => ({ id: `building-${anchor.id}`,
    x: anchor.markerFoot.x, y: (anchor.y + anchor.markerFoot.y) / 2, width: frame.size.width < 550 ? 145 : 180, height: Math.abs(anchor.y - anchor.markerFoot.y) + 28 }))) : [];
  const keyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => controller.current?.pan(55, 0), ArrowRight: () => controller.current?.pan(-55, 0),
      ArrowUp: () => controller.current?.pan(0, 55), ArrowDown: () => controller.current?.pan(0, -55),
      '+': () => controller.current?.zoom(1.25), '=': () => controller.current?.zoom(1.25), '-': () => controller.current?.zoom(.8),
      Home: () => controller.current?.home(), q: () => controller.current?.orbit(.15, 0), e: () => controller.current?.orbit(-.15, 0),
      PageUp: () => controller.current?.orbit(0, -.09), PageDown: () => controller.current?.orbit(0, .09),
      Escape: () => props.onSelectDistrict(null),
    };
    if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
  };
  return <>
    <div className={styles.viewport} data-renderer="webgl" data-regional-viewport>
      <canvas ref={canvas} className={styles.webgl} tabIndex={0} onKeyDown={keyDown}
        aria-label="Трёхмерная географическая карта. Стрелки — перемещение, плюс и минус — масштаб, Q/E — поворот, PageUp/PageDown — наклон, Home — вернуть вид. Районы и организации также доступны в списке рядом." />
      <div className={styles.projectedLayer} aria-label="Объекты трёхмерной карты" data-navigating={Boolean(frame?.navigating)}
        aria-hidden={Boolean(frame?.navigating)} inert={Boolean(frame?.navigating)}>
        {frame && <svg className={styles.projectedLines} viewBox={`0 0 ${frame.size.width} ${frame.size.height}`} aria-hidden="true">
          {frame.facilities.filter(anchor => anchor.displaced && anchor.visible).map(anchor => <g key={`position-${anchor.id}`}>
            <path d={`M${anchor.geographicAnchor.x},${anchor.geographicAnchor.y}L${anchor.markerFoot.x},${anchor.markerFoot.y}`} className={styles.clusterConnector} />
            <circle className={styles.geographicPin} cx={anchor.geographicAnchor.x} cy={anchor.geographicAnchor.y} r="2.5" />
          </g>)}
          {districtLabels.map(label => { const anchor = districtAnchors.get(label.id)!; return <path key={label.id} d={`M${anchor.x},${anchor.y}L${label.x},${label.y}`} className={styles.leader} />; })}
          {facilityLabels.map(label => { const anchor = facilityAnchors.get(label.id)!; return <g key={label.id}><path d={`M${anchor.x},${anchor.y}L${label.x},${label.y}`} className={styles.leader} />
            <circle className={styles.anchor} cx={anchor.x} cy={anchor.y} r="3" /></g>; })}
        </svg>}
        {districtLabels.map(label => {
          const feature = props.features.find(item => item.id === label.id)!, district = districts.get(label.id);
          return <button key={label.id} type="button" className={styles.projectedDistrict}
            style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
            data-tone={!district || district.kpiPercent === null ? 'empty' : district.overdueTasks ? 'warning' : 'good'}
            data-republican={label.id === 'shymkent'} onClick={() => props.onSelectDistrict(label.id)}
            aria-label={`Открыть ${feature.properties.name}${label.id === 'shymkent' ? ', отдельный город республиканского значения' : ''}`}>
            <strong>{feature.properties.name.replace(/ район$/, '')}</strong>
            <span>{label.id === 'shymkent' ? 'Отдельный город · ' : ''}{district ? `${district.hospitalCount + district.polyclinicCount} медорганизации` : 'Нет данных'}</span>
          </button>;
        })}
        {facilityLabels.map(label => {
          const facility = visibleFacilities.find(item => item.id === label.id)!;
          return <button key={label.id} type="button" className={styles.projectedFacility}
            data-regional-facility={facility.id}
            style={{ left: label.x, top: label.y, width: label.width, height: label.height }}
            data-selected={facility.id === (props.selectedFacilityId ?? props.previewFacilityId)} onClick={() => props.onOpenFacility(facility.id)}
            disabled={frame?.navigating}
            aria-label={`Выбрать учреждение: ${facility.name}`}>
            <span className={styles.facilityHeading}>{facility.kind === 'hospital' ? <Hospital size={17} /> : <Building2 size={17} />}<strong>{facility.name}</strong></span>
            <span className={styles.facilityType}>{facility.kind === 'hospital' ? 'Больница' : 'Поликлиника'}<b>{facility.id === (props.selectedFacilityId ?? props.previewFacilityId) ? 'Выбрана' : 'Выбрать'}</b></span>
            <span className={styles.facilityStats}>{facility.patientCount} пациентов <i />{facility.queuedVisits} в очереди</span>
          </button>;
        })}
      </div>
      <div className={styles.compass} aria-hidden="true"><span>С</span><ArrowUp size={25} strokeWidth={1.4} style={{ transform: `rotate(${-(frame?.pose.yaw ?? 0)}rad)` }} /></div>
      <div className={styles.hint}><span>{props.selectedDistrictId ? frame?.navigating && !props.selectedFacilityId ? 'Приближаем район…' : 'Выберите здание → сводка рядом' : 'Выберите район на карте'}</span></div>
      {loading && <div className={styles.engineLoading} role="status">Подготавливаем 3D-карту…</div>}
    </div>
    <div className={styles.footer}>
      <div className={styles.controls} aria-label="Камера 3D">
        <button type="button" className={styles.control} onClick={() => controller.current?.zoom(.8)} aria-label="Отдалить карту"><Minus size={15} />Отдалить</button>
        <span className={styles.zoom}>{number.format(frame?.zoomPercent ?? 100)}%</span>
        <button type="button" className={styles.control} onClick={() => controller.current?.zoom(1.25)} aria-label="Приблизить карту"><Plus size={15} />Приблизить</button>
        <button type="button" className={styles.control} onClick={() => controller.current?.home()} aria-label="Показать выбранную территорию целиком"><LocateFixed size={15} />{props.selectedDistrictId ? 'Территория целиком' : 'Область целиком'}</button>
        <details className={styles.cameraAngles}><summary><Layers3 size={15} /><ChevronDown size={12} />Ракурс</summary><div>
          <button type="button" className={styles.control} onClick={() => controller.current?.orbit(.2, 0)}><RotateCcw size={15} />Повернуть влево</button>
          <button type="button" className={styles.control} onClick={() => controller.current?.orbit(-.2, 0)}><RotateCw size={15} />Повернуть вправо</button>
          <button type="button" className={styles.control} onClick={() => controller.current?.orbit(0, (frame?.pose.tilt ?? 0) > .65 ? -.3 : .3)}><Layers3 size={15} />Изменить наклон</button>
          <p>Тяните карту для перемещения. С Shift — поворот; колесо — масштаб.</p>
        </div></details>
      </div>
      <details className={styles.mapSelector}><summary>Районы и учреждения<ChevronDown size={12} /></summary><div className={styles.mapNavigation}>
        <label>Территория<select value={props.selectedDistrictId ?? ''} onChange={event => props.onSelectDistrict(event.target.value || null)}>
          <option value="">Вся область и Шымкент</option>{props.features.map(feature => <option key={feature.id} value={feature.id}>{feature.properties.name}</option>)}
        </select></label>
        {props.selectedDistrictId && <label>Организация<select value={props.selectedFacilityId ?? props.previewFacilityId ?? ''} disabled={frame?.navigating} onChange={event => { if (event.target.value) props.onOpenFacility(event.target.value); }}>
          <option value="">Выбрать организацию</option>{visibleFacilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
        </select></label>}
      </div></details>
    </div>
    <div className={styles.source}><div className={styles.legend} aria-label="Сроки задач, не оценка медицинского качества">
      <span><i className={styles.swatch} />Без просрочек</span><span><i className={`${styles.swatch} ${styles.swatchWarning}`} />Есть просрочки</span><span><i className={`${styles.swatch} ${styles.swatchEmpty}`} />Нет задач</span>
    </div><span>Здания — условные символы{frame?.facilities.some(anchor => anchor.displaced) ? '; пунктир — к координатам' : ''}.</span>
      <a href={REGIONAL_ATTRIBUTION_URL} target="_blank" rel="noreferrer">{REGIONAL_ATTRIBUTION}</a></div>
  </>;
}

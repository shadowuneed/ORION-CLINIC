import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CloudObservationLatestPanel, CloudObservationValues, CloudObservationsView, cloudObservationFormatTime } from './cloud-observations';
import { observationNow, observationScope, observationVersion } from '@/lib/cloud/observation-test-fixtures';

describe('cloud observations compact view', () => {
  it.each([
    ['female', 'anatomy-female-v1.png', 'Женская анатомическая'],
    ['male', 'anatomy-v1.png', 'Мужская анатомическая'],
    ['unknown', 'anatomy-v1.png', 'пол не указан'],
    ['not_recorded', 'anatomy-v1.png', 'пол не указан'],
  ] as const)('uses only recorded sex %s for the illustrative anatomy', (sexAtBirth, asset, caption) => {
    const html = renderToStaticMarkup(createElement(CloudObservationLatestPanel, { sexAtBirth,
      latest: { state: 'ready', vitals: { anthropometry: null, bloodPressure: null, temperature: null }, timeZone: 'Asia/Almaty' } }));
    expect(html).toContain(asset); expect(html).toContain(caption); expect(html).toContain('Иллюстративная схема');
    expect(html).toContain('Не записано'); expect(html).not.toContain('risk'); expect(html).not.toContain('118/76');
  });
  it('does not infer a female silhouette or measurements if sex is not supplied', () => {
    const html = renderToStaticMarkup(createElement(CloudObservationLatestPanel,
      { latest: { state: 'loading', vitals: null, timeZone: 'UTC' } }));
    expect(html).toContain('Общая анатомическая'); expect(html).toContain('Загружаем'); expect(html).not.toContain('anatomy-female');
  });
  it('renders independent real latest group times and never copies pressure time into anthropometry', () => {
    const source = { observationId: 'real-fixture', version: 1, recordedBy: 'Сотрудник Тестовый', sourceLabel: 'Облачный ручной ввод · тестовые данные' };
    const html = renderToStaticMarkup(createElement(CloudObservationLatestPanel, { sexAtBirth: 'female', latest: {
      state: 'ready', timeZone: 'Asia/Almaty', vitals: {
        anthropometry: { ...source, measuredAt: observationNow - 86400000, heightCm: 165, weightKg: 64, bmi: 23.51 },
        bloodPressure: { ...source, measuredAt: observationNow, systolicMmhg: 118, diastolicMmhg: 76 }, temperature: null,
      } } }));
    expect(html).toContain('118/76'); expect(html).toContain('23,51');
    expect(html).toContain(cloudObservationFormatTime(observationNow - 86400000, 'Asia/Almaty'));
    expect(html).toContain(cloudObservationFormatTime(observationNow, 'Asia/Almaty'));
    expect(html).toContain('Отсутствующее значение не означает норму'); expect(html).toContain('не настроены');
  });
  it('distinguishes failed loading from no measurement', () => {
    const html = renderToStaticMarkup(createElement(CloudObservationLatestPanel,
      { latest: { state: 'unavailable', vitals: null, timeZone: 'UTC' } }));
    expect(html).toContain('Не удалось загрузить'); expect(html).not.toContain('Не записано');
  });
  it('renders only groups present in a version, with their actual units', () => {
    const version = observationVersion();
    version.values = { ...version.values, heightCm: null, weightKg: null, bmi: null, temperatureC: null } as never;
    const html = renderToStaticMarkup(createElement(CloudObservationValues, { version }));
    expect(html).toContain('118/76 мм рт. ст.'); expect(html).not.toContain('ИМТ'); expect(html).not.toContain('°C'); expect(html).not.toContain('см');
  });
  it('SSR first paint is already styled loading, not an unbounded D1 directory', () => {
    const html = renderToStaticMarkup(createElement(CloudObservationsView, { selection: observationScope }));
    expect(html).toContain('Подтверждаем доступ'); expect(html).toContain('aria-busy="true"'); expect(html).toContain('class=');
    expect(html).toContain('/patients/patient-a?facilityId=facility-a&amp;accessAssignmentId=assignment-a');
    expect(html).not.toContain('Локальный ручной ввод'); expect(html).not.toContain('Синтетический пациент');
  });
});

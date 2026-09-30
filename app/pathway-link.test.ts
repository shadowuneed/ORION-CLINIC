import type { MouseEvent } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
import { requestPathwayMotion } from './pathway-link';

afterEach(() => vi.unstubAllGlobals());
function setup(options: Partial<MouseEvent<HTMLAnchorElement>> = {}) {
  const dispatch = vi.fn<(event: Event) => boolean>(() => false);
  vi.stubGlobal('window', {
    location: new URL('http://127.0.0.1:3200/patients'),
    matchMedia: () => ({ matches: false }), dispatchEvent: dispatch,
  });
  const event = {
    button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    currentTarget: { target: '', hasAttribute: () => false }, preventDefault: vi.fn(), ...options,
  } as unknown as MouseEvent<HTMLAnchorElement>;
  return { event, dispatch };
}

it('requests pathway motion from a dashboard card without changing its URL/context', () => {
  const { event, dispatch } = setup();
  const href = '/pathway?facilityId=clinic-a&patientId=patient-a&view=care';
  requestPathwayMotion(event, href, '/', 'Наблюдение');
  expect(dispatch.mock.calls[0][0]).toMatchObject({ detail: { from: '/', target: href, label: 'Наблюдение' } });
  expect(event.preventDefault).toHaveBeenCalledOnce();
});

it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }])(
  'preserves browser gestures and prior unsaved-change handlers: %j', (flags) => {
    const { event, dispatch } = setup(flags);
    requestPathwayMotion(event, '/pathway', '/', 'Маршрут');
    expect(dispatch).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  },
);

it('leaves ordinary pages, inner pathway tabs and external links immediate', () => {
  const { event, dispatch } = setup();
  requestPathwayMotion(event, '/patients', '/', 'Пациенты');
  requestPathwayMotion(event, '/pathway?view=care', '/pathway', 'Наблюдение');
  requestPathwayMotion(event, 'https://example.test/pathway', '/', 'Внешняя ссылка');
  expect(dispatch).not.toHaveBeenCalled();
});

it('falls through to normal routing when the persistent layer is unavailable or motion is reduced', () => {
  const { event, dispatch } = setup();
  dispatch.mockReturnValue(true);
  requestPathwayMotion(event, '/pathway', '/', 'Маршрут');
  expect(event.preventDefault).not.toHaveBeenCalled();
  window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
  dispatch.mockClear();
  requestPathwayMotion(event, '/pathway', '/', 'Маршрут');
  expect(dispatch).not.toHaveBeenCalled();
});

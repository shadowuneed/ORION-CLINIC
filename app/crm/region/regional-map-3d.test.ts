import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RegionalMap3d } from './regional-map-3d';

describe('readable geographic map controls', () => {
  it('shows camera controls in visible words without offering a 2D mode or immediate building entry', () => {
    const select = vi.fn(); const enter = vi.fn();
    const html = renderToStaticMarkup(createElement(RegionalMap3d, {
      districts: [], facilities: [], features: [], selectedDistrictId: null,
      onSelectDistrict: select, onOpenFacility: enter, onFallback: vi.fn(),
    }));
    expect(html).toMatch(/>Приблизить<\/button>/);
    expect(html).toMatch(/>Отдалить<\/button>/);
    expect(html).toMatch(/aria-label="Показать выбранную территорию целиком"[^>]*>.*Область целиком<\/button>/);
    expect(html).toMatch(/<summary[^>]*>.*Ракурс<\/summary>/);
    expect(html).not.toContain('>2D<'); expect(html).not.toContain('Войти в больницу');
    expect(select).not.toHaveBeenCalled(); expect(enter).not.toHaveBeenCalled();
  });
});

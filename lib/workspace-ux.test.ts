import { describe, expect, it } from 'vitest';
import { clinicalEditorBlocker, orderActionBlocker, workspaceContextLabel } from './workspace-ux';

describe('workspace UX context', () => {
  it('explains the next clinical step without promising unavailable editing', () => {
    expect(clinicalEditorBlocker(true, true, true, 'draft')).toContain('Подготовить приём');
    expect(clinicalEditorBlocker(true, true, true, 'ready')).toContain('Начать приём');
    expect(clinicalEditorBlocker(false, true, true, 'draft')).toContain('только просмотр');
    expect(clinicalEditorBlocker(true, false, true, 'draft')).toContain('Дождитесь');
    expect(clinicalEditorBlocker(true, true, false, 'in_progress')).toContain('продолжение');
    expect(clinicalEditorBlocker(true, true, true, 'in_progress')).toBeNull();
    expect(clinicalEditorBlocker(true, true, true, 'review')).toBeNull();
    expect(clinicalEditorBlocker(true, true, true, 'finalized')).toContain('неизменной');
  });
  it('distinguishes an encounter from dashboard without relabelling other pages', () => {
    expect(workspaceContextLabel('/', 'enc-a', 'Рабочий день')).toBe('Приём и протокол');
    expect(workspaceContextLabel('/', null, 'Рабочий день')).toBe('Рабочий день');
    expect(workspaceContextLabel('/orders', 'enc-a', 'Направления')).toBe('Направления');
  });
  it('explains pending and missing reason before an action', () => {
    expect(orderActionBlocker('approve', true, 'текст', true)).toContain('Дождитесь');
    expect(orderActionBlocker('approve', false, '  а ', true)).toContain('минимум 3');
    expect(orderActionBlocker('approve', false, 'текст', false)).toBeNull();
  });
  it('requires reviewed result only for completion', () => {
    expect(orderActionBlocker('complete', false, 'текст', false)).toContain('проверенный врачом');
    expect(orderActionBlocker('complete', false, 'текст', true)).toBeNull();
    expect(orderActionBlocker('revoke', false, 'текст', false)).toBeNull();
  });
});

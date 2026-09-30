/** Presentation only: never used to authorize a server command. */
export function clinicalEditorBlocker(canManage: boolean, saved: boolean, recovered: boolean, status?: string): string | null {
  if (!canManage) return 'В выбранном назначении доступен только просмотр. Проверьте раздел «Моя роль и права».';
  if (!saved) return 'Дождитесь загрузки сохранённого состояния. При ошибке обновите приём.';
  if (!recovered) return 'Подтвердите продолжение кнопкой «Продолжить работу с этим приёмом» рядом с записью. Это откроет проверку, но не одобрит черновики.';
  if (status === 'draft') return 'Сначала зафиксируйте согласие «Приём и документация», затем нажмите «Подготовить приём» и «Начать приём» выше.';
  if (status === 'ready') return 'Нажмите «Начать приём» выше, чтобы открыть редактирование разделов.';
  if (status === 'in_progress' || status === 'review') return null;
  return 'Редактирование закрыто для текущего статуса приёма. Подписанная версия сохраняется неизменной.';
}

export function workspaceContextLabel(pathname: string, encounterId: string | null, fallback: string) {
  return pathname === '/' && encounterId?.trim() ? 'Приём и протокол' : fallback;
}

export function orderActionBlocker(action: string, busy: boolean, reason: string, canComplete: boolean): string | null {
  if (busy) return 'Сохраняем действие. Дождитесь ответа сервера.';
  if (reason.trim().length < 3) return 'Введите основание действия выше — минимум 3 символа.';
  if (action === 'complete' && !canComplete) return 'Загрузите финальный результат и отметьте его как проверенный врачом в разделе «Результат и заключение» ниже.';
  return null;
}

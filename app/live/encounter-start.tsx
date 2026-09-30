'use client';

import { ArrowRight, Files, History, MicOff, Shield, UserRoundPlus, UserRoundSearch } from 'lucide-react';
import { useWorkspaceCanManage, useWorkspaceUrl } from '@/lib/workspace-access-context';
import { workspaceNavigationUrl } from '@/lib/workspace-access-url';

export function EncounterStart() {
  const url = useWorkspaceUrl();
  const canManage = useWorkspaceCanManage();
  const worklistUrl = url('/');
  // The registry authorizes its own permission, but must receive this exact
  // resolved assignment rather than silently selecting another department.
  const patientsUrl = workspaceNavigationUrl('/patients', '/live', new URL(worklistUrl, 'https://orion.invalid').search);
  const newPatientContent = <>
    <span className="live-start__route-icon"><UserRoundPlus aria-hidden="true" size={21} /></span>
    <span className="live-start__route-copy">
      <small>НОВАЯ КАРТОЧКА</small><strong>Создать пациента и приём</strong>
      <span>{canManage ? 'Откройте форму, затем начните отдельную запись разговора.' : 'Недоступно: в этом назначении нет права создавать приём.'}</span>
    </span>
    {canManage ? <ArrowRight className="live-start__route-arrow" aria-hidden="true" size={18} /> : null}
  </>;

  return <main className="live-start" aria-labelledby="live-start-title">
    <header className="live-start__header">
      <div>
        <p className="live-start__eyebrow">Инструмент приёма</p>
        <h1 id="live-start-title">Запись разговора</h1>
        <p className="live-start__intro">{canManage
          ? 'Выберите пациента и приём. Микрофон включается отдельно, после проверки согласий.'
          : 'Откройте доступный приём для просмотра. Запись в этом назначении недоступна.'}</p>
      </div>
      <span className="live-start__idle"><MicOff aria-hidden="true" size={16} />Микрофон выключен</span>
    </header>

    <div className="live-start__workspace">
      <section className="live-start__routes" aria-labelledby="live-start-patient-title">
        <div className="live-start__section-heading">
          <h2 id="live-start-patient-title">Выберите, что хотите сделать</h2>
          <p>{canManage ? 'Новый разговор создаёт отдельный приём. Прежний можно продолжить из истории.' : 'Доступные карточки и история — без изменения записей.'}</p>
        </div>
        <a className="live-start__route live-start__route--primary" href={patientsUrl}>
          <span className="live-start__route-icon"><UserRoundSearch aria-hidden="true" size={21} /></span>
          <span className="live-start__route-copy">
            <small>СУЩЕСТВУЮЩАЯ КАРТОЧКА</small><strong>Найти пациента</strong>
            <span>{canManage ? 'Найдите карточку и создайте для неё новый приём.' : 'Найдите карточку и откройте историю приёмов.'}</span>
          </span>
          <ArrowRight className="live-start__route-arrow" aria-hidden="true" size={18} />
        </a>
        {canManage ? <a className="live-start__route" href={url('/encounters/new')}>{newPatientContent}</a>
          : <div className="live-start__route live-start__route--disabled" aria-disabled="true">{newPatientContent}</div>}

        <a className="live-start__route live-start__history" href={worklistUrl}>
          <span className="live-start__route-icon"><History aria-hidden="true" size={21} /></span>
          <span className="live-start__route-copy"><small>ИСТОРИЯ</small><strong>Продолжить прежний приём</strong><span>Откройте незавершённый приём с его расшифровкой и протоколом.</span></span>
          <ArrowRight className="live-start__route-arrow" aria-hidden="true" size={18} />
        </a>
      </section>

      <aside className="live-start__guidance" aria-labelledby="live-start-guidance-title">
        <h2 id="live-start-guidance-title">Перед записью</h2>
        <div className="live-start__guidance-item">
          <Shield aria-hidden="true" size={19} />
          <div><h3>Проверьте согласия</h3><p>В выбранном приёме подтвердите необходимые согласия пациента. Без них запись не начнётся.</p></div>
        </div>
        <div className="live-start__guidance-item">
          <Files aria-hidden="true" size={19} />
          <div><h3>Отдельный контекст</h3><p>Прежняя расшифровка и подсказки не станут контекстом нового приёма. Старые локальные записи здесь не открываются.</p></div>
        </div>
        <p className="live-start__pause-note">Пауза микрофона не завершает медицинский приём. Для продолжения откройте тот же приём.</p>
      </aside>
    </div>
    <p className="live-start__data-note">Расшифровка и подсказки будут привязаны только к выбранному приёму.</p>
  </main>;
}

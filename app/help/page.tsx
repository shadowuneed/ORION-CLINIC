import { AuthenticatedClinicPage, getAuthenticatedClinicContext } from '../authenticated-clinic-page';
import styles from './help.module.css';
import { verifiedWorkflows } from '../../docs/user-guide/verified-workflows.mjs';

export const dynamic = 'force-dynamic';

export default async function HelpPage() {
  const context = await getAuthenticatedClinicContext('/help');
  return (
    <AuthenticatedClinicPage context={context} requiredCapability="access">
      <section className={styles.main} aria-labelledby="help-title">
        <header className={styles.header}>
          <div><h1 id="help-title">Как работать в ORION</h1><p>Роли, кнопки и полный путь приёма.</p></div>
          <a href="/user-guide.html" download="ORION-CLINIC-GUIDE.html">Скачать инструкцию</a>
          <a href="/user-guide.html" target="_blank" rel="noopener noreferrer">Открыть отдельно</a>
        </header>
        <p role="note">Текстовые шаги входа, выхода и старта Live ниже актуальны на 24.09.2026. Снимки прежних экранов входа и Live — исторические: новые экраны ещё не пересняты. Ранее обновлены пять снимков: управление доступами, отзыв, собственные права, план наблюдения и измерения; остальные иллюстрации могут отличаться от текущего интерфейса.</p>
        <section className={styles.workflows} aria-label="Проверенные рабочие сценарии">
          {verifiedWorkflows.map((flow) => <article key={flow.title}>
            <small>{flow.role}</small><h2>{flow.title}</h2>
            <ol>{flow.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            <p>{flow.boundary}</p>
          </article>)}
        </section>
        <iframe className={styles.reader} src="/user-guide.html" title="Иллюстрированная инструкция ORION Clinic" sandbox="allow-scripts allow-modals allow-downloads" />
      </section>
    </AuthenticatedClinicPage>
  );
}

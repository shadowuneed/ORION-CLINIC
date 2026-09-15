import { AuthenticatedClinicPage, getAuthenticatedClinicContext } from '../authenticated-clinic-page';
import styles from './help.module.css';

export const dynamic = 'force-dynamic';

export default async function HelpPage() {
  const context = await getAuthenticatedClinicContext('/help');
  return (
    <AuthenticatedClinicPage context={context} requiredCapability="access">
      <section className={styles.main} aria-labelledby="help-title">
        <header className={styles.header}>
          <div><h1 id="help-title">Как работать в ORION</h1><p>Роли, кнопки и полный путь приёма. Только искусственные данные на иллюстрациях.</p></div>
          <a href="/user-guide.html" download="ORION-CLINIC-GUIDE.html">Скачать инструкцию</a>
          <a href="/user-guide.html" target="_blank" rel="noopener noreferrer">Открыть отдельно</a>
        </header>
        <iframe className={styles.reader} src="/user-guide.html" title="Иллюстрированная инструкция ORION Clinic" sandbox="allow-scripts allow-modals allow-downloads" />
      </section>
    </AuthenticatedClinicPage>
  );
}

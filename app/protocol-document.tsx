import type { ProtocolPreview } from '@/lib/domain/protocol-preview';
import type { ReactNode } from 'react';
import styles from './clinical-workspace.module.css';

const titles: Record<string, string> = {
  complaints: 'Жалобы', history_of_present_illness: 'Анамнез заболевания',
  past_medical_history: 'Анамнез жизни', allergy_status: 'Аллергологический статус',
  objective_findings: 'Объективные данные', preliminary_diagnosis: 'Предварительный диагноз',
  examination_plan: 'План обследования', treatment_plan: 'План лечения и корректировок',
};

export function EncounterMaterials({ archived, children }: { archived: boolean; children?: ReactNode }) {
  return archived ? <details className={styles.encounterMaterials}>
    <summary>Материалы приёма: согласия, расшифровка и история разделов</summary>
    {children}
  </details> : <>{children}</>;
}

export function ProtocolDocument({ document, onSign, blocked }: {
  document: ProtocolPreview; onSign: () => void; blocked: boolean;
}) {
  return <section id="protocol-document" className={styles.protocolDocument} aria-labelledby="protocol-document-title" tabIndex={-1}>
    <header>
      <div><span className={styles.sectionEyebrow}>{document.status === 'signed' ? 'Подписанный документ' : 'На проверке · ещё не подписан'}</span>
        <h2 id="protocol-document-title">Протокол приёма · версия {document.version}</h2>
        <p>{document.patient.displayName} · карта {document.patient.medicalRecordNumber}</p>
      </div>
      {document.status === 'draft'
        ? <button type="button" className={styles.primaryButton} disabled={blocked} onClick={onSign}>Перейти к подписи</button>
        : <a className={styles.primaryButton} href="#protocol-exports">Скачать Word / PDF</a>}
    </header>
    <p>Сохранённая версия из базы. Ниже — содержание документа, а не текущий черновик редактора.</p>
    <div className={styles.protocolDocumentSections}>
      {document.sections.map(section => <section key={section.code}>
        <h3>{titles[section.code] ?? section.code}</h3>
        <p>{section.content || (section.reviewState === 'explicitly_absent' ? 'Отсутствие сведений подтверждено врачом.' : 'Нет текста.')}</p>
      </section>)}
    </div>
    {document.recommendations.length > 0 && <section><h3>Принятые врачом рекомендации</h3>
      {document.recommendations.map((item, index) => <div key={index}><h4>{item.title}</h4><p>{item.content}</p></div>)}
    </section>}
    {document.amendments.map(item => <section key={item.id}><h3>Дополнение: {item.reason}</h3><p>{item.text}</p></section>)}
    <details><summary>Проверка сохранения</summary><p>Версия {document.version} · контрольная сумма {document.sourceHash}</p></details>
  </section>;
}

import { chatGPTSignInPath } from '@/lib/auth/chatgpt-navigation';
import styles from '../authenticated-clinic-page.module.css';

// Deliberately public: redirecting logout into a protected page signs in again.
export default function SignedOutPage() {
  return <main className={styles.state}>
    <p>ORION Clinic</p>
    <h1>Сеанс завершён</h1>
    <p>Рабочее место закрыто. Чтобы продолжить, выполните вход.</p>
    <a href={chatGPTSignInPath('/')} target="_top">Войти в ORION Clinic</a>
  </main>;
}

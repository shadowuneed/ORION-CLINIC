import { OrionLoading } from './brand/orion-brand';
import styles from './loading.module.css';

export default function Loading() {
  return <div className={styles.screen}><OrionLoading label="Открываем раздел ORION Clinic…" /></div>;
}

# Synthetic screenshot fixture record

Снимки пользовательской инструкции созданы 1 сентября 2026 года в локальном
ORION Clinic на `localhost:3200` после применения миграции `0011_access_audit`.

## Разрешённые данные на снимках

- организация: `ORION Synthetic Clinic`;
- площадка: `Synthetic Main Facility`;
- врач: `А. Сейдахметова` — синтетическая seed-запись;
- пациенты: `Айдана С.`, `Тестовый пациент API Локальный` и `Тестовый пациент
  Л.` — синтетические D1 записи с MRN `SYN-0042`, `SYN-5A083F19` и
  `SYN-LIFE-01`;
- encounter: `encounter-a`, `encounter-a-lifecycle` и локальный synthetic API
  encounter;
- разговор: четыре заранее подготовленных RU/KK/MIXED сегмента;
- рекомендации: provider/model `synthetic / fixture`;
- consent policy: `synthetic-local-v1`, не утверждена клиникой.

Ни на одном снимке нет ИИН, телефона, адреса, email, настоящего имени пациента,
cookies, auth headers, API keys или локального абсолютного пути. Все файлы
перекодированы в настоящий PNG и просмотрены после съёмки; браузерная консоль не
содержала ошибок или предупреждений. Снимок `10` намеренно получен после
остановки локального сервера и показывает обработанное fail-safe состояние.

## Техническая матрица

| Файл | Viewport | Назначение |
| --- | ---: | --- |
| `01-workspace-overview.png` | 1425×950 | общий desktop-экран и access receipt |
| `02-transcript-speakers.png` | 1425×950 | роли, языки, consent и structured record |
| `03-clinical-sections-and-recommendations.png` | 1425×950 | восемь разделов и проверенный текст без горизонтального overflow |
| `04-new-synthetic-encounter.png` | 1425×950 | защитная форма создания test encounter |
| `05-signed-documents-and-amendment.png` | 1425×950 | документы, ZIP и predecessor amendment без обрезания действия |
| `06-mobile-workspace.png` | 375×812 | мобильный заголовок и документы |
| `07-mobile-transcript.png` | 375×812 | мобильные роли говорящих |
| `08-collapsed-navigation.png` | 1425×950 | компактная левая навигация |
| `09-recovery-confirmed.png` | 1425×950 | подтверждённый сервером незавершённый приём |
| `10-recovery-unconfirmed.png` | 1425×950 | fail-safe блокировка при неподтверждённом состоянии |

Снимки получены из реального локального UI без подмены текста в DOM. Временный
viewport после проверки сброшен; вкладка оставлена открытой на `encounter-a`.

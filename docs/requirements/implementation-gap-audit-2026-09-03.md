# ORION Clinic — аудит реализации требований руководителя клиники

- Дата последней проверки: `2026-09-05`
- Базовый commit до Phase 4 checkpoint: `7f2272c`
- Проверенный commit локального Phase 5 checkpoint: `3439e21`
- Режим данных: только синтетические данные в локальных D1/R2
- Основание: `SRC-WA-001`, `SRC-WA-002` и каталог
  `clinic-leadership-catalogue.md`

## 1. Вывод

Текущая платформа всё ещё не реализует полный процесс из сообщений
руководителя клиники. Помимо клинического вертикального среза приёма работают
защищённые локальные срезы направлений/результатов, записи/очереди и
диспансерного наблюдения. Последний связывает решение врача с текущим
подписанным протоколом, сохраняет неизменяемые версии плана, создаёт задачи
только из подписанного плана и вычисляет объяснимые группы по срокам. Медсестра
фиксирует только ответ пациента и эскалацию; клиническое решение остаётся у
врача. Внешние КМИС/LIS/ЭКГ, ЭРДБ/ПУЗ, уведомления и реальные регистры не
подключены, а фазы 7–8 отсутствуют как рабочие модули.

## 2. Что подтверждено кодом и проверками

| Возможность | Требования | Фактическое состояние | Доказательство |
|---|---|---|---|
| Реестр синтетических пациентов и карточка | `REQ-ENC-004` частично, `REQ-NFR-001` | `PARTIAL` | D1 repository/API/UI; история пока содержит в основном карточку и encounters, но не полный поток результатов, направлений и планов |
| Жизненный цикл приёма | `REQ-ENC-001` | `IMPLEMENTED_SYNTHETIC` | D1 encounter states, optimistic versions, recovery snapshot, doctor assignment |
| Раздельные решения пациента | `REQ-NFR-003` | `IMPLEMENTED_SYNTHETIC` | append-only `consent_events`, current heads, version conflict checks, отдельные care/STT/transcript/Groq/audio решения |
| Локальная RU/KK расшифровка и роли | `CTX-004`, `REQ-NFR-005/007` частично | `PARTIAL` | локальный GigaAM/CAMPPlus API и D1 ingestion существуют; браузерный микрофон требует ручной проверки пользователем на целевом ноутбуке |
| Восемь разделов клинической записи | `REQ-ENC-001/002` | `IMPLEMENTED_SYNTHETIC` | каждый раздел имеет draft/reviewed/explicitly-absent и версии; неподтверждённые разделы блокируют протокол |
| Подсказки ИИ и решение врача | `REQ-ENC-005`, `CTX-001/002/003` | `IMPLEMENTED_SYNTHETIC` | original/doctor derivative/review state, accepted/rejected basket, evidence, audit |
| Протокол и файлы | `CTX-005/007` | `IMPLEMENTED_SYNTHETIC` | DOCX/PDF/TXT/audit JSON/ZIP, SHA-256, R2, access audit; юридическая электронная подпись не подключена |
| Доступ и аудит | `REQ-NFR-001/002` | `PARTIAL` | Sites local identity, membership/facility/encounter scope и audit существуют; production OIDC/MFA и lifecycle пользователей отсутствуют |
| Анализы, ЭКГ, услуги и направления | `REQ-ENC-003`, `REQ-ORD-001..004` | `IN_PROGRESS` | D1 request/report version history; separate clinician approval; exact-payload review and terminal-state guards; manual PDF/JPEG/PNG result in R2 through a durable upload intent; immutable command-time replay; reviewed-final completion gate; scoped/audited download; two-pass cleanup for expired uncommitted uploads; integrated `/orders`. Локальный синтетический срез реализован; external delivery/acknowledgement and structured vendor mapping remain open |
| Диспансерное наблюдение и планы | `REQ-CHR-001..007`, `REQ-NUR-001..002` | `IMPLEMENTED_SYNTHETIC` | doctor-confirmed enrollment от текущего signed protocol; immutable signed plan versions; dated plan-derived tasks; deterministic due reason; scoped doctor/nurse worklists; structured response, escalation and doctor resolution; D1/API/UI на `/care` |

Phase 6 gate: secret policy covered 313 repository files; dependency audit found
no known vulnerabilities; lint, strict types, 38 test files/208 tests, Drizzle and
the production build passed. The isolated recovery drill reproduced 67 tables,
124 rows, 22 migrations and three R2 objects after destroying only its disposable
source environment. This evidence applies only to synthetic local data.

## 3. Что отсутствует или остаётся частичным

| Блок руководителя клиники | Требования | Состояние на 2026-09-04 | Что должно появиться в продукте |
|---|---|---|---|
| Анализы, ЭКГ, услуги и направления | `REQ-ENC-003`, `REQ-ORD-001..004` | `IN_PROGRESS` | Локальный синтетический D1/R2 срез реализован; внешний gate открыт: нужны контракты и sandbox-адаптеры КМИС/LIS/ЭКГ, external acknowledgement/retry/manual ownership и утверждённые форматы |
| Свободные окна, запись и электронная очередь | `REQ-SCH-001..007` | `IN_PROGRESS` | Локальный синтетический D1-срез реализован: маркированное ручное расписание, immutable preferences, hold/confirm/cancel/no-show, защита от двойной записи и queue state machine. Открыты authoritative KMIS source, перенос/waitlist, approved priority policy, уведомления, trusted expiry worker и внешняя сверка |
| Эндокринолог, диспансерный учёт, планы на месяцы | `REQ-CHR-001..010` | `IN_PROGRESS` | Локально реализованы решение врача, signed-plan versions, medication/diet/goals, plan-derived follow-up/control tasks и due/overdue cohort. Реальный регистр, ЭРДБ/ПУЗ и источник бесплатных лекарств заблокированы внешними решениями |
| Работа медсестры | `REQ-NUR-001..002` | `IMPLEMENTED_SYNTHETIC` | медсестра видит только назначенные задачи, фиксирует способ контакта/wellbeing/ответ, эскалирует; врач отдельно закрывает эскалацию; SLA и автоматические каналы не утверждены |
| Автообзвон, WhatsApp/Telegram и напоминания | `REQ-COM-001..004`, `REQ-SCH-006` | `NOT_STARTED` | channel consent, approved templates, outbox, delivery/retry/reply/escalation; реальные сообщения до согласования не отправляются |
| Смотровая: рост/вес/ИМТ/давление | `REQ-OBS-001..004` | `NOT_STARTED` | measurements с единицами, источником, версиями/исправлениями и подтверждаемыми порогами |
| «Красный» пациент и передача между больницами | `REQ-TRF-001..007` | `NOT_STARTED` | versioned rules, doctor confirmation, transfer packet, delivery/acknowledgement/manual call, read-only chronology |
| ERDB/ЭРДБ, PUZ/ПУЗ, бесплатные лекарства | `REQ-CHR-008..010` | `BLOCKED_EXTERNAL` | нельзя корректно моделировать адаптер, пока клиника не назовёт системы, владельцев, API, legal basis и source of truth |
| «Айдын емхана» как референс | `REQ-DIS-001` | `BLOCKED_INPUT` | нужен точный объект/ссылка и разрешённый объём исследования |

## 4. Дефекты текущего пользовательского пути

| Дефект | Причина | Исправление, подтверждённое в checkpoint |
|---|---|---|
| На `/live` решения выглядели как чекбоксы, но не нажимались | input намеренно имел `disabled`, а экран не давал выполнить D1 consent command | Псевдочекбоксы заменены отдельными явными действиями care/transcript/local STT/audio retention с RU/KK, optimistic version и D1 reload |
| Кнопка STT всегда была заблокирована при одном отсутствующем решении | UI показывал только общий текст «не хватает согласий» | Показываются каждое решение, его версия/отказ и точный список недостающих условий |
| Выход мог выполняться внутри вложенного окна | sign-out link не задавал top-level navigation | Добавлен `target="_top"`, сохранён официальный Sites sign-out route, выход остаётся видимым на мобильном экране |
| «Структурированная запись» выглядела как непонятное окно | отсутствовало объяснение цели, шагов и прогресса | Блок переименован в «Клиническая запись · 8 разделов»; показаны инструкция, прогресс и причина недоступности проверки пустого раздела |

## 5. Правильный порядок дальнейшей реализации

1. Закрыть и проверить текущий encounter slice: согласия → STT → коррекция
   ролей/текста → AI drafts → врачебная проверка → протокол → документы.
2. Закрыть внешнюю часть Phase 4 только после ответов по DEC-001/002/005:
   версионный адаптер, sandbox, transmitted/acknowledged/retry и ручной
   владелец сверки. Не выдавать локальный `active` за доказанную отправку.
3. Закрыть внешний gate Phase 5 после утверждения authoritative schedule:
   адаптер КМИС, перенос/waitlist, trusted expiry/reconciliation worker и
   подтверждённая политика очереди. Локальный D1-срез не выдавать за реальную
   доступность врача.
4. Внешнюю часть Phase 6 добавлять только после определения ЭРДБ/ПУЗ,
   источника бесплатных лекарств, legal basis и владельцев интеграции. Локальный
   план и worklist не выдавать за реальную постановку на учёт.
5. Добавить Phase 7 через provider-neutral outbox; подключать реальный канал
   только после подтверждения бизнес-аккаунтов, шаблонов и согласий.
6. Добавить Phase 8: наблюдения, утверждённые правила риска, doctor-confirmed
   transfer и acknowledgement принимающей стороны.

## 6. Запрещённые заявления

До прохождения соответствующих acceptance gates нельзя заявлять, что ORION:

- автоматически записывает пациента к реальному врачу;
- отправляет направление, анализ, ЭКГ или сообщение во внешнюю систему;
- ставит пациента на реальный диспансерный учёт;
- определяет диабет, назначает лекарство или переводит пациента без врача;
- уведомляет реальную больницу или создаёт production «цифровой двойник»;
- готов к реальным медицинским данным или production deployment.

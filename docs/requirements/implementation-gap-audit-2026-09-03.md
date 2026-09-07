# ORION Clinic — аудит реализации требований руководителя клиники

- Дата последней проверки: `2026-09-07`
- Базовый commit до Phase 4 checkpoint: `7f2272c`
- Проверенный commit локального Phase 5 checkpoint: `3439e21`
- Проверенный commit локального Phase 8A checkpoint: `89819fe`
- Проверенный commit Phase 2C access administration: `6b2308a`
- Проверенный commit Phase 2D orders exact-assignment migration: `a9e73e9`
- Проверенный commit Phase 2E observations exact-assignment migration: `e29a4da`
- Проверенный commit Phase 2F scheduling exact-assignment migration: `9df6510`
- Проверенный commit Phase 2G chronic-care exact-assignment migration: `e5cfcde`
- Phase 2H communications exact-assignment migration: реализована и проверена
  локально; актуальная фиксация и команды — в Last handoff основного плана.
- Режим данных: только синтетические данные в локальных D1/R2
- Основание: `SRC-WA-001`, `SRC-WA-002` и каталог
  `clinic-leadership-catalogue.md`

## 1. Вывод

Текущая платформа всё ещё не реализует полный процесс из сообщений
руководителя клиники. Помимо клинического вертикального среза приёма работают
защищённые локальные срезы направлений/результатов, записи/очереди,
диспансерного наблюдения, отключённой от провайдеров связи с пациентом и
версионной фиксации показателей. Медсестра фиксирует только назначенный ответ,
эскалацию или доступное ей измерение; клиническое решение остаётся у врача.
Внешние КМИС/LIS/ЭКГ, ЭРДБ/ПУЗ, каналы уведомлений, реальные регистры, правила
критичности и передача между больницами не подключены.

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
| Доступ и аудит | `REQ-NFR-001/002` | `PARTIAL` | Sites local identity, versioned departments and assignments, explicit-deny/effective permissions, exact-scope patient, orders, observations, scheduling, care and communications APIs, facility/encounter checks and audit exist. Workspace/clinical/local-speech API families still require migration; production OIDC/MFA, session revocation and lifecycle users are absent |
| Анализы, ЭКГ, услуги и направления | `REQ-ENC-003`, `REQ-ORD-001..004` | `IN_PROGRESS` | D1 request/report version history; separate clinician approval; exact-payload review and terminal-state guards; manual PDF/JPEG/PNG result in R2 through a durable upload intent; immutable command-time replay; reviewed-final completion gate; scoped/audited download; two-pass cleanup for expired uncommitted uploads; integrated `/orders`. Локальный синтетический срез реализован; external delivery/acknowledgement and structured vendor mapping remain open |
| Диспансерное наблюдение и планы | `REQ-CHR-001..007`, `REQ-NUR-001..002` | `IMPLEMENTED_SYNTHETIC` | doctor-confirmed enrollment от текущего signed protocol; immutable signed plan versions; dated plan-derived tasks; deterministic due reason; scoped doctor/nurse worklists; structured response, escalation and doctor resolution; D1/API/UI на `/care` |
| Связь с пациентом | `REQ-COM-001..004`, `REQ-SCH-006` | `IMPLEMENTED_SYNTHETIC_NO_SEND` | отдельные channel/language consent versions, `approved_test` templates, exact-source outbox, quiet hours, bounded disconnected-provider retry and manual fallback на `/communications`; реальный канал и delivery receipt отсутствуют |
| Смотровая: рост/вес/ИМТ/давление/температура | `REQ-OBS-001..004` | `IMPLEMENTED_SYNTHETIC_CAPTURE` | exact-assignment D1/API/UI на `/observations`; effective `observations.manage`, отдельные doctor/nurse правила, scaled units, derived BMI, exact source/author/time, immutable correction history, idempotency, optimistic conflicts and audit; медицинская интерпретация отключена |

Phase 2H now binds communications to one current doctor/nurse/registrar assignment
with effective `communications.manage`. The exact assignment is durable on
consents, notification history, attempts, manual tasks/responses, outbox,
idempotency and audit. Denial, revocation, expiry and mismatched actors are
covered by behavioral tests and database guards. Historical immutable rows are
not rewritten. Current verification details are in MASTER_PLAN.md Last handoff.

Authenticated browser testing saved a clearly marked synthetic SMS decision,
scheduled one test intention, created a manual task, recorded a synthetic response
and completed the task. Reload preserved the four notification versions and
completion. No provider was called. An invalid assignment was denied; a reproduced
same-page navigation bug was fixed so the menu can reload the available assignment
instead of remaining on the denial screen.

Next access migration: assigned-encounter workspace and linked speech/clinical
APIs. A real RU/KK/MIXED speech-quality run and production identity remain open.
The runtime is left running, but Groq configuration was missing at restart;
a working live AI analysis loop is not claimed.

## 3. Что отсутствует или остаётся частичным

| Блок руководителя клиники | Требования | Состояние на 2026-09-06 | Что должно появиться в продукте |
|---|---|---|---|
| Анализы, ЭКГ, услуги и направления | `REQ-ENC-003`, `REQ-ORD-001..004` | `IN_PROGRESS` | Локальный синтетический D1/R2 срез реализован; внешний gate открыт: нужны контракты и sandbox-адаптеры КМИС/LIS/ЭКГ, external acknowledgement/retry/manual ownership и утверждённые форматы |
| Свободные окна, запись и электронная очередь | `REQ-SCH-001..007` | `IN_PROGRESS` | Локальный синтетический D1-срез реализован: exact selected assignment + `scheduling.manage`, отдельные doctor/registrar действия, маркированное ручное расписание, immutable preferences, hold/confirm/cancel/no-show, защита от двойной записи и queue state machine. Открыты authoritative KMIS source, перенос/waitlist, approved priority policy, уведомления, trusted expiry worker и внешняя сверка |
| Эндокринолог, диспансерный учёт, планы на месяцы | `REQ-CHR-001..010` | `IN_PROGRESS` | Локально реализованы решение врача, signed-plan versions, medication/diet/goals, plan-derived follow-up/control tasks и due/overdue cohort. Реальный регистр, ЭРДБ/ПУЗ и источник бесплатных лекарств заблокированы внешними решениями |
| Работа медсестры | `REQ-NUR-001..002` | `IMPLEMENTED_SYNTHETIC` | медсестра видит только назначенные задачи, фиксирует способ контакта/wellbeing/ответ, эскалирует; врач отдельно закрывает эскалацию; SLA и автоматические каналы не утверждены |
| Автообзвон, WhatsApp/Telegram и напоминания | `REQ-COM-001..004`, `REQ-SCH-006` | `IN_PROGRESS` | Локальный no-send D1-срез реализован: consent/templates/outbox/quiet hours/retry/manual response. Открыты business accounts, approved production content, protected links, provider adapters, webhooks, receipts and worker SLA |
| Смотровая: рост/вес/ИМТ/давление/температура | `REQ-OBS-001..004` | `IMPLEMENTED_SYNTHETIC_CAPTURE` | Локальная версионная фиксация с exact assignment, effective permission, отдельными doctor/nurse правилами, единицами, источником, автором, временем, исправлениями и вычисляемым ИМТ реализована. Открыты approved thresholds, device provenance and production validation |
| «Красный» пациент и передача между больницами | `REQ-TRF-001..007` | `BLOCKED_CLINIC_APPROVAL` | Phase 8B review packet and activation-blocked JSON decision template now define the required rule ownership/versioning, doctor confirmation, SLA, minimum signed packet, receiving-facility acknowledgement/manual fallback and read-only chronology choice. No thresholds, runtime classification, alert, notification or transfer are implemented before `DEC-006`/`DEC-007` signatures |
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
5. Закрыть внешний gate Phase 7: подключать реальный канал только после
   подтверждения бизнес-аккаунтов, шаблонов, согласий, delivery receipt,
   reconciliation и владельца сбоя. Локальный outbox не выдавать за доставку.
6. Провести клинический review по
   `phase-8b-clinic-decision-packet.ru.md`, заполнить и подписать отдельную копию
   `phase-8b-decision-record.template.json`. Только после `DEC-006`/`DEC-007`
   утвердить versioned rules, владельца и SLA, затем отдельными checkpoint
   реализовать doctor-confirmed transfer и acknowledgement принимающей стороны.
   Локальную фиксацию показателей не выдавать за triage.

## 6. Запрещённые заявления

До прохождения соответствующих acceptance gates нельзя заявлять, что ORION:

- автоматически записывает пациента к реальному врачу;
- отправляет направление, анализ, ЭКГ или сообщение во внешнюю систему;
- ставит пациента на реальный диспансерный учёт;
- определяет диабет, назначает лекарство или переводит пациента без врача;
- уведомляет реальную больницу или создаёт production «цифровой двойник»;
- готов к реальным медицинским данным или production deployment.

# ONLINE-1C — изоляция локальных материалов сотрудника

Дата аудита: 24.09.2026. Статус: **ONLINE-1C0, metadata-only ONLINE-1C1a и точный
material/run/revision contract ONLINE-1C1b, metadata codec 1C1c и crypto primitive
1C1e реализованы; инженерный key/action design 1C1d зафиксирован в ADR-0003
отдельно от runtime; изоляция действующей истории ещё не реализована**.
Этот документ фиксирует read-only проверку исходного кода и следующий ограниченный
checkpoint. Он не является подтверждением безопасного общего браузера, миграции
записей, encryption acceptance или готового offline-режима.

Порядок работы и release gates: [MASTER_PLAN](../MASTER_PLAN.md), раздел ONLINE-1;
состояние staff auth: [online-staff-auth-handoff](online-staff-auth-handoff.md).
ONLINE-1B credential/session foundation пока не подключён к основному runtime.
До завершения ONLINE-1C нельзя заменять основной общий development-вход отдельными
staff-аккаунтами и объявлять локальную историю изолированной.

## 1. Границы этой проверки

- Прочитан только код в каноническом ORION-CLINIC. Содержимое браузерной IndexedDB,
  медицинские тексты, аудио, основная D1/R2 и секреты не открывались.
- Первоначальный аудит создал только этот документ. Последующие 1C0/1C1a/1C1b/1C1c добавили
  код и тесты, описанные ниже; основная БД, записи, runtime, порты и внешние ресурсы
  не менялись. SQL fixtures создаются и удаляются только в disposable storage.
- Сохраняется полный запрет на любые dir echoes ресурсы на всех платформах, включая
  GitHub, Vercel и Neon. Используется только существующий ORION-CLINIC repository;
  новый репозиторий, инфраструктура и миграция на сторонний сервис не разрешаются
  этим планом.
- Материалы здесь относятся к **сотруднику и его клиническому назначению**.
  Patient/caregiver identity, delegation и mobile offline — отдельный contract из
  [mobile-application-plan](mobile-application-plan.md), не расширение staff DTO.

## 2. Точная текущая поверхность и источники доказательств

Номера строк приведены для проверенного состояния кода; искать также указанные
имена функций, если соседние изменения сдвинут строки.

| Источник | Подтверждено исходным кодом |
| --- | --- |
| [lib/encounter-history.ts](../../lib/encounter-history.ts), строки 37–62 | `OrionEncounterRecord.version=1`; поля clinician/patient name, transcript, analysis/decisions, consent booleans, `audio: Blob`. IndexedDB `orion-local-history`, schema version 1, единственный store `encounters`, keyPath `id`; индексы `startedAt` и `status`. Owner/tenant/assignment/revision/encryption отсутствуют. |
| [lib/encounter-history.ts](../../lib/encounter-history.ts), `openHistoryDatabase` / `runRequest`, строки 66–135 | Один module-level `databasePromise`; `onversionchange` закрывает connection, но не сбрасывает сохранённый promise. Нет registries активных транзакций, owner context или auth-generation fence. |
| [lib/encounter-history.ts](../../lib/encounter-history.ts), строки 138–164 | `saveEncounter` делает безусловный `store.put(record)`; `listEncounters` читает весь store через `getAll`; `markAbandonedEncountersInterrupted` переписывает все найденные `in_progress`. |
| [app/orion-workspace.tsx](../../app/orion-workspace.tsx), строки 1603–1673 | Mount запускает глобальное interruption marking и listing. Autosave отложен на 300 ms; cleanup отменяет timer, но не уже начавшийся save/promise. Rename сохраняет найденный в памяти record без revision/owner проверки. |
| [app/orion-workspace.tsx](../../app/orion-workspace.tsx), `loadAuthoritativeWorkspace`, `currentEncounter`, `resetSession` | Авторитетный encounter ID становится local record ID. `currentEncounter` содержит текущий `speech.recordedAudio`, изначально null. `resetSession` сначала ждёт `speech.stop()`, затем читает `currentEncounterRef.current` и сохраняет результат. |
| [app/live/page.tsx](../../app/live/page.tsx), строки 27–32; [lib/workspace-access-context.tsx](../../lib/workspace-access-context.tsx) | LIVE получает clinician display name и encounter ID. Context несёт assignment/facility/canManage, но не immutable verified identity. Это не owner contract. |
| [app/api/workspace/route.ts](../../app/api/workspace/route.ts), строки 211–240 | Существующий серверный read после аудита и повторной проверки возвращает реальные viewer/organization/facility IDs. Это источник для будущего contract, но ещё не local-material authorization/key endpoint. |
| [lib/live-local-speech-client.ts](../../lib/live-local-speech-client.ts), строки 449–488, `discardRecording`, `stopRecording`, `reset` | Recorder chunks, Blob, upload chain и recording/run epochs находятся в памяти. Финальный Blob формируется после recorder stop. Reset/unmount отменяют запросы, очищают recorder refs и останавливают tracks. Epoch сейчас относится к capture, не к staff identity. |
| [app/encounter-history-panel.tsx](../../app/encounter-history-panel.tsx), `EncounterAudio`, строки 52–55 | Object URL создаётся из Blob; revoke происходит при unmount. Сам player не перепроверяет актуальность staff authority. |
| [lib/encounter-export.ts](../../lib/encounter-export.ts), `downloadBlob`, `downloadEncounterArchive` | RTF/TXT/audio/JSON/ZIP создаются из переданного record локально. ZIP ожидает Blob reads. Download object URL отзывается по timer через 1 s; общей auth-aware URL registry нет. |
| [app/clinic-shell.tsx](../../app/clinic-shell.tsx), строки 205–213 | Текущий logout — Sites link `target=_top`; нет координации с history transactions, recorder, async exports и другими вкладками. |

В просмотренной поверхности IndexedDB используется только указанным history
module. Общие `localStorage` preferences (`orion-theme`,
`orion-navigation-collapsed`, `orion-visit-rail-collapsed`) — настройки интерфейса,
не owner proof. В выполненном source search не найден service worker/CacheStorage
или BroadcastChannel-механизм изоляции истории; это не инспекция браузерного профиля.

### Source-level риск перезаписи — не воспроизведён на данных

Цепочка `loadAuthoritativeWorkspace` → `setEncounterId(serverEncounter.id)` и
`setEncounterStartedAt` → `currentEncounter.audio = speech.recordedAudio` →
autosave → `store.put` использует тот же key для ранее записанного материала.
Открытие начатого server encounter с начальным `recordedAudio=null`, либо новая
запись того же encounter, **может перезаписать** прежний local row/Blob.
Нет revision compare-and-swap или отдельного recording ID, предотвращающего это.

Это вывод из исходного кода. Существующие записи пользователя не читались,
перезапись не запускалась и потеря конкретного аудио не утверждается. Проверять
риск следует только на новых синтетических disposable fixtures.

Глобальный `markAbandonedEncountersInterrupted` также не отличает завершённую
вкладку от живого recorder в другой вкладке. Mount не должен сам объявлять чужую
запись прерванной.

## 3. Целевой ограниченный contract

### 3.1 Владелец и полномочие — не одно и то же

Предлагаемый immutable ownership DTO:

- schema/version и staff audience;
- индивидуальные `userId`, `issuer`, `subject`;
- `organizationId`, `facilityId`, точный `accessAssignmentId`;
- `patientId`, `encounterId`;
- отдельные `localMaterialId` и `recordingRunId` для конкретного материала;
- provenance версии/решения о допустимом хранении, когда этот contract будет
  подключён к проверенному consent source.

Контекст текущей операции отдельно содержит non-bearer auth-context generation,
проверенные права/consent и срок допустимости. Не записывать raw session token,
cookie или пароль в DTO/IndexedDB; роль, display name и email не являются ключом
владельца. JSON/type branding сами по себе не доказывают подлинность: право на
чтение/запись/экспорт сервер проверяет по текущей сессии и точному ресурсу.

Полномочия разных assignments не объединяются. Смена аккаунта, auth generation,
клиники, назначения, пациента или encounter требует нового operation context;
старый snapshot не переименовывается под текущего пользователя.

### 3.2 Хранилище v2 и согласованность

Новый repository принимает owner context на каждом методе; отсутствующий или
несовместимый context означает отказ, а не global fallback. Предлагаемый отдельный
DB namespace, например `orion-staff-materials-v2`, не открывает v1 автоматически.
Окончательное имя/format закрепить тестами до подключения UI.

- Новый material ID создаётся на явное начало записи, не на read-only hydration
  server encounter. Несколько recording runs одного encounter не затирают друг друга.
- Composite ownership key и immutable envelope bind предотвращают случайные
  cross-owner/cross-scope lookup/update; revision compare-and-swap предотвращает
  lost update. Проверка owner/revision/fencing epoch выполняется внутри той же
  IndexedDB transaction, что и commit.
- Любой разрешённый список возвращает только конкретный owner/scope; plaintext
  всего store не должен попадать в React с последующим UI filtering.
- Read receipt/локальный save не равны подписанному клиническому документу или
  server commit. Existing D1 protocol history не переписывается этой работой.
- Abandonment reconciliation использует отдельный owner/run lease и fencing
  generation. Отсутствие heartbeat в одном UI недостаточно для перезаписи чужого run.
- Upgrade/blocked/versionchange/closed-handle обработка должна закрывать поздно
  открывшиеся connection, сбрасывать кешированный handle и возвращать явный отказ;
  нельзя терять ошибку или автоматически создавать пустую «восстановленную» историю.

### 3.3 Шифрование и пределы отзыва

Owner DTO, отдельная БД, UI filtering и BroadcastChannel **не шифруют** сохранённые
данные. Для sensitive persistent v2 требуется отдельный проверенный envelope/key
contract: ciphertext, уникальный nonce, authenticated ownership/schema metadata,
проверка integrity, key rotation/recovery и выдача доступа к ключу только после
текущей серверной авторизации. Подмена owner metadata не должна давать plaintext.

Не хранить рядом с ciphertext постоянно доступный plaintext key и не выводить
encryption key напрямую из пароля/cookie. Сервис управления ключами/escrow и его
операционная политика ещё не выбраны этим документом. Пока они не реализованы и
не испытаны, sensitive persistent cache в новом staff runtime остаётся выключен.
Не называть browser local storage «защищённым offline».

Отзыв на сервере не может мгновенно отнять уже расшифрованные байты у полностью
отключённой вкладки или удалить скачанный файл. Новый online-first путь блокирует
reveal/play/download без свежего допустимого access context; offline entitlement,
lease duration, retention и recovery требуют отдельного ONLINE-1E решения.
Не обещать remote wipe, невозможность screenshot или криптографическую защиту
legacy plaintext после добавления только client-side fence.

## 4. Старые вкладки, async completion и logout

Одна lifecycle boundary должна охватывать history, recorder, player и export.
Её локальная монотонная generation — coordination fence, а не credential.

1. До `await` захватывать immutable owner/record/revision/generation ticket.
   После ожидания сверять его до изменения state, DB commit и download. Новая
   идентичность не подставляется в результат уже выполненного старого запроса.
2. Logout intent, подтверждённый revoke, auth failure и смена owner/scope
   инвалидируют ticket, блокируют sensitive UI и отменяют зарегистрированные
   timers/requests/transactions. Новый login не делает старый ticket действительным.
3. BroadcastChannel сообщает другим вкладкам о необходимости lock/revalidation;
   событие не выдаёт права. Focus/pageshow/resume и каждая reveal/export операция
   повторно проверяют серверное состояние. Кешированная вкладка не может считать
   себя авторизованной только потому, что не получила broadcast.
4. `resetSession` захватывает точный current record **до** `speech.stop()`.
   Поздний финальный Blob никогда не прикрепляется к другому patient/record.
   Существующие capture/run epochs и abort behavior сохраняются и дополнительно
   связываются с identity generation.
5. На нормальном logout активная запись требует ясного решения: остановить и
   завершить разрешённое сохранение до отзыва либо явно выйти с предупреждением
   о неполном сохранении. Сбой сохранения не обозначать успехом. Forced revoke
   немедленно останавливает capture и закрывает доступ; политика незавершённого
   материала не должна молча присваивать его следующему аккаунту.
6. Player останавливается; централизованная registry отзывает все Object URL,
   очищает доступный sensitive state и сбрасывает выбранный record. Асинхронный ZIP
   повторно проверяет ticket/access **после** сборки и до создания download link.
   Уже начатую внешнюю загрузку нельзя представлять как гарантированно отозванную.

Одного React unmount/key недостаточно. Неисполненный timer можно отменить, но уже
начавшаяся IDB transaction требует собственного transaction fence/abort. Первая
реализация pure generation helper не считается доказательством такого commit guard.

## 5. Legacy v1: карантин без изменения оригинала

«Карантин» означает **исключение из нормального нового workflow**, а не move,
delete, переименование БД, экспорт или автоматическое копирование записей.

- `orion-local-history` v1 остаётся нетронутой. Новый runtime не вызывает на ней
  `getAll`, autosave, interruption marking или upgrade с назначением владельца.
- Следующий вошедший staff не получает старые записи, их preview, имена, transcript,
  audio или export. Не определять владельца по `clinicianName`, времени, совпадению
  encounter ID либо последней сессии браузера.
- Отдельный будущий recovery workflow требует явного выбора оператора, проверки
  его полномочия и целевого owner/resource, provenance исходной записи, version/hash
  и durable recovery receipt. Повтор должен быть безопасным; uncertain copy не
  разрешает удалять исходник. Клинический server record не меняется автоматически.
- Любое последующее удаление/очистка legacy — отдельное явное решение владельца и
  retention gate, не побочный эффект миграции или успешного logout.
- Старый JS уже открытой v1 вкладки способен продолжить читать прежний plaintext.
  Новая схема не может задним числом отозвать этот доступ. До shared-device
  активации требуется контролируемое закрытие/обновление старых вкладок и решение
  о сохранённом legacy profile/origin. Отдельный новый origin/profile может быть
  границей нового пилота, но не доказывает безопасность старого профиля и не
  разрешает его удалить. Нельзя объявлять этот gate пройденным по unit tests.

## 6. Порядок реализации и gates

Этап 1C0 и первый metadata-only slice 1C1a реализованы отдельно от действующего
runtime; 1C1 остаётся **IN_PROGRESS**, 1C2–1C4 — **PLANNED**.
Каждый следующий начинается только после своего
ограниченного evidence checkpoint; основная история/аудио не используются как тест.

| Этап | Разрешённый объём | Условие завершения / ограничения |
| --- | --- | --- |
| **ONLINE-1C0 — DTO + pure generation fence** | Новые standalone ownership/lifecycle helper и unit tests; точный scope, immutable ticket, monotonic invalidation, abort registration | Нет imports/calls из v1 writer/UI; нет IndexedDB/network/browser storage; старые данные не читаются. Проверяет только contract и suppression поздних callback, не authorization, encryption или migration. |
| **ONLINE-1C1 — server access/key contract и v2 repository** | Current staff principal + exact resource/consent, encryption envelope contract, scoped repository, revision/transaction fencing, isolated storage tests | До key/revocation/retention решения sensitive persistence выключена. Нет v1 auto-import. Real backend authority отдельно от client DTO. |
| **ONLINE-1C2 — lifecycle интеграция в изолированном runtime** | History/recorder/player/export/logout подключаются к одному owner generation; two-tab invalidation и fresh reauthorization | ONLINE-1B3 проверенный same-principal SSR/API; отдельный disposable HTTPS origin/profile, без main DB/provider keys; штатные старые данные не затрагиваются. |
| **ONLINE-1C3 — явное legacy recovery** | Quarantine UI без раскрытия материалов чужому пользователю, полномочия оператора, controlled copy/receipt/conflict/retry | Сначала только синтетическая v1 fixture; оригинал сохраняется. Автоматическое присвоение, merge и delete отсутствуют. Operational recovery policy явно принята. |
| **ONLINE-1C4 — shared-device activation gate** | Повторная auth/revoke/offline/export/upgrade acceptance, controlled old-tab/profile transition, documentation | Отдельное решение о main switch; ONLINE-1B browser gates и нижеописанная acceptance пройдены. Не закрывает ONLINE-1E crash-safe offline или clinical production approval. |

### Реализованный ONLINE-1C0 — только контекст и локальная граница операций

Новые файлы:

- `lib/local-materials/lifecycle.ts` — строгий staff context с точным
  user/issuer/subject, organization/facility/assignment/patient/encounter,
  authorization generation и пятью раздельными consent-version pins.
- `createLocalMaterialLifecycle()` предоставляет `replaceContext`, `invalidate`,
  `capture`. Lease содержит immutable context, AbortSignal, `isCurrent`,
  однократный синхронный `commit`, `registerCleanup` и `finish`.
- `lib/local-materials/lifecycle.test.ts` — synthetic A/B и A→B→A, scope/consent
  changes, late resolve/reject, cleanup once, reentrant abort/cleanup и Proxy
  traps при проверке входного объекта. Смена контекста, даже на равный или
  некорректный, инвалидирует старые операции. Ошибка одного cleanup не пропускает
  остальные. Финальные результаты root-проверок записаны в MASTER_PLAN.

Контекст обязан дать доверенный серверный adapter. Версия согласия не означает
решение «предоставлено», а валидный DTO — не доказательство личности/прав.
`localMaterialId`, `recordingRunId` и storage revision ещё не входят в lease:
будущий adapter должен захватить точный material/run до await и инвалидировать
контекст при их смене. Helper не проверяет срок серверных полномочий сам.
Регистрация cleanup предшествует commit; уже опубликованный resource остаётся
зарегистрированным до release/invalidate. Асинхронные callback и откат произвольных
побочных эффектов не поддерживаются. Старые скачанные/прочитанные байты не отзываются.

1C0 **не** меняет `encounter-history.ts`, `orion-workspace.tsx`, logout, recorder,
IndexedDB version, store contents или runtime config. Он не монтируется ни к v1,
ни к действующему staff session helper. Проверка: focused unit tests, typecheck,
scoped lint, diff-check; отдельно зафиксировать отсутствие IO/import wiring.

## 7. Disposable synthetic acceptance перед подключением

Использовать новый изолированный browser profile/origin и только явно созданные
искусственные записи/Blob. Не открывать для тестирования существующую IndexedDB
владельца. Любая очистка касается только предварительно проверенного disposable
fixture; сохранение/удаление evidence оговаривается отдельно.

Обязательная матрица:

1. Два сотрудника одной роли A/B: A сохраняет материал; logout → B, тот же
   encounter ID/прямой local lookup/deep link/export не раскрывают A. Авторизованный
   новый A видит только допустимый текущими правами scope, не union assignments.
2. Две вкладки A: list/get/save/rename/ZIP/recorder-stop обещание задержано; во
   второй logout, credential disable или смена scope. После release ни DOM, ни
   новый namespace, ни download, ни committed row не получают старый результат.
3. Два simultaneous writer одного recording run: одна актуальная revision;
   второй получает conflict, не last-write-wins. Mount второй вкладки не меняет
   статус первой записи. Разные runs одного encounter сохраняют разные Blob.
4. Read-only server hydration и reload не создают/переписывают local audio record.
   Null/no-new-audio не стирает существующий разрешённый Blob.
5. Quota/storage denied, transaction abort, blocked upgrade, versionchange,
   закрытый handle, lost response и late open success — явные bounded ошибки,
   никакого ложного saved, пустой «восстановленной» истории или fallback на v1.
6. Logout/owner change прекращают playback/capture и отзывают URL; old ZIP callback
   не кликает ссылку. Сбой POST logout не маскируется успешной серверной revocation;
   локальный lock не даёт автоматически возобновить доступ без revalidation.
7. Изолированная v1 fixture содержит unknown-owner transcript/audio. Новый login
   ничего не принимает автоматически; schema/data/audio digest исходника неизменны
   после просмотра новой системы, ошибок и отменённого recovery.
8. Encryption envelope/metadata tampering, wrong key/owner, revoked key lease,
   offline/focus resume и backup restore не дают открыть материал вопреки текущей
   политике. Отдельно записать пределы уже расшифрованных/скачанных копий.

Для acceptance записывать build/schema/auth versions, disposable origin/profile,
точные два tab identities, command/result evidence и известные ограничения.
Unit/helper tests не заменяют реальные IndexedDB transactions и двухтабовую
browser-проверку; two-tab QA не доказывает production encryption/restore policy.

## 8. Итог данного checkpoint

### Выполненный ONLINE-1C1a — metadata-only context, 07:33 UTC continuation

Реализован неподключённый `resolveLocalMaterialContext(headers, selection,
{ sessions, contexts })` в `lib/local-materials/server-context.ts`, с отдельным
`D1LocalMaterialContextRepository` в `lib/repositories/local-material-context.ts`.
Обязательный exact selection: assignment, facility,
patient, encounter; без выбора первого приёма или fallback на одно назначение.

- Сначала общий staff resolver; captured cookie/selection не меняются после await.
  Final snapshot одним SQL SELECT связывает текущую session и user epoch с exact
  doctor assignment, membership, organisation/facility, department head, patient,
  encounter и пятью consent heads. Эффективность — по часам БД, не `Date.now()`.
  Сам repository SELECT не продлевает сеанс; preflight общего resolver может
  выполнить обычное durable idle-touch. Это разные проверяемые операции.
- Сохранены predicates existing assignment permission view: non-service doctor,
  read permission, exact treatment membership и patient relationship. Read-only
  assignment допустим для метаданных, но не становится can-manage permission.
  Проверяются active base patient **и текущая версия profile**; архивный либо
  повреждённый profile head запрещён, настоящий legacy без head допустим.
- Пять категорий сохраняют event/version, decision, effective/expiry, policy/hash
  и processor. Отсутствие/отказ не запрещают metadata snapshot сами по себе, но
  **не разрешают** клиническое действие. `effectiveByTime` — только временная
  проверка, не утверждение policy/processor/clinical permission. Wrong-patient,
  broken event или head lock возвращают ошибку целостности, не «согласие отсутствует».
- Минимальный deeply frozen DTO не содержит session ID/hash/token, имён, текста
  и аудио. SHA-256 generation — non-bearer change fingerprint, а не ключ/grant.
  Он включает session, user/membership/org/facility epochs, exact assignment/
  department/profile heads, encounter version/status, can-manage bit и отдельные
  consent states. Observation/idle-touch time не меняют его; temporal переход
  согласия меняет. Это не полный revocation log: same-version restore/ABA и уже
  прочитанные offline байты не защищены таким fingerprint.
- Focused checks: **76 unit + 35 SQL tests PASS**. Последние используют реальный
  `node:sqlite`, D1-shaped adapter, все 50 миграций, two connections/reopen и гонки
  logout/reset/revoke/regrant/consent replacement между preflight и final SELECT.
  Отдельно membership/org/facility disable/reactivate с увеличением version.
  Это не actual-workerd/remote-D1/browser acceptance нового context.

Никаких ключей, local material bytes, transcript, R2/v1 чтения, аудио, новых таблиц
или main UI wiring. Fresh snapshot описывает один момент чтения; поздний commit/
reveal/export/key-release обязан повторно авторизовать конкретное действие и
текущий consent/policy/processor. Metadata lookup не является audit состоявшегося
чтения материала или выдачи ключа. Aggregate/quality evidence — MASTER_PLAN §13.

### Выполненный ONLINE-1C1b — material/run/revision contract, 08:34 UTC continuation

Добавлены неподключённые `lib/local-materials/descriptor.ts` и
`lib/local-materials/target-lifecycle.ts` с отдельными тестами.

- Descriptor: `schema: orion-local-material/v1`, exact immutable staff owner
  (audience/user/issuer/subject/org/facility/assignment/patient/encounter),
  `localMaterialId`, `recordingRunId`, positive safe-integer `revision`.
  Plain/null prototype, только перечисленные enumerable own data fields,
  без accessor/hidden/symbol/unknown полей. ID без trim/coercion, C0/C1 и
  незамкнутых surrogate. Возвращается глубокая frozen копия без имён/ключей/bytes.
- Один материал на явный capture run. Helper **не выдаёт ID** и не доказывает их
  уникальность/происхождение; не выводит их из encounter и не создаёт на hydration.
  Он не увеличивает revision и не утверждает, что CAS или запись состоялись.
- `isSameLocalMaterialDescriptor` — строгое совпадение owner/material/run/revision,
  не доверенная подпись, permission или ABA protection. Authority fingerprint и
  consent pins по-прежнему отдельно в контексте операции, не в immutable owner.
- `createLocalMaterialTargetLifecycle` объединяет существующий lifecycle с exact
  descriptor. `replaceTarget` всегда отзывает старый lease, в том числе при equal
  input, malformed input и A→B→A. Owner должен совпадать с context по всем полям.
  Capture выполняется **до** await; late success/error/finally используют только
  этот lease. Commit одноразовый и синхронный, cleanup освобождает captured resource.
- Весь replace защищён от reentrant Proxy/abort/cleanup, а не только его первая
  половина. Независимая проверка выявила передачу сообщения throwing context Proxy;
  исправлено общей ошибкой без исходных данных, добавлены 12 regression cases.
  Ошибки самого publication callback намеренно не маскируются: произвольные уже
  выполненные side effects нельзя откатить этим helper.
- Новые focused tests: **124 descriptor + 87 target-lifecycle PASS**. Вместе с
  существующими 67 lifecycle и 76 server-context — **354 tests PASS**; окончательные
  aggregate/quality результаты находятся в MASTER_PLAN §13. Deferred tests — это
  контракты будущих recorder/autosave/rename/export adapters, **не** интеграционный
  прогон нынешних consumers. Reentrancy peer review: замечание закрыто.

Никаких imports в UI/v1, IndexedDB, аудио, криптографии, ключей, API, новой БД или
cross-tab coordination. Уже начатый произвольный store.put не отменяется этим
helper; нужен отдельный storage CAS/transaction fence. Descriptor equality не
обнаруживает серверный отзыв; fresh action authorization остаётся обязательной.

### Выполненный ONLINE-1C1c — canonical metadata codec, тот же 08:34 continuation

`lib/local-materials/envelope-binding.ts` принимает exact own-data input
`{ descriptor, payloadKind }`, где kind только `audio` или `transcript`.
`serializeLocalMaterialBinding` возвращает immutable JSON string — фиксированный
массив из 16 позиций: domain `ORION:LOCAL-MATERIAL:BINDING`, format version `1`, kind,
descriptor schema, audience, user/issuer/subject/org/facility/assignment/patient/
encounter, localMaterialId, recordingRunId, revision. Порядок полей исходного object
не влияет; Unicode не нормализуется и значения не склеиваются разделителем.
Outer и вложенные поля строго проверяются; исключения общие, без входных значений.

Будущий reviewed crypto adapter сможет отдельно кодировать эту строку в UTF-8
для authenticated metadata. Сейчас это **не** AEAD/ciphertext/MAC/signature,
key-release service или доказательство подлинности descriptor. Нет key/nonce/ID
allocation, IO, persistence, UI, v1 migration или дешифрования. Формат не охватывает
параметры будущего cipher: их связывание/валидация — отдельный обязательный gate.
Независимая source review не нашла actionable issues. **94 новых codec tests PASS**;
после frozen исходников полный unit project — **100 files / 1391 passed / 1 opt-in
skipped**,51.77s. Lint/typecheck/secrets620/diff-check PASS; полные границы результатов
1C1b и 1C1c — в MASTER_PLAN §13. SQL/build/browser повторно после codec не запускались.

### 1C1d/e — инженерная архитектура и изолированный crypto primitive

[ADR-0003](../adr/0003-local-material-online-key-boundary.md) определяет выбранный
online-first broker/wrapped-DEK подход, матрицу операций/согласий, pending/finalize
и отдельные D1/IndexedDB транзакции. Клиническая retention/withdrawal/offline policy
не утверждена. Полученный браузером ключ нельзя удалённо отозвать; online-only —
правило приложения с остаточным риском, а не гарантия недоступности старой копии.
В clear envelope сохраняются только opaque key reference и crypto parameters;
scope/AAD с IDs восстанавливаются после серверной проверки и не сохраняются там.

Новый `lib/local-materials/envelope.ts` выполняет реальный AES-256-GCM roundtrip
для отдельного payload до 1 MiB, 96-bit nonce/128-bit tag, строгий формат и AAD,
отказ при неверном owner/run/revision/kind/key/header/bytes. Native import только
из 32-byte raw key; произвольный CryptoKey не принимается. Ключ не возвращается
и не сохраняется; caller-owned input не стирается. Sealer одноразовый, но глобальную
уникальность DEK доказывает будущий broker. Intrinsic byte-view checks исключают
обход длины/shared backing через подменённые свойства. Независимое ревью нашло
два таких дефекта начальной версии; оба исправлены и покрыты regression tests.

Это ещё НЕ key-release endpoint, v2 persistence, chunked audio, browser crypto
acceptance или перевод текущей истории. Следующий bounded slice **1C2a**:
durable broker reservation/head/CAS/audit state machine в disposable БД с явно
подставленной wrapping facility; missing facility = отказ, не process Map/default
key. Затем segmented payload contract, IndexedDB pending/reconciliation и два
браузера/вкладки. Не применять миграции к основной БД и не читать/мигрировать v1.
Точные результаты 1C1e и source review — в свежем MASTER_PLAN §13.

### 1C2a1 — постоянный внутренний реестр, без выдачи ключей

Продолжение 24.09.2026 10:35 UTC: добавлены четыре таблицы в аддитивной миграции
`0050_local_material_registry.sql` и `D1LocalMaterialRegistry`. Полная цепочка из
51 миграции проверяется только на собственных disposable SQLite fixtures;
0048–0050 **не применялись к основной БД**.

Реестр хранит неизменяемые owner/material/run/kind/revision, request fingerprint,
session reference, отдельно подготовленную непрозрачную wrapped-key строку и
минимальные события. Резерв живёт 120 секунд по часам БД. `preparing` → `prepared`
ещё не создаёт подтверждённую версию. Вставка receipt проверяет точного
предшественника и атомарно создаёт/продвигает head + `committed` + событие.
Из двух кандидатов на один head публикуется один; другой не перезаписывает его.
Идентичный повтор возвращает прежний результат, изменённый payload конфликтует.
Старый receipt остаётся историческим и явно имеет `currentHead: false` после
следующего commit. Это состояние в момент транзакции, не lease свежести.

Изменение immutable полей, удаление и REPLACE существующих записей блокируются,
terminal `committed`/`retired` не оживают. Пропущенная обязательная запись события,
head или state вызывает rollback, включая `RAISE(IGNORE)`. Adapter проверяет
direct SQL `changes()`, не trigger-inclusive `meta.changes`; результат берётся
из того же batch, без последующего отдельного read. Полный descriptor строго
проверяет adapter; SQL защищает core binding и стабильность owner/run, но не
является полным JSON parser для произвольного прямого SQL.

**Это внутренний слой хранения, НЕ авторизующий broker.** Constructor требует
явные policy/provider IDs, но ID не означает наличие wrapping facility или
утверждённой политики. Реестр не создаёт/проверяет/разворачивает/выдаёт DEK;
тестовая wrapped-строка — искусственное значение, не доказательство key custody.
Session FK проверяет связь владельца, не текущую liveness; supplied authority
fingerprint — наблюдение, не полномочие. В тестах это ограничение закреплено
явно. Методы нельзя подключать к endpoint только после проверки login.

Следующий **1C2a2**: coordinator с явной wrapping dependency (нет зависимости →
отказ), текущей action/consent проверкой внутри каждой committing transaction,
durable preparation/reconciliation, release/retire audit и защитой pending
операций от отзыва/повторного предоставления. Сравнение fingerprint до записи
не закрывает гонку. У memberships/organizations/facilities пока нет enforced
monotonic epoch; disable→enable с прежней version нельзя назвать защищённым ABA.
Нужен отдельный обоснованный fence/terminal invalidation и revoke/regrant tests.
Затем реальный workerd/D1, encryption integration, v2 IndexedDB и browser gates.

Изолированные SQL проверки, independent review и точные общие команды — новый
ledger MASTER_PLAN §13. Hash/receipt не проверяет наличие локального ciphertext,
не сохраняет аудио на сервере и не является подписанным протоколом. Обычная
история браузера, текущие записи/порты, клинический API и реальные ресурсы не
подключены и не изменены этим этапом.

### 1C2a2-fence — отзыв ожидающей подготовки при изменении полномочий

24.09.2026 добавлена forward-only миграция0051, только для изолированной приёмки.
Девять AFTER triggers отслеживают INSERT/UPDATE/DELETE организаций, филиалов и
memberships; успешный REPLACE и смена полномочий A→B→A с прежней version переводят
затронутые preparing/prepared в terminal authority_changed. Зафиксированные receipts,
heads и прежние terminal records не меняются. Косметические/no-op/ignored изменения
сами по себе не уничтожают действующую подготовку. При установке миграции прежние
pending rows отзываются: их историю полномочий нельзя доказать задним числом.

Отзыв и событие выполняются в той же транзакции: проигнорированный/упавший guard
приводит к rollback изменения полномочий. Проверены recursive_triggers=0/1,
уникальные коллизии REPLACE, scopes, rollback, reopen и смена непосредственно перед
batch. Постоянный набор — 80 SQL tests; независимый adversarial review — 59 сценариев.
Точные команды и общие regression gates находятся в MASTER_PLAN §13.

Это только три источника invalidation, не полный coordinator. Текущие session,
assignment/relationship, patient lifecycle, consent/action и wrapping dependency
по-прежнему нужно соединить и проверить в committing SQL. Новые endpoints, ключи,
v2 browser IO не включены; основная БД не получала0048–0051, v1 не читается/не
переназначается/не удаляется. Следующий этап остаётся 1C2a2-coordinator.

### Исторический read-only аудит, который привёл к 1C1b

До storage/crypto wiring сделать неподключённый строгий envelope descriptor и
тесты exact owner/scope + material/run/revision. Он должен отделять identity от
текущего authority fingerprint: смена поколения не переписывает владельца.
Не считать descriptor полномочием или шифрованием; не сохранять sensitive bytes.

Read-only follow-on audit конкретизировал этот следующий шаг:

- Предложенные тогда `descriptor.ts`/tests: schema discriminator, immutable exact staff
  owner (user/issuer/subject/org/facility/assignment/patient/encounter),
  `localMaterialId`, `recordingRunId`, positive revision. Format теперь закреплён
  описанным выше 1C1b. Ни display name/role/email, ни encounter ID не заменяют material ID.
- Authorization fingerprint и пять consent pins остаются в **контексте операции**,
  не в immutable owner. Новое generation не «переименовывает» старый материал.
  Новая запись того же приёма получает новый run/material; hydration не создаёт их.
- Тесты: same encounter + different run/material, same owner + changed revision,
  same revision + different owner, A→B→A, late recorder stop/autosave/rename/export,
  wrong/extra/accessor/inherited fields, immutable copy. Pure match не равен
  успешному DB CAS или разрешённой сервером операции.
- Риски текущих consumers по исходникам: `resetSession` читает current ref после
  `await speech.stop()`; autosave/rename после await обновляют по encounter ID;
  ZIP публикуется после асинхронной сборки без exact material/run fence; player key
  `encounterId + audio.size` может сохранить прежний Blob одинакового размера.
  Существующие recorder run/epoch guards сохранять, но результат Blob необходимо
  связать с captured descriptor. Это source-level findings, не потеря данных,
  воспроизведённая на основной истории. Эти consumers **пока не изменены**.

Затем отдельно выбрать и проверить envelope encryption/key-release, retention,
restore/revocation и CAS/transactional fencing. Нельзя «временно» класть plaintext
ключ рядом с ciphertext или включать v2 persistence без этих gates.

1C1 не закрыт. Независимые key/retention/restore и browser gates сохраняются;
основная история не затронута. Runtime findings выше не проверялись
на пользовательских данных; source-level overwrite не объявляется установленной
потерей записи. 1C1–1C4, реальное хранилище v2, encryption/key policy и двухтабовая
приёмка остаются открытыми. Следующий исполнитель начинает с актуального 1C2a2
coordinator/action contract выше, не с автоматической миграции истории.

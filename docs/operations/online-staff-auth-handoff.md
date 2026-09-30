# ONLINE-1B — отдельные сотрудники и серверные сессии

Дата проверки кода: 24.09.2026. Статус: **серверные сессии, индивидуальные credentials,
общий staff principal resolver и изолированный технический transport реализованы;
основной интерфейс и браузерная активация ещё не подключены**.
Главный порядок работы: `docs/MASTER_PLAN.md`, раздел ONLINE-1. Только искусственные
данные; эту работу нельзя заменять публикацией текущего dev-сервера.

Актуализация 24.09.2026 после UI checkpoint: `/sign-in` и новая страница выхода
уже реализованы и проверены для существующего Sites development-входа. Это
**не** подключение индивидуальных паролей. Отдельные entry screens нельзя считать
закрытием ONLINE-1B. Запрет владельца: не трогать ничего, связанное с dir echoes,
на GitHub/Vercel/Neon и других сервисах. Работать только в существующем ORION
репозитории `https://github.com/shadowuneed/ORION-CLINIC.git`, не создавать новый.

## Выполненный foundation checkpoint

- `lib/auth/staff-session.ts`: выдача непрозрачного случайного токена, SHA-256 перед
  хранением, строгая cookie без fallback на Sites/Authorization, защищённые cookie
  и независимый POST logout handler. Он **не подключён к маршрутам** приложения.
- `lib/repositories/staff-sessions.ts`: создание, проверка, продление idle-срока,
  отзыв одной/всех существующих сессий через D1. Два врача одной роли сохраняют
  разные `user_id/issuer/subject`; роли и назначения проверяются отдельно в D1.
- Аддитивная миграция `drizzle/0048_staff_sessions.sql`, схема и Drizzle metadata.
  В основную `.wrangler/state` миграция не применялась. Тесты применяют полную
  цепочку миграций только в изолированной БД.
- Сроки по часам БД: idle 30 минут, максимум 8 часов. Смена версии/identity/status
  сотрудника отзывает старые сессии; реактивация не восстанавливает их. SQL REPLACE
  не обходит отзыв. Обновление и проверка результата отзыва проходят в одном batch.
- Logout требует точного настроенного HTTPS origin и POST. При сбое отзыва — 503,
  без ложного успешного выхода/очистки cookie. Браузерная история и аудио не удаляются.

Проверено **77 тестами**: 44 unit и 33 repository. Последние включают файловую
SQLite с двумя соединениями, закрытие/переоткрытие и цепочку выдача → cookie →
повторное открытие БД → POST logout → отказ на другом соединении. Это настоящий SQL
с D1-адаптером, не испытание remote D1 или браузерного login. Общие результаты
проверок и ограничения записываются в Verification ledger главного плана.

`issueStaffSession` принимает grant **только после отдельной серверной проверки
учётных данных**. Нельзя превращать его в endpoint, принимающий `userId`/роль от
браузера. `revokeAll` не запрещает будущий проверенный вход; сброс пароля должен
также менять версию учётной записи в своей атомарной операции.

## Что подтверждено в текущем коде

| Место | Ограничение |
| --- | --- |
| `vite.config.ts` | `sites()` обслуживает текущий development-вход; новый staff runtime нельзя незаметно смешать с автологином. |
| `lib/auth/site-identity.ts` | API извлекает identity из заголовков доверенного Sites-контура. Эти заголовки сами по себе не подтверждают личность в самостоятельном публичном runtime. |
| `app/chatgpt-auth.ts` | SSR извлекает того же пользователя отдельно; API и страницы должны перейти на единый проверенный principal. |
| `scripts/local-account-auth.ts` | Не подключён к основному runtime; только четыре фиксированных subject по ролям, сессии и ограничение попыток в памяти процесса. Два разных врача не представлены. |
| `lib/auth/chatgpt-navigation.ts`, `app/clinic-shell.tsx`, `app/signed-out/page.tsx` | Навигация входа/выхода пока связана с Sites. Страница «Сеанс завершён» сама по себе не доказывает отзыв серверной сессии. |
| `lib/encounter-history.ts` | IndexedDB не хранит владельца записи. Даже правильный новый login не изолирует прежнюю локальную историю; это отдельный обязательный ONLINE-1C. |

Не менять `node_modules`, не доверять входящим identity-заголовкам и не снимать
loopback-ограничение с заготовки local-account-auth. Упомянутый ею
`CONFIGURE_LOCAL_ACCOUNTS.bat` отсутствует — его нельзя выдавать за рабочую настройку.

## ONLINE-1B2 — реализованные credentials без активации

`lib/auth/staff-login.ts` принимает только `login/password`: точный HTTPS origin,
POST, ограничение потока 8 KiB и 5 секунд, строгий JSON, без клиентских role/userId/
issuer/subject/grant. Сессия новая; входящий cookie и Sites headers не выбирают
личность. Ошибки БД, аудита, криптографии и выдачи сессии не дают cookie/успеха.
Проверенный snapshot credential нельзя подменить новой версией после KDF.

`staff-password.ts` использует фиксированный версионированный scrypt-профиль
N=32768/r=8/p=3, соль 16 байт, digest 32 байта, maxmem 64 MiB; произвольные параметры
из БД не исполняются. Неизвестная/disabled учётная запись проходит такой же KDF,
но не получает grant. Это не доказательство constant-time всего HTTP-пути.
Повреждённый hash после dummy KDF даёт unavailable, а не слабый fallback.
Пароли не обрезаются/нормализуются: минимум 15 Unicode codepoints при настройке,
до 1024 UTF-8 bytes; некорректные surrogate-последовательности отклоняются.
Логин — ASCII 3–128 символов, lowercase, обычные окружающие пробелы допустимы;
проверка ASCII **до** lowercase не допускает alias Unicode Kelvin sign → `k`.

В `staff-credentials.ts` и аддитивной миграции **0049**: один индивидуальный login
на user, версия/статус credential, неизменяемый audit lifecycle и durable attempts.
Пять попыток за скользящие 300 секунд резервируются **до** KDF, включая unknown,
disabled, успешные и незавершённые попытки. Reservation живёт 120 секунд, выдача
grant однократна. Время берётся из БД; успех не стирает конкурентные попытки.
Provision/reset/credential-disable атомарно меняют `users.version`, отзывают
прежние сессии и блокируют уже проверенный старый grant. Отключение credential
не меняет клинические роли или `users.status`; reset — отдельный явный новый шаг.
Текущий login требует совпадения user epoch: изменение identity/status/epoch
не оживляет credential или старую сессию автоматически.

Это **внутренние команды хранения**, не готовый admin endpoint: будущий caller
обязан отдельно проверить право provisioning/reset/disable. Наличие активного
actor само по себе не даёт административные полномочия. Прикладные назначения
и права по-прежнему находятся в access model, не в пароле.

Проверки включают настоящую файловую SQL-БД с полной цепочкой миграций, два
соединения, reopen, default scrypt → login → cookie → logout, независимость двух
сотрудников и reset во время KDF. D1 `meta.changes` включает trigger writes:
публикация lifecycle использует прямой `changes()` receipt в том же batch.
Точные финальные числа/ограничения — в Verification ledger MASTER_PLAN.
Основные 0048/0049 **не применялись**, вход 3200 остаётся development Sites.

ONLINE-1C0 теперь имеет отдельный tested lifecycle helper, но действующая история
пока не защищена этим кодом. Аудит обнаружил unowned v1 и source-level риск
перезаписи аудио при hydration/autosave; пользовательские записи для проверки не
изменялись. Перед любым main auth switch прочитать
[план изоляции локальных материалов](local-material-isolation-plan.md).
Проверенный DTO/generation fence не заменяет шифрование, серверное полномочие,
реальную IndexedDB transaction и двухтабовую приёмку.

Проверенные основания: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
и [Workers crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).
Argon2 доступен в локальном Node, но исключён из Workers crypto; scrypt API есть,
однако Node unit tests не подтверждают CPU/память/нагрузку Workers. Два параллельных
KDF ограничены в процессе без неограниченной очереди паролей; это не общий limiter.

**До активации остаются:** безопасная первоначальная настройка/сброс без пароля в
чате, policy запрещённых слабых/скомпрометированных паролей, MFA/recovery по выбранной
identity policy, trusted-edge/global abuse limits против множества разных login,
retention/purge attempts и backup invalidation. Нельзя публично включить этот
обработчик, сославшись только на зелёные тесты. Результат — основа 1B2, не весь 1B.

## Исторический scope ONLINE-1B2

Сначала закончить проверяемую основу credentials, затем подключать runtime.
Ниже исходный checklist; реализованные части и границы описаны выше:

1. Аддитивная схема индивидуального normalized login → user, версии credential,
   статуса и durable попыток входа по часам БД. Проверить следующий свободный номер
   миграции. Не хранить роль в credential; назначения остаются в access model.
2. Reset/replace/disable credential атомарно меняет `users.version`, чтобы запретить
   не только старую сессию, но и grant, проверенный до сброса. Сохранить guards для
   прямого SQL/REPLACE, rollback, повторов и гонки до выдачи cookie.
3. Неподключённый к main server-only POST login: точный HTTPS origin, ограниченный
   payload, проверка пароля, durable ограничитель, нейтральный отказ для неверного,
   отсутствующего и disabled аккаунта. Клиент не передаёт доверенный grant/userId/
   issuer/subject/role. При отказе БД, аудита или session issuance — без cookie и
   без успеха. Хеш/пароль/токен не выводить в лог или ответ.
4. Изолированная полная migration chain, два соединения файловой БД и reopen:
   два врача одной роли, неверный/неизвестный login, disable/reset между verifier
   и issuance, конкурентный throttling, рестарт, forged identity, CSRF,
   malformed/oversized payload и отказ БД. Основную 0048 и новую миграцию не
   применять автоматически к работающей БД.

Алгоритм и стоимость verifier требуют проверки совместимости с целевым runtime
и актуальных рекомендаций. Не копировать парольные параметры dev scaffold как
production-решение. Этот checkpoint не должен открывать публичную регистрацию,
выдавать новые реальные права или переключать текущие 3200/3101.

## ONLINE-1B3 — подключение только изолированного HTTPS runtime

### ONLINE-1B3a — общий principal и технический transport, 24.09.2026

Реализован отдельный, **не подключённый к main app** checkpoint:

- [lib/auth/server-principal.ts](../../lib/auth/server-principal.ts) — один
  staff-only resolver для будущих SSR/API adapters. Dependency injection принимает
  `StaffSessionRepository`; cookie проходит существующую строгую проверку и SHA-256
  lookup. Нет imports Sites/framework/env, выбора identity из forwarded headers,
  process-wide кеша principal или fallback после отказа БД.
- Результат различает `authenticated`, `unauthenticated`, `unavailable`.
  Отсутствующий/некорректный/отозванный cookie не даёт identity; ошибка БД,
  криптографии или неверный adapter result не превращается в анонимный успешный
  fallback. Срок и текущий user epoch определяет repository по часам БД, а не
  повторная проверка через `Date.now` в adapter.
- Возвращается только immutable projection: `identity.user.id` — **внутренний
  `users.id`**, `identity.principal.issuer/subject` — точная внешняя identity.
  Они не взаимозаменяемы. Display name/email берутся из подтверждённой БД; роли,
  assignments, cookie, token hash, пароль и полная session row не сериализуются.
  Scalar validation отклоняет C0/C1 и isolated surrogates; корректные Unicode
  pairs и допустимый текст не нормализуются в другую identity.
- [lib/auth/staff-runtime.ts](../../lib/auth/staff-runtime.ts) — отдельная factory
  `createStaffVerificationRuntime`, не alias для старых main handlers. Она
  обслуживает только `POST /api/staff/login`, `POST /api/staff/logout`,
  `GET /api/staff/session`, `GET /staff` и технический `GET /sign-in`.
  Клинических маршрутов, provisioning endpoint и работающей login form нет.
  HTML `/staff` — server-rendered technical identity proof, **не Vinext/React
  клиническая SSR-страница**. `/api/patients` и другие main routes не открываются.
- Origin задан сервером как точный HTTPS origin, не берётся из `Host` или
  forwarded headers. Пути/методы фиксированы, query/fragment selectors запрещены;
  Origin/Fetch Metadata проверяются. SSR anonymous получает только фиксированный
  redirect `/sign-in`, API — `401`; unavailable — `503`, без ложного login/logout.
  Ответы private/no-store, HTML attributes/text экранируются, задан строгий CSP.
  Проверенная identity всё ещё не означает clinical assignment/consent authority.

Проверка pure contracts: **68 principal tests + 37 transport unit tests** в
[server-principal.test.ts](../../lib/auth/server-principal.test.ts) и
[staff-runtime.test.ts](../../lib/auth/staff-runtime.test.ts). Они проверяют
hostile identity headers, malformed adapter results, immutable copies, повторный
DB lookup, независимые A/B ответы, origin/method/route denial, отсутствие утечки
session row, безопасный SSR и отличие `401/303` от `503`. Это не browser acceptance.

### Actual TLS/D1 harness и точные пределы доказательства

[lib/auth/staff-runtime.integration.test.ts](../../lib/auth/staff-runtime.integration.test.ts)
поднимает disposable loopback Miniflare/workerd с настоящим D1 и отдельным
случайным database ID. Он применяет полную migration chain только к новой fixture,
проверяет реальный Worker scrypt/login, одинаковую SSR/API identity двух разных
сотрудников, logout, reopen без reseed, reset/disable и отказ старым credentials.
Итоговые команды, количества, длительность и aggregate/build evidence находятся
в **Verification ledger, разделе 13 [MASTER_PLAN](../MASTER_PLAN.md)**; результаты
предварительных прогонов не подменяют финальный gate.

Read-only peer review harness подтверждает ограничения в исходниках:

- Временный каталог создаётся через `mkdtemp`, не указывает на main
  `.wrangler/state`. Перед recursive cleanup проверяются `realpath`, точный parent,
  специальный prefix и совпадение абсолютного root. Runtime сначала disposed;
  reopen использует те же собственные fixture files и тот же выбранный origin.
- Порт резервируется на `127.0.0.1:0`, 3200/3101 исключены; ошибка bind не должна
  незаметно менять настроенный origin. Runtime проверяет фактически bound origin.
- Не загружаются main Vite/Wrangler config или env files. Inherited env names
  обнуляются без чтения provider values, кроме необходимых OS execution paths;
  Worker получает только свой origin и isolated D1. Outbound application/provider
  traffic возвращает `503`, telemetry выключена. Это не проверка внешних сервисов.
- Shared development certificate извлекается из закреплённой версии установленного
  Miniflare; извлекается только публичный CERT, не выводится ключ. CA/hostname/срок
  проверяются. Доверие задано **только scoped Node `https.Agent`** с
  `rejectUnauthorized: true`; отдельные отрицательные проверки отклоняют
  недоверенный сертификат и неверный hostname.

**Это НЕ доверенный HTTPS для браузера.** Shared dev certificate нельзя ставить
в system/browser trust или применять для реальных credentials. Настройка
доверенного browser HTTPS пока отсутствует; system trust не менялся, обхода
certificate warning не было и такой обход не является приёмкой. Node-клиент
явно передаёт Cookie: тест проверяет cookie flags в HTTP и серверный отзыв,
но не доказывает реальное browser enforcement Secure/SameSite/HttpOnly.
Harness не проверяет React hydration, клинические exact assignments, одновременные
экземпляры сервиса, production latency/load, remote D1/R2 или auth backup restore.

Основной 3200 остаётся Sites development runtime; **0048/0049 в main не применены**.
Main app/config не импортируют новый verification runtime. Foundation не выдаёт
новых живых прав и не разрешает публиковать development identity.

### Карта будущей миграции main consumers — ещё не выполнена

Существующий `ChatGPTUser.userId` означает Sites subject, а не внутренний staff
user ID. Нельзя заставить новый resolver писать `oai-authenticated-*` заголовки
или подключить его через alias, сохранив старую reconstruction principal.

| Current source | Что потребуется только в согласованном isolated adapter slice |
| --- | --- |
| `lib/auth/site-identity.ts` | Сохранить как явный Sites adapter для текущего main. Staff source не использует его как fallback и не преобразует staff identity обратно в Sites principal. |
| `app/chatgpt-auth.ts` | Будущий SSR adapter читает cookie через общий resolver; anonymous redirect отдельно от unavailable. Не объявлять DB outage отсутствием сессии. |
| `app/authenticated-clinic-page.tsx` | `getAuthenticatedClinicContext` передаёт verified principal дальше вместо `toSiteIdentityPrincipal({ id: user.userId, ... })`. Навигационные capabilities не являются полномочием на действие. |
| `app/workspace-assignment-boundary.tsx` | `WorkspaceAssignmentBoundary` получает exact principal, сохраняет scoped selection/deny и не объединяет назначения. |
| `app/access/page.tsx`, `app/access/manage/page.tsx` | Убрать повторное Sites reconstruction только при подключении staff variant; сохранить проверки доступа и current assignment. |
| 47 direct API files под `app/api/**/route.ts`, включая `app/api/workspace/route.ts`, `app/api/patients/route.ts`, `app/api/workspace/transcript/speech/session/route.ts` | Заменить synchronous `getSiteIdentity` на awaited общую auth boundary, с обработкой отказа внутри error boundary. Exact-assignment/audit/transactional guards остаются; ранняя identity-проверка сама по себе не отменяет уже начатую transaction после concurrent logout. |
| `lib/auth/clinical-tool-access.ts` | Отдельная общая точка для `app/api/clinical/analyze/route.ts`, `app/api/clinical/research/route.ts`, `app/api/local-speech/health/route.ts`, `app/api/local-speech/session/route.ts`, `app/api/local-speech/transcribe/route.ts`. Перенести источник principal, сохранив exact doctor assignment и scope; не делать identity-only разрешение STT/AI. |
| `lib/http/access-administration-api.ts` | Общая точка для `app/api/access/admin/route.ts`, `app/api/access/admin/departments/route.ts`, `app/api/access/admin/departments/[departmentId]/route.ts`, `app/api/access/admin/assignments/route.ts`, `app/api/access/admin/assignments/[assignmentId]/route.ts`. Staff authentication не заменяет административное полномочие. |
| `lib/auth/chatgpt-navigation.ts`, `app/clinic-shell.tsx`, `app/sign-in/page.tsx`, `app/signed-out/page.tsx` | Staff variant использует собственные формы/POST logout и truthful session state, не Sites GET navigation. Safe return path не должен превратиться в open redirect. |

Число 47 — source inventory на этот checkpoint, не число мигрированных handlers.
Повторная проверка: `rg -l 'getSiteIdentity' app/api --glob '!*.test.*'`.
Новые staff modules не подключаются разом к этим callers без route-by-route
regressions; незащищённые/непереведённые routes в isolated runtime остаются закрыты.

### Следующий безопасный ONLINE-1B3b — ещё не выполнен

1. Спроектировать и проверить отдельный composition/config/launcher с независимыми
   state/env/cache, free loopback port, synthetic-only DB и без provider keys.
   Не запускать его поверх 3200/3101 и не направлять main браузерный профиль на
   новые identity до ONLINE-1C. Для минимального auth-only шага R2 вообще не нужен;
   при подключении object storage он обязан быть отдельным.
2. Закончить безопасное первоначальное provisioning/reset: проверенный оператор
   и точные полномочия, audited lifecycle, ввод секрета не через чат, URL,
   argv/logs или общий пароль роли. Тестовые fixture commands не являются готовым
   административным интерфейсом. Не менять реальные назначения ради теста.
3. До browser acceptance выбрать явно разрешённый, действительно доверенный
   HTTPS test origin. Не менять системное доверие, не устанавливать shared dev CA
   и не обходить предупреждение браузера. Если такой origin недоступен, сохранить
   gate открытым и продолжать unmounted формы/adapter tests, не ослабляя cookie.
4. Подключить login/POST logout формы и ограниченный auth-only SSR/API surface
   к одному resolver в disposable browser profile/origin. Сначала проверить
   anonymous, wrong/unknown login, unavailable DB, CSRF и absence of Sites fallback;
   не открывать весь clinical route tree через совместимость заголовков.
5. Выполнить два браузера/две отдельные identity: login → одинаковый SSR/API
   principal → reload/restart → logout/reset/disable → direct URL/API denial;
   проверить старую вкладку, expiry, cookie enforcement и реальные ошибки UI.
   Затем отдельно подключать точные clinical assignments с отрицательными tests.
6. Main migration/auth switch — только отдельным решением после ONLINE-1C и
   deployment/recovery/abuse gates. Действующий unowned v1 history остаётся
   нетронутым: никакого автоматического чтения/присвоения/копирования/удаления.
   Проверенный 1C0 helper не закрывает encryption, material/run/revision binding,
   transactional fencing, cross-tab logout и legacy transition; см.
   [план изоляции локальных материалов](local-material-isolation-plan.md).

### Исторический общий scope ONLINE-1B3

Исходный список ниже сохраняется для контекста; актуальное разделение выполненного
1B3a и следующего 1B3b приведено выше. Он не является разрешением main switch.

1. Подготовить изолированный loopback runtime с отдельной D1/R2 без provider keys,
   по образцу `vite.personas.config.ts`. Не переносить выбор роли кнопкой из persona
   middleware и не менять пользователя/назначения основного 3200. Для проверки
   Secure cookie использовать доверенный HTTPS test origin, не ослаблять публичную
   политику ради HTTP. Порт выбрать только после проверки слушателей.
2. Добавить индивидуальные учётные данные сотрудников, безопасную первоначальную
   настройку и серверный verifier. Не выдавать общие пароли «врачу/медсестре/админу»
   и не запрашивать пароли в чате. Проверить актуальные требования к алгоритму
   хранения и его поддержку выбранным runtime перед реализацией.
3. Подключить один проверенный principal к SSR и API, без fallback на переданные
   клиентом identity-заголовки. Права остаются в текущих assignments, без их union.
4. Подключить login/POST logout и формы, durable ограничение попыток, административный
   аудит и reset/disable. Не использовать process Map в качестве общей сессии или
   ограничителя. Обработать ошибки БД без ложного успеха.
5. Выполнить browser acceptance двумя сотрудниками одной роли и разными ролями:
   login → переходы SSR/API → logout → отказ прямому URL/API/старой вкладке.
   Отдельно — CSRF, expiry, disable, reset, два экземпляра и рестарт runtime.
6. Только после ONLINE-1C и одобренного deployment-контекста переключать основной
   runtime. Foundation checkpoint не равен готовому публичному входу.

При реализации читать существующие ограничения password/session lifecycle и
проверять актуальную документацию выбранного runtime. Этот документ не выбирает
IdP, алгоритм парольного хранения, домен, платный тариф или обработчика медицинских
данных за владельца.

## Приёмка и оставшиеся этапы

- Последующий ONLINE-1C1a добавил неподключённый metadata-only resolver и один
  coherent SQL snapshot текущей session/user, exact assignment/relationship,
  patient profile и пяти consent heads. 76 unit + 35 real-SQL тестов; ограничения
  в `local-material-isolation-plan.md` §8. Последующий 1C1b добавил immutable exact
  material/run/revision descriptor и композицию publication fence; 124 + 87 новых
  unit tests. Затем 1C1c добавил pure canonical binding codec, без encryption/ключей.
  1C1d/e добавили ADR-0003 и изолированный AES-GCM primitive (без key custody/
  выдачи, action authorization, IO и подключения истории); следующий 1C2a —
  durable broker/head/CAS/audit в disposable БД. Подэтап 1C2a1 теперь добавил
  внутренний SQL registry + миграцию0050: reserve/prepare/receipt/head/events,
  terminal states и точный replay. Это **не** авторизующий broker: 1C2a2 ещё
  должен соединить current action/consent SQL и явную wrapping facility;
  policy/provider IDs и session FK сами по себе не дают полномочия. Основные
  0048–0051 не применены. Последующий 1C2a2-fence в изолированной БД добавил
  terminal invalidation pending-preparations при изменении organization/facility/
  membership, включая ABA и REPLACE. Это не coordinator, key release или
  разрешение на клиническую операцию; остальные authority/consent checks остаются.
  Это не main identity
  migration, key release или разрешение на материал. Все нижеследующие browser,
  provisioning, isolation и recovery gates остаются обязательными.
- Foundation тесты двух сотрудников одной роли, подделки identity, переоткрытия БД,
  отзыва/expiry/disable и отсутствия fallback выполнены; технический 1B3a проверяется
  отдельно выше, основной clinical runtime с staff identity ещё не подключён.
- Для подключённого transport — два браузера, успешный login, общий отзыв сессии,
  запрет прямого API/URL после logout, CSRF и cookie flags. Technical HTTP/TLS harness
  не заменяет эту браузерную приёмку; не заявлять её выполненной.
- Отдельно: создание сотрудников, первое приглашение/пароль, сброс, отключение,
  аудит административных действий и аварийный recovery. Пароли не просить в чате.
- Нужны retention/purge для session tombstones и политика восстановления auth из
  backup. Обычный INSERT исторической сессии блокируется clock guard. Проверка
  восстановления с пустой новой таблицей **не доказывает** восстановление базы с
  активными сессиями. После восстановления запрещено оживлять токены, отозванные
  после backup; требуется отдельный проверенный механизм массовой инвалидизации.
- Перед внешним доступом: ONLINE-1C — история/аудио по владельцам, отзыв доступа,
  старые вкладки и управляемое восстановление прежних записей без владельца.
  Не присваивать их автоматически следующему вошедшему и не удалять молча.
- Основные web 3200 и STT 3101 оставить работающими. Полный переход выполнять
  отдельно, после выбора хостинга и проверенной миграции, а не при разработке foundation.

## Проверенные технические основания

- D1 batch — транзакционный rollback всей последовательности при ошибке:
  [Cloudflare D1 Database](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
- Случайные непрозрачные session ID, защищённые cookie и серверный отзыв:
  [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
- Origin и Fetch Metadata как отдельная проверка запросов изменения состояния:
  [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

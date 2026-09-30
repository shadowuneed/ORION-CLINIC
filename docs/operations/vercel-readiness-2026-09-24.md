# ORION Clinic — готовность к Vercel, 24.09.2026

Статус: **аудит и подготовка, не развёртывание**. Действующий локальный продукт
нельзя публиковать как статический `dist` или автоматически превращать в
производственный Next.js-проект. Цель остаётся закрытым пилотом с искусственными
записями и настоящими операциями БД. Реальные медицинские данные не разрешены.

## Повторная попытка по запросу владельца, 24.09.2026 16:48 UTC

Перед загрузкой повторно выполнен точный predeploy scan:
`node scripts/check-deployment-artifact.mjs --dir dist` — 479 файлов, **BLOCKED**
`server/.dev.vars`. Значения секретов не выводились. `vercel whoami` вернул
авторизованного пользователя (проверка версии CLI отдельно получила timeout).
Только адресная команда `vercel project inspect orion-clinic --scope shadowocc`
вернула `project_not_found`; общий список проектов не открывался.

После завершения D-R3 и новой успешной сборки проверка повторена: **481 файл,
BLOCKED `server/.dev.vars`**. Это актуальный итоговый артефакт; предыдущие 479 —
до реализации D-R3. Секреты и локальная БД не загружались. Сам D-R3 принят локально
через браузер и реальную изолированную БД, но это не доказательство online-деплоя.

Независимая проверка исходников: Nitro не установлен, Vercel config/link нет,
63 серверных файла приложения импортируют `cloudflare:workers`; клинический
SSR/API всё ещё опирается на доверенный Sites runtime. Удаление одного `.dev.vars`
не создаёт backend D1/R2, индивидуальный вход и STT. Поэтому upload/deployment
не выполнен: это заблокированная предпубликационная проверка, а не успешная
отправка приложения в Vercel. Статическая заглушка или публичный proxy к локальной
dev-сессии не подменяли результат.

Следующий допустимый шаг — отдельная Nitro/Vercel сборка и server runtime boundary
с отказом при отсутствии настоящих backend/auth; затем выделенный постоянный
backend и единый staff verifier. Артефактный guard должен стать обязательной
частью будущей deploy-команды, а не только ручной проверкой. Путь подтверждают
установленный Vinext README и актуальные [Nitro Vercel](https://nitro.build/deploy/providers/vercel)
/ [Vercel Build Output](https://vercel.com/docs/build-output-api), но они не
реализуют привязки ORION за приложение. Чужие ресурсы не использовались.

## Что подтверждено

### Локальный packaging checkpoint, 24.09.2026 17:27 UTC

Усилен реальный preflight, без облачных запросов или изменения runtime. Прежняя
проверка пропускала всё содержимое файла при одном NUL-байте: поэтому UTF-16,
архив или текст с NUL могли ошибочно пройти. Теперь неизвестные бинарные данные
и некорректный UTF-8 отклоняются; обычные бинарные web-assets принимаются только
при согласованных расширении/сигнатуре, WOFF/WOFF2 — ещё и длине заголовка.
Проверка известных токенов выполняется и для разрешённых бинарных assets.
Архивы, документы/БД и их переименованные известные сигнатуры блокируются без
распаковки; private-файлы с backup/date/copy suffix остаются запрещёнными.
Связанный symlink/junction предок каталога отклоняется до обхода его содержимого.

Появились две явные локальные команды:

```powershell
pnpm security:artifact --dir dist
pnpm build:deploy-check
```

Вторая сначала собирает приложение, затем проверяет точный `dist` и возвращает
ненулевой код при блокере. Она **ничего не загружает** и не заменяет Vercel adapter.
Обычный `pnpm build`/dev не изменён. В проверке текущего полного артефакта после
успешной сборки ожидаемо остаётся exit1 из-за `server/.dev.vars` (481 файл).
Client-only112assets проходят, но публикация только их не будет рабочей платформой.
Итоговые regression counts и browser smoke — MASTER_PLAN §13.

Границы: это консервативный packaging detector, не decoder/антивирус, не поиск
медицинских сведений на изображениях и не доказательство отсутствия любого
неизвестного ключа/скрытого содержимого. Сканировать нужно отдельный неизменяемый
артефакт непосредственно перед будущей загрузкой: эта команда не обеспечивает
атомарную заморозку каталога или безопасность последующих изменений. Не обходить
ошибку удалением секретов из пользовательских исходников; упаковка deployment
и local preview должны быть разделены будущим адаптером.

| Область | Факт и точка проверки | Следствие |
| --- | --- | --- |
| Web-сборка | `package.json:11` запускает handbook + `vinext build`; установлен `vinext@1.0.0-beta.8`. `vite.config.ts:99` использует Vinext/Sites/Cloudflare. Текущий результат — `dist/client`, `dist/server` и Workers-конфигурация. | Это ещё не Vercel Build Output. |
| Доступный адаптер | Уже установленный `node_modules/vinext/README.md:417` описывает `nitro/vite` и `NITRO_PRESET=vercel`. `nitro` сейчас не установлен; `vercel.json` и `.vercel/project.json` отсутствовали при аудите. | Поддерживаемый путь существует; отдельная сборка и проверка совместимости ещё нужны. |
| Runtime bindings | 63 серверных файла в `app/` импортируют `cloudflare:workers`; типы `DB: D1Database` и `FILES: R2Bucket` объявлены в `env.d.ts:3`. Примеры: `app/authenticated-clinic-page.tsx:1`, `app/api/patients/route.ts:1`. | Node/Vercel не получает эти привязки из названий environment variables. |
| База и объекты | `wrangler.jsonc:19` содержит локальный placeholder D1 ID, локальные названия D1/R2; `.openai/hosting.json` задаёт только имена привязок. | Это не доказательство существующей удалённой БД или bucket. Локальную `.wrangler/state` нельзя считать облачным хранилищем. |
| Транзакции | Репозитории используют `D1Database.batch`, включая `lib/repositories/patient-registry.ts:821` и `lib/repositories/staff-sessions.ts:112`. | Замена на последовательные независимые HTTP-запросы нарушит rollback, аудит и гарантии отзыва прав. |
| Личность | `lib/auth/site-identity.ts:9` и `app/chatgpt-auth.ts:25` читают Sites-заголовки. Локальный Sites plugin очищает их и устанавливает тестовую личность только в dev middleware; его build hook копирует packaging metadata. | На Vercel входящие `oai-authenticated-user-*` не становятся доверенными автоматически. Публичный перенос без нового серверного verifier недопустим. |
| Staff authentication | Foundation 0048/0049 дополнен общим `server-principal.ts` и неподключённым техническим `staff-runtime.ts`; реальные loopback HTTPS/workerd/D1 tests проверяют два индивидуальных входа, logout/restart/reset/disable. См. `online-staff-auth-handoff.md`. | Общий principal проверен только в техническом runtime. Нет main clinical SSR/API wiring, browser-cookie acceptance, безопасного первоначального provisioning или Workers load proof. Главные 0048/0049 не применялись. Нельзя объявлять готовую online auth. |
| STT | `lib/config/clinical-providers.ts:3` допускает только loopback HTTP; legacy API также фиксирует `127.0.0.1:3101`. | Vercel не может обратиться к речевому процессу на компьютере пользователя по своему loopback. Нужен отдельно защищённый сервис и проверенный контракт. |
| Размеры загрузок | `lib/domain/orders.ts:265` допускает диагностические файлы 10 MiB; `app/api/orders/[requestId]/result/route.ts:115` принимает multipart. Speech chunks ограничены 800 000 bytes. | Лимит Functions 4.5 MB конфликтует с диагностическими файлами, но не с текущим размером speech chunk. |
| Артефакты | В `dist/server` найден файл `.dev.vars`; проверялись только наличие и размер, не значения. | Текущий `dist` не отправлять целиком. Нужны allowlist упаковки и обязательный predeploy scan. |

Официальные основания: [Vinext / Nitro](https://github.com/cloudflare/vinext#other-platforms-via-nitro),
[Nitro на Vercel](https://nitro.build/deploy/providers/vercel),
[атомарность D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[лимиты Vercel Functions](https://vercel.com/docs/functions/limitations).

В main-agent проверке CLI `vercel@59.25.4` авторизация аккаунта подтвердилась;
в `shadowocc` найдены три других проекта, не ORION. Этот checkout не связан с
Vercel-проектом. `wrangler whoami` не подтвердил Cloudflare-авторизацию.
**Прямой запрет владельца:** всё, относящееся к `dir echoes` / `dir-echoes`,
исключено из задачи на любых платформах, включая GitHub, Vercel и Neon. В частности,
Neon `dir-echoes-db` и проект `dir-echoes-voice-router` относятся к другому
хакатон-проекту. Не открывать их репозитории, данные, конфигурацию, deployments,
интеграции, ключи или другие ресурсы; не менять, не связывать с ORION и не
переиспользовать ничего из них. Main agent увидел только названия в прежней общей
инвентаризации, без чтения содержимого или изменений; дальнейшая проверка этих
ресурсов запрещена.

**Репозиторий ORION уже существует:** использовать только
`https://github.com/shadowuneed/ORION-CLINIC.git`. Main agent подтвердил этот адрес
read-only проверкой локального `git remote`; новый репозиторий не создавать,
существующий remote не подменять. Новые инфраструктурные ресурсы для ORION должны
быть выделенными только для ORION и отдельно разрешёнными; это требование не
означает создание нового GitHub-репозитория.
Новые аккаунты, ресурсы, права, секреты, миграции и deployment этим аудитом не созданы.

## Рекомендуемая граница размещения

Самый малый перенос, сохраняющий существующую семантику данных: оставить D1/R2
и транзакционные репозитории в выделенном защищённом Cloudflare backend, а Vercel
использовать для Nitro web/BFF. Серверные вызовы должны быть аутентифицированы,
ограничены конкретным origin/контрактом и не принимать клиентские заголовки
личности за проверенную сессию. Проверка staff session, прав, facility, exact
assignment и lifecycle остаётся обязательной на доверенной стороне каждой
операции. Секреты backend не попадают в клиент или HTML.

Ещё меньший инфраструктурный вариант — Vercel как входной reverse proxy ко всему
Worker-приложению. Это надо честно обозначать как **исполнение приложения на
Workers**, а не native Vercel deployment. Требуются отдельная защита origin,
проверка cookies, redirect/CSRF origin и исключение обхода через прямой Worker URL.
Обычный публичный rewrite сам по себе не решает эти вопросы.

Если необходим именно native Node execution на Vercel, нужна более крупная
адаптация: единая runtime-boundary вместо прямых Workers imports, реальный
совместимый DB/object-storage adapter и перенос auth hook. Смена на Postgres не
является заменой одного connection string: текущие миграции, SQLite triggers и
rollback tests требуют отдельной миграции/повторной приёмки. Не подменять D1
in-memory или временным файловым SQLite в функции.

Для файлов больше 4.5 MB нужен проверенный upload/finalize workflow через отдельный
Worker endpoint или ограниченную прямую загрузку в object storage: короткий срок,
точный key/size/type/actor/scope, reauthorization перед публикацией метаданных,
idempotency и orphan reconciliation. Нельзя просто уменьшить существующие лимиты
или сделать bucket публичным.

## Минимальный следующий локальный implementation slice

Это предложение; установка Nitro и переключение runtime ещё не выполнены.

1. Добавить **отдельный** `vite.vercel.config.ts` с зафиксированной совместимой
   версией Nitro и отдельными cache/output directories. Не менять канонический
   Workers dev, порты 3200/3101 и его данные. Проверять фактический Vercel Build
   Output, а не предполагать, что любой `.output`/`dist` будет исполняться.
2. Ввести server-only runtime contract с явными Workers/Node implementations.
   Без настроенного настоящего backend Node-вариант должен отказать закрыто;
   не выдавать искусственные успешные API-ответы и не читать локальную live DB.
3. В Vercel-сборке исключить Sites dev identity и любое доверие к пользовательским
   `oai-authenticated-user-*`. Подключение индивидуальных staff sessions сделать
   общим для SSR/API; отсутствие verifier — отказ, а не fallback на local user.
4. Проверить сборку/SSR в изолированной среде: protected direct URLs, forged
   headers, logout/revoke, конфигурационные ошибки, safe cookies/CSRF, отсутствие
   secrets/state в public и function bundle, отсутствие влияния на main cache.
   Реальные записи через удалённую БД проверяются отдельным следующим gate.
5. После выбора backend добавить контрактные проверки транзакционного batch,
   audit/idempotency и rollback для cloud adapter. До них публикация клинических
   writers через новый adapter не разрешается.

Main agent добавил `.vercelignore`, `scripts/check-deployment-artifact.mjs` и теперь
46 проверок guard. Наличие guard не исправляет текущий артефакт: `.dev.vars` должен
приводить к отказу публикации. Guard должен применяться к **точному** итоговому
артефакту после финальной сборки. Пример стандарта:
[Vercel Build Output API](https://vercel.com/docs/build-output-api).

## Внешние решения и стоимость

- Vercel Hobby предназначен для личного некоммерческого использования; наличие
  искусственных пациентов само по себе не делает командный клинический продукт
  личным проектом. Условия и платный план должны быть согласованы до такого
  запуска. [Hobby](https://vercel.com/docs/plans/hobby)
- Vercel Authentication может защищать проверочный deployment, но это не роли и
  сессии сотрудников ORION. На Hobby разрешён один внешний пользователь через
  access requests; это не многопользовательская staff-auth система.
  [Deployment protection](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
- D1 Free имеет квоты чтения/записи/хранения; исчерпание квот приводит к ошибкам
  запросов. R2 Standard имеет бесплатную квоту, но это не гарантия нулевого счёта
  при любом использовании. Нужны отдельные ресурсы проекта, лимиты и мониторинг.
  [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
  [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- Постоянный STT compute, его TLS/доступ, лимиты/наблюдение и расходы Groq остаются
  отдельными зависимостями. Нельзя обещать бесплатный always-on STT или передавать
  новые данные внешнему провайдеру без установленной policy/consent.
- Актуальная документация Vercel уже описывает WebSockets beta на всех планах;
  прежнее общее утверждение «Vercel не поддерживает WebSockets» устарело.
  Соединение всё равно ограничено временем функции. Это не делает нынешнюю
  Python/model session автоматически долговечной на Vercel.
  [WebSockets](https://vercel.com/docs/functions/websockets)

Нужные решения: разрешённая архитектура Vercel/backend; отдельный аккаунт/ресурсы
D1/R2 либо утверждённая альтернатива; бюджет/условия; staff provisioning и recovery;
защищённый постоянный STT; retention/backups/restore и online multi-user acceptance.
Текущая локальная зелёная сборка не закрывает эти gates.

## Локальная проверка после исправления dev-cache

Конфигурация заморожена перед общей проверкой. Main agent сообщил 110 test files,
994 passed / 1 skipped и успешный build. Независимая проверка после этого:

- 46 файлов dev cache (`.js` + `_metadata.json`) побайтно не изменились: общий
  SHA256 `549195975db1c9b9ed42c33371d7ae15a6dc3998f3c4dbd132a66ba837f2ed72`
  совпал до/после focused tests, полной suite и build.
- Реальный import из served `next_link.js`:
  `navigation-B9Yf8s9I.js?v=0d519818` — HTTP 200, JavaScript, 493355 bytes.
  Реальные React/react-dom/client imports с `?v=647c6dc5` — HTTP 200.
- Disk metadata `browserHash=39125e23` не является текущим per-entry URL hash:
  Vite намеренно не сериализует индивидуальные hashes. Ручная подстановка этого
  global hash даёт ожидаемый outdated-dependency 504, а не доказательство сбоя UI.
- Web ready — HTTP 200; speech — `ok`, model/speaker — `ready`. Web PID 27128,
  speech PID 5612 не изменились в процессе regression/build.
- Main agent подтвердил browser reload, данные communications и SPA-переход в
  LIVE после build. Нового процесса restart или удаления cache не потребовалось.

Причина исходного отсутствующего chunk: общий `node_modules/.vite` optimizer
cache. Пустая metadata была записана в 00:49:24 рядом с запуском Vitest 00:49:23;
этого недостаточно, чтобы обвинять отдельно последующую production build.
Перенос cacheDir дополнен scope-named plugin: Vite хеширует имена plugins, но не
cacheDir, тогда как прежний app-browser-entry отдавался как immutable на год.
Это устранило смешение старого renderer и новой копии React.

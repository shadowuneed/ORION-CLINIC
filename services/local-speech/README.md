# ORION Local Speech

Самодостаточный локальный STT-сервис ORION Clinic. После однократного скачивания моделей ему не нужны API-ключи, баланс или облачная квота. Сервис слушает только `127.0.0.1:3101`; веб-среда запускается отдельно на `127.0.0.1:3200`.

## Что используется

- На CUDA: `ai-sage/GigaAM-Multilingual` `large_ctc` (600M), закреплённый коммит `3905cd51c3ed4e88c8edf33f3302969ba480a327`. FP16 применяется штатным autocast модели; препроцессинг остаётся FP32.
- На CPU или при нехватке видеопамяти: `ctc` (220M), закреплённый коммит `2f8a57144e6ec3adfd32fe0484d9ea9913305bc8`.
- Для голоса: локальный `sherpa-onnx` + многоязычный CAMPPlus zh/en common advanced. Первая различимая реплика калибрует врача, второй отличный голос — пациента.

GigaAM распознаёт русские и казахские буквы в одной реплике. Модель не выдаёт надёжный отдельный ярлык языка, поэтому API честно возвращает `language: null` и `languageDetection: "not_available"`.

Это не потоковый декодер на уровне отдельных слов: браузер сначала калибрует фон около 0,4 секунды, затем собирает аудио кадрами по 20 мс и закрывает реплику после примерно 0,5 секунды тишины. Сервис отвечает после каждой короткой WAV-реплики; для демонстрации удобны отрезки 2–8 секунд.

## Установка

Из корня проекта в PowerShell:

```powershell
.\services\local-speech\setup.ps1 -Device Auto
```

Команда создаст среду и модели в `%LOCALAPPDATA%\ORION`, установит зависимости и один раз скачает подходящую STT-модель и CAMPPlus. GigaAM `large_ctc` — крупная модель; загрузка и первый запуск могут занять время. Чтобы сначала поставить только зависимости:

```powershell
.\services\local-speech\setup.ps1 -Device Cpu -SkipModels
```

Чтобы заранее сохранить обе STT-модели для автоматического CUDA → CPU fallback:

```powershell
.\services\local-speech\setup.ps1 -Device Cuda -CacheBothSttModels
```

## Запуск

```powershell
.\services\local-speech\start.ps1 -Device Auto
```

По умолчанию запуск строго офлайн и использует уже скачанный кэш. `-AllowModelDownload` разрешает Hugging Face скачать отсутствующую модель во время первого запроса, но для воспроизводимого демо лучше выполнить `setup.ps1` заранее.

Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:3101/health
```

## HTTP-контракт

1. `GET /health`
2. `POST /v1/sessions` с необязательным JSON `{"doctorFirst": true}`
3. `POST /v1/transcribe` как `multipart/form-data`:
   - `audio`: PCM WAV;
   - `session_id`: UUID из шага 2;
   - `utterance_index`: `0`, `1`, `2`, ...
4. `DELETE /v1/sessions/{session_id}`

Пример:

```powershell
$session = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3101/v1/sessions -ContentType "application/json" -Body '{"doctorFirst":true}'
curl.exe -sS -X POST http://127.0.0.1:3101/v1/transcribe -F "audio=@C:\temp\utterance.wav;type=audio/wav" -F "session_id=$($session.sessionId)" -F "utterance_index=0"
Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:3101/v1/sessions/$($session.sessionId)"
```

Есть и raw-вариант без multipart:

```text
POST /v1/sessions/{session_id}/utterances?utterance_index=0&encoding=pcm_s16le&sample_rate=16000&channels=1
Content-Type: application/octet-stream
```

Ответ на реплику содержит `text`, слова с приблизительными `start`/`end`, `speaker`, длительность и время обработки. Поле `speaker.confidence` — некалиброванное косинусное сходство, а не медицинская или биометрическая гарантия.

## Приватность и fallback

- WAV/PCM декодируется из памяти; сервис не создаёт аудиофайлы и не хранит расшифровку.
- В сессии остаются только голосовые embedding-профили. `DELETE` сразу удаляет их из памяти; неактивные сессии автоматически истекают.
- Если CAMPPlus отсутствует или реплика слишком короткая для embedding, API возвращает `speaker.method: "order_fallback"`, `confidence: null` и явный статус причины. Только первая принятая реплика может безопасно получить роль врача по порядку; следующие остаются `unknown`, пока голоса нельзя различить. ORION не изображает чередование людей как надёжную диаризацию.
- Для реального медицинского использования потребуется отдельная проверка качества на живых русско-казахских разговорах и полноценная политика согласия/хранения данных.

Источники моделей:

- GigaAM Multilingual: <https://huggingface.co/ai-sage/GigaAM-Multilingual>
- sherpa-onnx Speaker Identification: <https://k2-fsa.github.io/sherpa/onnx/speaker-identification/>
- CAMPPlus release: <https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models>

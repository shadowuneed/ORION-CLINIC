import type {
  EncounterTranscriptTurn,
  OrionEncounterRecord,
  SuggestionLedgerEntry,
} from './encounter-history';

function safeFilenameDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown-date';
  return date.toISOString().replace(/[:.]/gu, '-');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function rtfEscape(value: string) {
  const normalized = value.replace(/\r\n?/gu, '\n');
  let output = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const codeUnit = normalized.charCodeAt(index);
    if (character === '\n') {
      output += '\\par\n';
    } else if (character === '\t') {
      output += '\\tab ';
    } else if (character === '\\' || character === '{' || character === '}') {
      output += `\\${character}`;
    } else if (codeUnit >= 32 && codeUnit <= 126) {
      output += character;
    } else {
      const signed = codeUnit > 32_767 ? codeUnit - 65_536 : codeUnit;
      output += `\\u${signed}?`;
    }
  }
  return output;
}

function concatBytes(chunks: Uint8Array[]) {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function dosTimestamp(value: Date) {
  const date = Number.isNaN(value.getTime()) ? new Date() : value;
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date:
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
  };
}

function zipHeader(size: number) {
  return new Uint8Array(size);
}

function setUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function setUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

type ZipEntrySource = {
  name: string;
  data: string | Blob;
};

async function buildZip(entries: ZipEntrySource[], modifiedAt: Date) {
  const encoder = new TextEncoder();
  const prepared = await Promise.all(
    entries.map(async (entry) => ({
      name: encoder.encode(entry.name.replace(/\\/gu, '/')),
      data:
        typeof entry.data === 'string'
          ? encoder.encode(entry.data)
          : new Uint8Array(await entry.data.arrayBuffer()),
    })),
  );
  const timestamp = dosTimestamp(modifiedAt);
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of prepared) {
    if (entry.data.byteLength > 0xffffffff || localOffset > 0xffffffff) {
      throw new Error('Архив приёма превышает поддерживаемый размер ZIP.');
    }

    const checksum = crc32(entry.data);
    const localHeader = zipHeader(30);
    const localView = new DataView(localHeader.buffer);
    setUint32(localView, 0, 0x04034b50);
    setUint16(localView, 4, 20);
    setUint16(localView, 6, 0x0800);
    setUint16(localView, 8, 0);
    setUint16(localView, 10, timestamp.time);
    setUint16(localView, 12, timestamp.date);
    setUint32(localView, 14, checksum);
    setUint32(localView, 18, entry.data.byteLength);
    setUint32(localView, 22, entry.data.byteLength);
    setUint16(localView, 26, entry.name.byteLength);
    setUint16(localView, 28, 0);
    localChunks.push(localHeader, entry.name, entry.data);

    const centralHeader = zipHeader(46);
    const centralView = new DataView(centralHeader.buffer);
    setUint32(centralView, 0, 0x02014b50);
    setUint16(centralView, 4, 20);
    setUint16(centralView, 6, 20);
    setUint16(centralView, 8, 0x0800);
    setUint16(centralView, 10, 0);
    setUint16(centralView, 12, timestamp.time);
    setUint16(centralView, 14, timestamp.date);
    setUint32(centralView, 16, checksum);
    setUint32(centralView, 20, entry.data.byteLength);
    setUint32(centralView, 24, entry.data.byteLength);
    setUint16(centralView, 28, entry.name.byteLength);
    setUint16(centralView, 30, 0);
    setUint16(centralView, 32, 0);
    setUint16(centralView, 34, 0);
    setUint16(centralView, 36, 0);
    setUint32(centralView, 38, 0);
    setUint32(centralView, 42, localOffset);
    centralChunks.push(centralHeader, entry.name);

    localOffset +=
      localHeader.byteLength + entry.name.byteLength + entry.data.byteLength;
  }

  const centralDirectory = concatBytes(centralChunks);
  const end = zipHeader(22);
  const endView = new DataView(end.buffer);
  setUint32(endView, 0, 0x06054b50);
  setUint16(endView, 4, 0);
  setUint16(endView, 6, 0);
  setUint16(endView, 8, prepared.length);
  setUint16(endView, 10, prepared.length);
  setUint32(endView, 12, centralDirectory.byteLength);
  setUint32(endView, 16, localOffset);
  setUint16(endView, 20, 0);

  const archive = concatBytes([...localChunks, centralDirectory, end]);
  return new Blob([archive.buffer], { type: 'application/zip' });
}

function formatLocalDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatClock(milliseconds: number | null) {
  if (milliseconds === null) return '--:--';
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function roleLabel(turn: EncounterTranscriptTurn) {
  if (turn.role === 'doctor') return 'Врач';
  if (turn.role === 'patient') return 'Пациент';
  return 'Не определено';
}

function categoryLabel(entry: SuggestionLedgerEntry) {
  if (entry.suggestion.category === 'clarification') return 'Уточнение';
  if (entry.suggestion.category === 'safety') return 'Безопасность';
  if (entry.suggestion.category === 'medication') {
    return 'Лекарственный вариант — не назначение';
  }
  return 'Вариант действия';
}

function patientNameLabel(record: OrionEncounterRecord) {
  return record.patientName?.trim() || 'Не указано';
}

export function acceptedDecisions(record: OrionEncounterRecord) {
  return record.decisions.filter(
    (entry) => entry.status === 'accepted' && entry.acceptedSnapshot,
  );
}

export function buildProtocolRtf(record: OrionEncounterRecord) {
  const accepted = acceptedDecisions(record);
  const body = accepted.length
    ? accepted
        .map((entry, index) => {
          const snapshot = entry.acceptedSnapshot!;
          return [
            `\\b ${index + 1}. ${rtfEscape(snapshot.title)}\\b0\\par`,
            `${rtfEscape(categoryLabel(entry))}\\par`,
            `${rtfEscape(snapshot.clinicianPrompt)}\\par`,
            `${rtfEscape('Основание в расшифровке')}: ${rtfEscape(snapshot.evidenceSegmentIds.join(', '))}\\par\\par`,
          ].join('\n');
        })
        .join('\n')
    : `${rtfEscape('Подтверждённых врачом решений нет.')}\\par`;
  const transcriptBody = record.transcript.length
    ? record.transcript
        .map((turn) =>
          [
            `\\b ${rtfEscape(`[${formatClock(turn.startMs)}] ${roleLabel(turn)} · ${turn.language.toUpperCase()}`)}\\b0\\par`,
            `${rtfEscape(turn.text)}\\par\\par`,
          ].join('\n'),
        )
        .join('\n')
    : `${rtfEscape('Расшифровка разговора отсутствует.')}\\par`;

  const rtf = [
    '{\\rtf1\\ansi\\ansicpg1251\\deff0',
    '{\\fonttbl{\\f0 Arial;}}',
    '\\viewkind4\\uc1\\f0\\fs22',
    `\\qc\\b\\fs32 ${rtfEscape('ORION — ПРОЕКТ ПРОТОКОЛА')}\\b0\\fs22\\par\\par`,
    `\\ql ${rtfEscape('Дата приёма')}: ${rtfEscape(formatLocalDate(record.startedAt))}\\par`,
    `${rtfEscape('Врач')}: ${rtfEscape(record.clinicianName)}\\par`,
    `${rtfEscape('Пациент / название приёма')}: ${rtfEscape(patientNameLabel(record))}\\par`,
    `${rtfEscape('Идентификатор')}: ${rtfEscape(record.id)}\\par\\par`,
    `\\b ${rtfEscape('Подтверждённые врачом решения')}\\b0\\par\\par`,
    body,
    `\\par\\i ${rtfEscape('Документ сформирован алгоритмически только из явно принятых врачом пунктов. Не является подписанным назначением или медицинской картой; требует проверки и подписи врача.')}\\i0\\par`,
    '\\page',
    `\\qc\\b\\fs28 ${rtfEscape('ПОЛНАЯ РАСШИФРОВКА РАЗГОВОРА')}\\b0\\fs22\\par\\par`,
    `\\ql\\i ${rtfEscape('Черновая автоматическая расшифровка. Перед медицинским использованием требуется проверка врачом.')}\\i0\\par\\par`,
    transcriptBody,
    '}',
  ].join('\n');

  if (/[^\x00-\x7f]/u.test(rtf)) {
    throw new Error('RTF содержит неэкранированные Unicode-символы.');
  }
  return rtf;
}

export function downloadProtocol(record: OrionEncounterRecord) {
  downloadBlob(
    new Blob([buildProtocolRtf(record)], { type: 'application/rtf' }),
    `ORION-protocol-${safeFilenameDate(record.startedAt)}.rtf`,
  );
}

export function buildTranscriptText(record: OrionEncounterRecord) {
  const header = [
    'ORION — РАСШИФРОВКА ПРИЁМА',
    `Дата: ${formatLocalDate(record.startedAt)}`,
    `Врач: ${record.clinicianName}`,
    `Пациент / название приёма: ${patientNameLabel(record)}`,
    `Идентификатор: ${record.id}`,
    '',
  ];
  const lines = record.transcript.map(
    (turn) =>
      `[${formatClock(turn.startMs)}] ${roleLabel(turn)} · ${turn.language.toUpperCase()}: ${turn.text}`,
  );
  const footer = [
    '',
    'Черновая автоматическая расшифровка. Перед медицинским использованием требуется проверка врачом.',
  ];
  return [...header, ...lines, ...footer].join('\r\n');
}

export function downloadTranscript(record: OrionEncounterRecord) {
  downloadBlob(
    new Blob([buildTranscriptText(record)], {
      type: 'text/plain;charset=utf-8',
    }),
    `ORION-transcript-${safeFilenameDate(record.startedAt)}.txt`,
  );
}

function audioExtension(mimeType: string | null) {
  if (mimeType?.includes('mp4')) return 'm4a';
  if (mimeType?.includes('ogg')) return 'ogg';
  return 'webm';
}

export function downloadAudio(record: OrionEncounterRecord) {
  if (!record.audio) return;
  downloadBlob(
    record.audio,
    `ORION-audio-${safeFilenameDate(record.startedAt)}.${audioExtension(record.audioMimeType)}`,
  );
}

export function buildAuditJson(record: OrionEncounterRecord) {
  const { audio, ...serializable } = record;
  const audit = {
    ...serializable,
    audio: {
      includedInJson: false,
      availableSeparately: Boolean(audio),
      mimeType: record.audioMimeType,
      bytes: audio?.size ?? 0,
    },
  };
  return JSON.stringify(audit, null, 2);
}

export function downloadAudit(record: OrionEncounterRecord) {
  downloadBlob(
    new Blob([buildAuditJson(record)], {
      type: 'application/json;charset=utf-8',
    }),
    `ORION-audit-${safeFilenameDate(record.startedAt)}.json`,
  );
}

function buildArchiveReadme(record: OrionEncounterRecord) {
  const audioFile = record.audio
    ? `audio.${audioExtension(record.audioMimeType)} — исходная локальная запись разговора.`
    : 'Аудиозапись не создавалась или недоступна.';
  return [
    'ORION — МАТЕРИАЛЫ ПРИЁМА',
    `Дата: ${formatLocalDate(record.startedAt)}`,
    `Врач: ${record.clinicianName}`,
    `Пациент / название приёма: ${patientNameLabel(record)}`,
    `Идентификатор: ${record.id}`,
    '',
    'protocol.rtf — проект протокола из принятых врачом пунктов и полная расшифровка разговора.',
    'transcript.txt — полная подтверждённая расшифровка разговора.',
    'audit.json — журнал всех подсказок и решений, включая корзину.',
    audioFile,
    '',
    'Материалы являются черновыми и требуют проверки врачом.',
  ].join('\r\n');
}

export async function buildEncounterArchive(record: OrionEncounterRecord) {
  const entries: ZipEntrySource[] = [
    { name: 'README.txt', data: buildArchiveReadme(record) },
    { name: 'protocol.rtf', data: buildProtocolRtf(record) },
    { name: 'transcript.txt', data: buildTranscriptText(record) },
    { name: 'audit.json', data: buildAuditJson(record) },
  ];
  if (record.audio) {
    entries.push({
      name: `audio.${audioExtension(record.audioMimeType)}`,
      data: record.audio,
    });
  }
  return buildZip(entries, new Date(record.endedAt ?? record.startedAt));
}

export async function downloadEncounterArchive(record: OrionEncounterRecord) {
  const archive = await buildEncounterArchive(record);
  downloadBlob(
    archive,
    `ORION-visit-${safeFilenameDate(record.startedAt)}.zip`,
  );
}

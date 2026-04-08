/**
 * xlsxWorker.js — XLSX 파싱 전용 Web Worker
 *
 * 메인 스레드에서 { type, payload } 메시지를 수신하면
 * SheetJS로 XLSX를 파싱한 뒤 결과를 postMessage로 돌려준다.
 *
 * 메인 스레드 → Worker  : { type: 'PARSE', payload: { buffer, fileType } }
 * Worker → 메인 스레드  : { type: 'PROGRESS', payload: { step, total } }
 *                         { type: 'DONE',     payload: { rows, headers } }
 *                         { type: 'ERROR',    payload: { message } }
 */

/* SheetJS CDN 로드 (Worker 내부는 importScripts 사용) */
importScripts(
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
);

self.onmessage = function (e) {
  const { type, payload } = e.data;

  if (type !== 'PARSE') return;

  try {
    const { buffer, sheetIndex = 0 } = payload;

    /* ── 1. 진행 상황 알림: 파싱 시작 ── */
    self.postMessage({ type: 'PROGRESS', payload: { step: 1, label: 'XLSX 읽는 중...' } });

    /* ── 2. Workbook 파싱
          cellDates: false → 날짜를 숫자 그대로 (속도 향상)
          sheetStubs: false → 빈 셀 객체 생성 안 함 (메모리 절약)  ── */
    const workbook = XLSX.read(new Uint8Array(buffer), {
      type:        'array',
      cellDates:   false,
      sheetStubs:  false,
      raw:         true,   // 셀 값을 원시 타입으로 읽음 (속도 향상)
    });

    /* ── 3. 진행 상황: 시트 변환 시작 ── */
    self.postMessage({ type: 'PROGRESS', payload: { step: 2, label: '시트 변환 중...' } });

    /* ── 4. 첫 번째 시트(또는 지정 인덱스)를 JSON 배열로 변환 ── */
    const sheetName = workbook.SheetNames[sheetIndex] || workbook.SheetNames[0];
    const sheet     = workbook.Sheets[sheetName];

    /* sheet_to_json: defval='' 로 빈 셀은 빈 문자열 처리 */
    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: '',
      raw:    true,
    });

    /* ── 5. 헤더 추출 (첫 행의 키) ── */
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

    /* ── 6. 완료 알림 ── */
    self.postMessage({
      type:    'DONE',
      payload: { rows, headers, sheetName, total: rows.length },
    });

  } catch (err) {
    self.postMessage({
      type:    'ERROR',
      payload: { message: err.message || String(err) },
    });
  }
};

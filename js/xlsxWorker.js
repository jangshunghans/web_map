/**
 * xlsxWorker.js — XLSX 파싱 전용 Web Worker (최적화 버전)
 *
 * 최적화 포인트:
 *   1) dense: true  → 셀 참조 문자열("A1" 등) 생성 안 함 → 파싱 2~3x 빠름
 *   2) dense array  직접 순회 → sheet_to_json 대비 객체 생성 비용 절감
 *   3) Transferable ArrayBuffer → 복사 없이 Worker로 전달
 *
 * 메시지 프로토콜
 *   Main → Worker : { type:'PARSE', payload:{ buffer } }
 *   Worker → Main : { type:'PROGRESS', payload:{ label } }
 *                   { type:'DONE',     payload:{ rows, headers, sheetName, total } }
 *                   { type:'ERROR',    payload:{ message } }
 */

importScripts(
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
);

self.onmessage = function (e) {
  const { type, payload } = e.data;
  if (type !== 'PARSE') return;

  try {
    const { buffer } = payload;

    /* ── 1단계: Workbook 파싱
         dense : true  → 내부 저장을 2D 배열로 → 셀 key 문자열 생성 없음
         raw   : true  → 원시 값 사용 (포맷 변환 생략)
         cellDates: false → 날짜 변환 생략
         sheetStubs: false → 빈 셀 객체 미생성                          ── */
    self.postMessage({ type: 'PROGRESS', payload: { label: 'XLSX 읽는 중...' } });

    const workbook = XLSX.read(new Uint8Array(buffer), {
      type:        'array',
      dense:       true,    // ★ 핵심 최적화
      raw:         true,
      cellDates:   false,
      sheetStubs:  false,
    });

    /* ── 2단계: 첫 번째 시트 선택 ── */
    self.postMessage({ type: 'PROGRESS', payload: { label: '시트 변환 중...' } });

    const sheetName = workbook.SheetNames[0];
    const sheet     = workbook.Sheets[sheetName];

    /* dense 모드에서는 sheet['!data']가 2D 배열
       !data[row][col] = { v: 원시값, ... } 또는 undefined              */
    const data = sheet['!data'] || [];

    if (data.length === 0) {
      self.postMessage({ type: 'DONE', payload: { rows: [], headers: [], sheetName, total: 0 } });
      return;
    }

    /* ── 3단계: 헤더 추출 (첫 번째 행) ── */
    const headerRow = data[0] || [];
    const headers   = headerRow.map(cell =>
      (cell && cell.v != null) ? String(cell.v).trim() : ''
    );

    /* ── 4단계: 데이터 행을 객체 배열로 변환
         sheet_to_json 대신 직접 순회 → 불필요한 중간 객체 생성 없음    ── */
    self.postMessage({ type: 'PROGRESS', payload: { label: '데이터 추출 중...' } });

    const rows = [];
    const totalRows = data.length;

    for (let r = 1; r < totalRows; r++) {
      const row = data[r];
      if (!row) continue;   // 완전히 빈 행 스킵

      const obj = {};
      let hasData = false;

      for (let c = 0; c < headers.length; c++) {
        const key  = headers[c];
        if (!key) continue;          // 헤더 없는 열 무시
        const cell = row[c];
        const val  = (cell && cell.v != null) ? cell.v : '';
        obj[key]   = val;
        if (val !== '') hasData = true;
      }

      if (hasData) rows.push(obj);  // 완전히 빈 행은 결과에서 제외
    }

    /* ── 5단계: 완료 ── */
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

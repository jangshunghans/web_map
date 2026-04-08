/**
 * ══════════════════════════════════════════════════════════════════
 *  script.js  —  지도 시각화 메인 스크립트
 *
 *  처리 대상:
 *    1) flat 파일  (.xlsx / .csv / .txt)
 *       - X좌표값 → 경도(lng), Y좌표값 → 위도(lat) — 빨간 마커
 *
 *    2) check_all.xlsx
 *       - 위도(latitude) / 경도(longitude) — 파란 마커
 *
 *  XLSX 파싱은 Web Worker(xlsxWorker.js)에서 실행 →
 *  대용량 파일이어도 UI가 멈추지 않음.
 * ══════════════════════════════════════════════════════════════════
 */

/* ──────────────────────────────────────────────
   1. 전역 상태
────────────────────────────────────────────── */
let map;

const layers = { flat: null, check: null };
const counts  = { flat: 0,   check: 0  };

/** 컬럼 이름 후보 목록 (소문자 비교) */
const COL_CANDIDATES = {
  x:   ['x좌표값','x좌표','x_coord','lon','lng','longitude','x','x_lon','경도','easting'],
  y:   ['y좌표값','y좌표','y_coord','lat','latitude','y','y_lat','위도','northing'],
  lat: ['위도','lat','latitude','y','y_lat','y좌표'],
  lng: ['경도','lon','lng','longitude','x','x_lon','x좌표'],
};

/* ──────────────────────────────────────────────
   2. 지도 초기화
────────────────────────────────────────────── */
function initMap() {
  map = L.map('map').setView([37.5665, 126.9780], 7);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  layers.flat  = L.layerGroup().addTo(map);
  layers.check = L.layerGroup().addTo(map);

  console.log('[지도] 초기화 완료');
}

/* ──────────────────────────────────────────────
   3. 커스텀 마커 아이콘
────────────────────────────────────────────── */
function createCircleIcon(color, borderColor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="6" fill="${color}" stroke="${borderColor}" stroke-width="2" opacity="0.85"/>
  </svg>`;
  return L.divIcon({
    html: svg, className: '',
    iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -10],
  });
}

const ICON_FLAT  = createCircleIcon('#e74c3c', '#922b21');
const ICON_CHECK = createCircleIcon('#2980b9', '#1a5276');

/* ──────────────────────────────────────────────
   4. 유틸
────────────────────────────────────────────── */
function findColumn(headers, candidates) {
  const norm = headers.map(h => String(h).toLowerCase().replace(/\s+/g, ''));
  for (const c of candidates) {
    const idx = norm.indexOf(c.toLowerCase().replace(/\s+/g, ''));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function isValidNumber(val) {
  const n = parseFloat(val);
  return !isNaN(n) && isFinite(n);
}

function setStatus(id, msg, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = 'status-msg' + (isError ? ' error' : '');
}

function updateCountDisplay() {
  document.getElementById('flatCount').textContent  = `flat: ${counts.flat}개`;
  document.getElementById('checkCount').textContent = `check_all: ${counts.check}개`;
}

/* ──────────────────────────────────────────────
   5. 로딩 오버레이
────────────────────────────────────────────── */
function showLoader(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<span class="loader-spinner"></span> ${msg}`;
  el.className = 'status-msg loading';
}

function hideLoader(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('loading');
}

/* ──────────────────────────────────────────────
   6. 마커 추가
────────────────────────────────────────────── */
function addFlatMarkers(rows) {
  if (!rows || rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const xCol = findColumn(headers, COL_CANDIDATES.x);
  const yCol = findColumn(headers, COL_CANDIDATES.y);

  if (!xCol || !yCol) {
    setStatus('flatStatus', `❌ X/Y 컬럼 탐지 실패. 헤더: [${headers.join(', ')}]`, true);
    console.error('[flat] 헤더 목록:', headers);
    return;
  }

  console.log(`[flat] 컬럼 — X:"${xCol}", Y:"${yCol}"`);

  let added = 0, skipped = 0;

  rows.forEach((row, idx) => {
    const x = row[xCol];
    const y = row[yCol];
    if (!isValidNumber(x) || !isValidNumber(y)) { skipped++; return; }

    const lat = parseFloat(y);
    const lng = parseFloat(x);

    const popup = `
      <div class="popup-title">📍 flat #${added + 1}</div>
      <div class="popup-row">
        <span class="popup-label">X (경도):</span>
        <span class="popup-value">${lng.toFixed(6)}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Y (위도):</span>
        <span class="popup-value">${lat.toFixed(6)}</span>
      </div>
      ${buildExtraRows(row, [xCol, yCol])}`;

    L.marker([lat, lng], { icon: ICON_FLAT })
      .bindPopup(popup, { maxWidth: 260 })
      .addTo(layers.flat);

    added++;
  });

  counts.flat = added;
  updateCountDisplay();
  setStatus('flatStatus', `✅ ${added}개 마커 (${skipped}개 스킵)`);
  console.log(`[flat] 완료 — 표시:${added}, 스킵:${skipped}`);
}

function addCheckMarkers(rows) {
  if (!rows || rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const latCol = findColumn(headers, COL_CANDIDATES.lat);
  const lngCol = findColumn(headers, COL_CANDIDATES.lng);

  if (!latCol || !lngCol) {
    setStatus('checkStatus', `❌ 위도/경도 컬럼 탐지 실패. 헤더: [${headers.join(', ')}]`, true);
    console.error('[check_all] 헤더 목록:', headers);
    return;
  }

  console.log(`[check_all] 컬럼 — 위도:"${latCol}", 경도:"${lngCol}"`);

  let added = 0, skipped = 0;

  rows.forEach(row => {
    const latVal = row[latCol];
    const lngVal = row[lngCol];
    if (!isValidNumber(latVal) || !isValidNumber(lngVal)) { skipped++; return; }

    const lat = parseFloat(latVal);
    const lng = parseFloat(lngVal);

    const popup = `
      <div class="popup-title">🔵 check_all #${added + 1}</div>
      <div class="popup-row">
        <span class="popup-label">위도:</span>
        <span class="popup-value">${lat.toFixed(6)}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">경도:</span>
        <span class="popup-value">${lng.toFixed(6)}</span>
      </div>
      ${buildExtraRows(row, [latCol, lngCol])}`;

    L.marker([lat, lng], { icon: ICON_CHECK })
      .bindPopup(popup, { maxWidth: 260 })
      .addTo(layers.check);

    added++;
  });

  counts.check = added;
  updateCountDisplay();
  setStatus('checkStatus', `✅ ${added}개 마커 (${skipped}개 스킵)`);
  console.log(`[check_all] 완료 — 표시:${added}, 스킵:${skipped}`);
}

function buildExtraRows(row, exclude) {
  const keys = Object.keys(row).filter(k => !exclude.includes(k)).slice(0, 8);
  if (keys.length === 0) return '';
  const rows = keys.map(k =>
    `<div class="popup-row">
       <span class="popup-label">${k}:</span>
       <span class="popup-value">${row[k] ?? '-'}</span>
     </div>`
  ).join('');
  return `<hr style="border-color:#0f3460;margin:5px 0;">${rows}`;
}

/* ──────────────────────────────────────────────
   7. Web Worker 기반 XLSX 파싱
      → 22 MB짜리 sheet1.xml도 UI 블로킹 없이 처리
────────────────────────────────────────────── */

/**
 * Web Worker를 생성해 XLSX 파일을 백그라운드에서 파싱한다.
 *
 * @param {File}     file       - 사용자가 선택한 파일 객체
 * @param {string}   statusId   - 상태 메시지 표시 DOM ID
 * @param {Function} onDone     - 파싱 완료 콜백 (rows) => void
 */
function parseXlsxInWorker(file, statusId, onDone) {
  /* Worker 파일 경로 (상대 경로) */
  const worker = new Worker('js/xlsxWorker.js');

  /* ── FileReader로 ArrayBuffer 읽기 ── */
  const reader = new FileReader();

  reader.onload = (e) => {
    showLoader(statusId, '백그라운드 파싱 중... (대용량 파일은 수초 소요)');

    /* ArrayBuffer를 Worker로 전송 (Transferable → 복사 없이 이전, 고속) */
    worker.postMessage(
      { type: 'PARSE', payload: { buffer: e.target.result } },
      [e.target.result]   // Transferable list
    );
  };

  reader.onerror = () => {
    setStatus(statusId, '❌ 파일 읽기 실패', true);
    worker.terminate();
  };

  /* ── Worker로부터 메시지 수신 ── */
  worker.onmessage = (e) => {
    const { type, payload } = e.data;

    if (type === 'PROGRESS') {
      /* Worker가 단계별 진행 상황을 알려줌 */
      showLoader(statusId, payload.label);

    } else if (type === 'DONE') {
      worker.terminate();
      console.log(
        `[Worker] 파싱 완료 — 시트:"${payload.sheetName}", 행:${payload.total}개`
      );
      onDone(payload.rows);

    } else if (type === 'ERROR') {
      worker.terminate();
      setStatus(statusId, `❌ XLSX 파싱 오류: ${payload.message}`, true);
      console.error('[Worker] 오류:', payload.message);
    }
  };

  worker.onerror = (err) => {
    setStatus(statusId, `❌ Worker 오류: ${err.message}`, true);
    console.error('[Worker] 치명적 오류:', err);
    worker.terminate();
  };

  /* ArrayBuffer로 파일 읽기 시작 */
  reader.readAsArrayBuffer(file);
}

/* ──────────────────────────────────────────────
   8. CSV 파싱 (Papa Parse — 메인 스레드, 경량)
────────────────────────────────────────────── */
function parseCsv(file, statusId, onDone) {
  showLoader(statusId, 'CSV 파싱 중...');
  Papa.parse(file, {
    header: true, skipEmptyLines: true, dynamicTyping: false,
    complete: (result) => {
      console.log(`[CSV] "${file.name}" — ${result.data.length}행`);
      onDone(result.data);
    },
    error: (err) => {
      setStatus(statusId, `❌ CSV 파싱 실패: ${err.message}`, true);
      console.error('[CSV]', err);
    },
  });
}

/* ──────────────────────────────────────────────
   9. 파일 input 이벤트
────────────────────────────────────────────── */
document.getElementById('flatFile').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;

  document.getElementById('flatFileName').textContent = file.name;
  layers.flat.clearLayers();
  counts.flat = 0;
  updateCountDisplay();

  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'xlsx') {
    parseXlsxInWorker(file, 'flatStatus', (rows) => {
      addFlatMarkers(rows);
      autoFitBounds();
    });
  } else if (ext === 'csv' || ext === 'txt') {
    parseCsv(file, 'flatStatus', (rows) => {
      addFlatMarkers(rows);
      autoFitBounds();
    });
  } else {
    setStatus('flatStatus', '❌ .xlsx / .csv / .txt 만 지원합니다', true);
  }
});

document.getElementById('checkFile').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;

  document.getElementById('checkFileName').textContent = file.name;
  layers.check.clearLayers();
  counts.check = 0;
  updateCountDisplay();

  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'xlsx') {
    parseXlsxInWorker(file, 'checkStatus', (rows) => {
      addCheckMarkers(rows);
      autoFitBounds();
    });
  } else if (ext === 'csv' || ext === 'txt') {
    parseCsv(file, 'checkStatus', (rows) => {
      addCheckMarkers(rows);
      autoFitBounds();
    });
  } else {
    setStatus('checkStatus', '❌ .xlsx / .csv 만 지원합니다', true);
  }
});

/* ──────────────────────────────────────────────
   10. 버튼 이벤트
────────────────────────────────────────────── */
document.getElementById('btnClearAll').addEventListener('click', () => {
  layers.flat.clearLayers();
  layers.check.clearLayers();
  counts.flat = counts.check = 0;
  updateCountDisplay();
  setStatus('flatStatus', '');
  setStatus('checkStatus', '');
});

document.getElementById('btnFitBounds').addEventListener('click', autoFitBounds);

function autoFitBounds() {
  const pts = [];
  layers.flat.eachLayer(m => { if (m.getLatLng) pts.push(m.getLatLng()); });
  layers.check.eachLayer(m => { if (m.getLatLng) pts.push(m.getLatLng()); });
  if (pts.length === 0) return;
  map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
}

/* ──────────────────────────────────────────────
   11. 초기화
────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  console.log('[앱] 준비 완료 — 파일을 선택하세요.');
});

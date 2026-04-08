/**
 * ══════════════════════════════════════════════════════════════════
 *  script.js  —  지도 시각화 메인 스크립트
 *
 *  속도 최적화 전략:
 *    1) Web Worker  → XLSX 파싱을 백그라운드 스레드에서 실행 (UI 무응답 방지)
 *    2) dense: true → SheetJS 내부 파싱 2~3x 가속
 *    3) IndexedDB   → 한 번 파싱한 파일은 즉시 재로드
 *    4) CSV 내보내기 → 이후 로드를 10~50x 빠르게
 * ══════════════════════════════════════════════════════════════════
 */

/* ──────────────────────────────────────────────
   1. 전역 상태
────────────────────────────────────────────── */
let map;
const layers = { flat: null, check: null };
const counts  = { flat: 0,   check: 0  };

/** 마지막으로 파싱된 rows (CSV 내보내기용) */
const lastRows = { flat: null, check: null };

const COL_CANDIDATES = {
  x:   ['x좌표값','x좌표','x_coord','lon','lng','longitude','x','x_lon','경도','easting'],
  y:   ['y좌표값','y좌표','y_coord','lat','latitude','y','y_lat','위도','northing'],
  lat: ['위도','lat','latitude','y','y_lat','y좌표'],
  lng: ['경도','lon','lng','longitude','x','x_lon','x좌표'],
};

/* ──────────────────────────────────────────────
   2. IndexedDB 캐시 헬퍼 (ES Module 미사용 — 인라인 구현)
   GitHub Pages의 file:// 환경에서도 동작하도록 모듈 없이 구현
────────────────────────────────────────────── */
const XlsxCache = (() => {
  const DB_NAME    = 'xlsxCacheDB';
  const DB_VERSION = 1;
  const STORE      = 'parsedData';
  const MAX_ITEMS  = 8;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'k' });
          s.createIndex('t', 't'); // 접근 시각 (LRU)
        }
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = e => rej(e.target.error);
    });
  }

  function fileKey(file) {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  return {
    /** 캐시 조회. 없으면 null 반환 */
    async get(file) {
      try {
        const db  = await open();
        const key = fileKey(file);
        return new Promise(res => {
          const tx = db.transaction(STORE, 'readwrite');
          const st = tx.objectStore(STORE);
          const rq = st.get(key);
          rq.onsuccess = e => {
            const entry = e.target.result;
            if (!entry) { res(null); return; }
            entry.t = Date.now(); st.put(entry); // LRU 갱신
            console.log(`[캐시 HIT] "${file.name}" — ${entry.rows.length}행`);
            res(entry.rows);
          };
          rq.onerror = () => res(null);
        });
      } catch { return null; }
    },

    /** 캐시 저장 + 오래된 항목 LRU 삭제 */
    async set(file, rows) {
      try {
        const db  = await open();
        const key = fileKey(file);
        return new Promise(res => {
          const tx = db.transaction(STORE, 'readwrite');
          const st = tx.objectStore(STORE);
          st.put({ k: key, name: file.name, rows, t: Date.now() });

          // LRU: MAX_ITEMS 초과 시 오래된 것 제거
          const idx  = st.index('t');
          const keys = [];
          idx.openKeyCursor().onsuccess = e => {
            const cur = e.target.result;
            if (cur) { keys.push(cur.primaryKey); cur.continue(); }
            else if (keys.length > MAX_ITEMS) {
              keys.slice(0, keys.length - MAX_ITEMS).forEach(k => st.delete(k));
            }
          };
          tx.oncomplete = () => res();
          tx.onerror    = () => res();
        });
      } catch { /* 캐시 실패는 무시 */ }
    },
  };
})();

/* ──────────────────────────────────────────────
   3. 지도 초기화
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
   4. 커스텀 마커 아이콘
────────────────────────────────────────────── */
function createCircleIcon(color, border) {
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6" fill="${color}" stroke="${border}" stroke-width="2" opacity="0.85"/>
    </svg>`,
    className: '', iconSize: [16,16], iconAnchor: [8,8], popupAnchor: [0,-10],
  });
}
const ICON_FLAT  = createCircleIcon('#e74c3c', '#922b21');
const ICON_CHECK = createCircleIcon('#2980b9', '#1a5276');

/* ──────────────────────────────────────────────
   5. 유틸
────────────────────────────────────────────── */
function findColumn(headers, candidates) {
  const norm = headers.map(h => String(h).toLowerCase().replace(/\s+/g,''));
  for (const c of candidates) {
    const idx = norm.indexOf(c.toLowerCase().replace(/\s+/g,''));
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
  el.className = 'status-msg' + (isError ? ' error' : '');
}

function showLoader(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<span class="loader-spinner"></span> ${msg}`;
  el.className = 'status-msg loading';
}

function updateCountDisplay() {
  document.getElementById('flatCount').textContent  = `flat: ${counts.flat}개`;
  document.getElementById('checkCount').textContent = `check_all: ${counts.check}개`;
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
    console.error('[flat] 헤더:', headers);
    return;
  }
  console.log(`[flat] 컬럼 — X:"${xCol}", Y:"${yCol}"`);

  let added = 0, skipped = 0;
  rows.forEach(row => {
    const x = row[xCol], y = row[yCol];
    if (!isValidNumber(x) || !isValidNumber(y)) { skipped++; return; }
    const lat = parseFloat(y), lng = parseFloat(x);
    L.marker([lat, lng], { icon: ICON_FLAT })
      .bindPopup(`
        <div class="popup-title">📍 flat #${added + 1}</div>
        <div class="popup-row">
          <span class="popup-label">X (경도):</span>
          <span class="popup-value">${lng.toFixed(6)}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Y (위도):</span>
          <span class="popup-value">${lat.toFixed(6)}</span>
        </div>
        ${buildExtraRows(row, [xCol, yCol])}`, { maxWidth: 260 })
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
    return;
  }

  let added = 0, skipped = 0;
  rows.forEach(row => {
    if (!isValidNumber(row[latCol]) || !isValidNumber(row[lngCol])) { skipped++; return; }
    const lat = parseFloat(row[latCol]), lng = parseFloat(row[lngCol]);
    L.marker([lat, lng], { icon: ICON_CHECK })
      .bindPopup(`
        <div class="popup-title">🔵 check_all #${added + 1}</div>
        <div class="popup-row">
          <span class="popup-label">위도:</span>
          <span class="popup-value">${lat.toFixed(6)}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">경도:</span>
          <span class="popup-value">${lng.toFixed(6)}</span>
        </div>
        ${buildExtraRows(row, [latCol, lngCol])}`, { maxWidth: 260 })
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
  return `<hr style="border-color:#0f3460;margin:5px 0;">` +
    keys.map(k =>
      `<div class="popup-row">
        <span class="popup-label">${k}:</span>
        <span class="popup-value">${row[k] ?? '-'}</span>
      </div>`
    ).join('');
}

/* ──────────────────────────────────────────────
   7. Web Worker 기반 XLSX 파싱 + IndexedDB 캐시
────────────────────────────────────────────── */

/**
 * XLSX 파일을 파싱한다.
 * ① IndexedDB 캐시 조회 → 있으면 즉시 반환
 * ② 없으면 Web Worker로 백그라운드 파싱 → 결과를 캐시에 저장
 *
 * @param {File}     file      - 사용자가 선택한 파일
 * @param {string}   statusId  - 상태 메시지 DOM ID
 * @param {Function} onDone    - 완료 콜백 (rows) => void
 */
async function parseXlsx(file, statusId, onDone) {

  /* ── ① 캐시 확인 ── */
  showLoader(statusId, '캐시 확인 중...');
  const cached = await XlsxCache.get(file);

  if (cached) {
    /* 캐시 HIT: 즉시 반환 */
    setStatus(statusId, `⚡ 캐시에서 즉시 로드 (${cached.length}행)`);
    onDone(cached);
    return;
  }

  /* ── ② 캐시 MISS: Web Worker로 파싱 ── */
  showLoader(statusId, 'XLSX 읽는 중... (첫 로드는 수초 소요)');

  const worker = new Worker('js/xlsxWorker.js');
  const reader = new FileReader();

  reader.onload = (e) => {
    /* Transferable 방식으로 전송 — 복사 없이 Worker로 이전 */
    worker.postMessage(
      { type: 'PARSE', payload: { buffer: e.target.result } },
      [e.target.result]
    );
  };

  reader.onerror = () => {
    setStatus(statusId, '❌ 파일 읽기 실패', true);
    worker.terminate();
  };

  worker.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'PROGRESS') {
      showLoader(statusId, payload.label);

    } else if (type === 'DONE') {
      worker.terminate();
      console.log(`[Worker] 완료 — 시트:"${payload.sheetName}", ${payload.total}행`);

      /* ③ 결과를 IndexedDB에 저장 (다음 로드부터 즉시 반환) */
      showLoader(statusId, '캐시 저장 중...');
      await XlsxCache.set(file, payload.rows);

      onDone(payload.rows);

    } else if (type === 'ERROR') {
      worker.terminate();
      setStatus(statusId, `❌ XLSX 파싱 오류: ${payload.message}`, true);
    }
  };

  worker.onerror = (err) => {
    setStatus(statusId, `❌ Worker 오류: ${err.message}`, true);
    worker.terminate();
  };

  reader.readAsArrayBuffer(file);
}

/* ──────────────────────────────────────────────
   8. CSV 파싱 (Papa Parse)
────────────────────────────────────────────── */
function parseCsv(file, statusId, onDone) {
  showLoader(statusId, 'CSV 파싱 중...');
  Papa.parse(file, {
    header: true, skipEmptyLines: true, dynamicTyping: false,
    complete: (result) => {
      console.log(`[CSV] "${file.name}" — ${result.data.length}행`);
      onDone(result.data);
    },
    error: (err) => setStatus(statusId, `❌ CSV 파싱 실패: ${err.message}`, true),
  });
}

/* ──────────────────────────────────────────────
   9. CSV 내보내기 (파싱 결과 → .csv 다운로드)
   XLSX보다 10~50x 빠르게 재로드 가능
────────────────────────────────────────────── */
function exportToCsv(rows, filename) {
  if (!rows || rows.length === 0) {
    alert('내보낼 데이터가 없습니다. 먼저 파일을 로드하세요.');
    return;
  }
  const csv  = Papa.unparse(rows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM 포함 → 한글 깨짐 방지
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  console.log(`[CSV 내보내기] "${filename}" — ${rows.length}행`);
}

/* ──────────────────────────────────────────────
   10. 파일 input 이벤트
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
    parseXlsx(file, 'flatStatus', (rows) => {
      lastRows.flat = rows;
      addFlatMarkers(rows);
      autoFitBounds();
      showExportBtn('flat');
    });
  } else if (ext === 'csv' || ext === 'txt') {
    parseCsv(file, 'flatStatus', (rows) => {
      lastRows.flat = rows;
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
    parseXlsx(file, 'checkStatus', (rows) => {
      lastRows.check = rows;
      addCheckMarkers(rows);
      autoFitBounds();
      showExportBtn('check');
    });
  } else if (ext === 'csv' || ext === 'txt') {
    parseCsv(file, 'checkStatus', (rows) => {
      lastRows.check = rows;
      addCheckMarkers(rows);
      autoFitBounds();
    });
  } else {
    setStatus('checkStatus', '❌ .xlsx / .csv 만 지원합니다', true);
  }
});

/* ──────────────────────────────────────────────
   11. CSV 내보내기 버튼 동적 표시
────────────────────────────────────────────── */
function showExportBtn(type) {
  const statusId = type === 'flat' ? 'flatStatus' : 'checkStatus';
  const rows     = type === 'flat' ? lastRows.flat : lastRows.check;
  const filename = type === 'flat' ? 'flat_export.csv' : 'check_all_export.csv';

  const el = document.getElementById(statusId);
  if (!el) return;

  /* 기존 내보내기 버튼 제거 */
  const old = el.parentNode.querySelector('.export-btn');
  if (old) old.remove();

  /* 새 버튼 삽입 */
  const btn = document.createElement('button');
  btn.className   = 'export-btn';
  btn.textContent = '💾 CSV로 저장 (다음 로드 빠름)';
  btn.onclick     = () => exportToCsv(rows, filename);
  el.parentNode.insertBefore(btn, el.nextSibling);
}

/* ──────────────────────────────────────────────
   12. 버튼 이벤트
────────────────────────────────────────────── */
document.getElementById('btnClearAll').addEventListener('click', () => {
  layers.flat.clearLayers();
  layers.check.clearLayers();
  counts.flat = counts.check = 0;
  updateCountDisplay();
  setStatus('flatStatus', '');
  setStatus('checkStatus', '');
  document.querySelectorAll('.export-btn').forEach(b => b.remove());
});

document.getElementById('btnFitBounds').addEventListener('click', autoFitBounds);

function autoFitBounds() {
  const pts = [];
  layers.flat.eachLayer(m  => { if (m.getLatLng) pts.push(m.getLatLng()); });
  layers.check.eachLayer(m => { if (m.getLatLng) pts.push(m.getLatLng()); });
  if (pts.length === 0) return;
  map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
}

/* ──────────────────────────────────────────────
   13. 초기화
────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  console.log('[앱] 준비 완료');
  console.log('[앱] 속도 팁: 첫 로드 후 "CSV로 저장" 버튼으로 내보내면 다음부터 즉시 로드됩니다.');
});

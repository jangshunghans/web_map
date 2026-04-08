/**
 * ══════════════════════════════════════════════════════════════════
 *  script.js  —  지도 시각화 메인 스크립트
 *
 *  처리 대상:
 *    1) flat 파일  (.xlsx / .csv / .txt)
 *       - X좌표값 컬럼 → 경도(lng)
 *       - Y좌표값 컬럼 → 위도(lat)
 *       - 빨간 마커로 표시
 *
 *    2) check_all.xlsx
 *       - 위도(latitude) / 경도(longitude) 컬럼
 *       - 값이 있는 행만 필터링
 *       - 파란 마커로 표시
 *
 *  의존 라이브러리 (CDN):
 *    - Leaflet.js  1.9.4
 *    - SheetJS (xlsx)  0.18.5
 *    - Papa Parse  5.4.1
 * ══════════════════════════════════════════════════════════════════
 */

/* ──────────────────────────────────────────────
   1. 전역 상태
────────────────────────────────────────────── */

/** Leaflet 지도 인스턴스 */
let map;

/** 마커 레이어 그룹 (레이어별 관리) */
const layers = {
  flat:  null,   // flat 파일 마커들
  check: null,   // check_all 파일 마커들
};

/** 현재 로드된 마커 수 */
const counts = { flat: 0, check: 0 };

/** ──── 컬럼 이름 후보 목록 ────
 *  실제 엑셀 헤더가 대소문자, 공백, 한글 등 다양할 수 있어
 *  아래 후보 중 하나라도 매칭되면 해당 필드를 사용한다.
 */
const COL_CANDIDATES = {
  /* flat 파일 X 좌표 (경도) */
  x: ['x좌표값', 'x좌표', 'x_coord', 'lon', 'lng', 'longitude',
      'x', 'x_lon', '경도', 'easting'],
  /* flat 파일 Y 좌표 (위도) */
  y: ['y좌표값', 'y좌표', 'y_coord', 'lat', 'latitude',
      'y', 'y_lat', '위도', 'northing'],
  /* check_all 위도 */
  lat: ['위도', 'lat', 'latitude', 'y', 'y_lat', 'y좌표'],
  /* check_all 경도 */
  lng: ['경도', 'lon', 'lng', 'longitude', 'x', 'x_lon', 'x좌표'],
};

/* ──────────────────────────────────────────────
   2. 지도 초기화
────────────────────────────────────────────── */

/**
 * Leaflet 지도를 생성하고 기본 타일 레이어를 추가한다.
 * 기본 중심: 서울 (37.5665, 126.9780), 줌 레벨 7
 */
function initMap() {
  map = L.map('map').setView([37.5665, 126.9780], 7);

  // OpenStreetMap 타일 (무료, 상업적 사용 가능)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // 레이어 그룹 초기화 (지도에 바로 추가)
  layers.flat  = L.layerGroup().addTo(map);
  layers.check = L.layerGroup().addTo(map);

  console.log('[지도] 초기화 완료 — 중심: 서울 (37.5665, 126.9780)');
}

/* ──────────────────────────────────────────────
   3. 커스텀 마커 아이콘 생성
────────────────────────────────────────────── */

/**
 * SVG 원형 마커 아이콘을 동적으로 생성한다.
 * @param {string} color - 채우기 색상 (hex)
 * @param {string} borderColor - 테두리 색상 (hex)
 * @returns {L.DivIcon} Leaflet DivIcon 인스턴스
 */
function createCircleIcon(color, borderColor) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6"
        fill="${color}" stroke="${borderColor}" stroke-width="2" opacity="0.85"/>
    </svg>`;

  return L.divIcon({
    html: svg,
    className: '',          // 기본 클래스 제거 (흰 배경 없앰)
    iconSize: [16, 16],
    iconAnchor: [8, 8],     // 아이콘 중심 기준으로 좌표에 찍힘
    popupAnchor: [0, -10],
  });
}

/** flat 파일용 빨간 아이콘 */
const ICON_FLAT  = createCircleIcon('#e74c3c', '#922b21');
/** check_all 파일용 파란 아이콘 */
const ICON_CHECK = createCircleIcon('#2980b9', '#1a5276');

/* ──────────────────────────────────────────────
   4. 유틸 — 헤더 컬럼 매핑
────────────────────────────────────────────── */

/**
 * 실제 헤더 배열에서 후보 목록 중 첫 번째로 일치하는 헤더를 반환한다.
 * 비교는 소문자 + 공백 제거 후 수행한다.
 *
 * @param {string[]} headers   - 실제 헤더 배열
 * @param {string[]} candidates - 후보 이름 배열
 * @returns {string|null} 일치한 실제 헤더명 또는 null
 */
function findColumn(headers, candidates) {
  const normalized = headers.map(h =>
    String(h).toLowerCase().replace(/\s+/g, '')
  );
  for (const candidate of candidates) {
    const idx = normalized.indexOf(
      candidate.toLowerCase().replace(/\s+/g, '')
    );
    if (idx !== -1) return headers[idx];
  }
  return null;
}

/* ──────────────────────────────────────────────
   5. 유틸 — 숫자 유효성 검사
────────────────────────────────────────────── */

/**
 * 주어진 값이 유효한 좌표 숫자인지 확인한다.
 * @param {*} val - 검사할 값
 * @returns {boolean}
 */
function isValidNumber(val) {
  const n = parseFloat(val);
  return !isNaN(n) && isFinite(n);
}

/* ──────────────────────────────────────────────
   6. 마커 추가
────────────────────────────────────────────── */

/**
 * flat 파일 데이터를 받아 마커를 지도에 추가한다.
 *
 * @param {Object[]} rows - 파싱된 행 배열 (각 항목은 {컬럼명: 값} 객체)
 */
function addFlatMarkers(rows) {
  if (!rows || rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const xCol = findColumn(headers, COL_CANDIDATES.x);
  const yCol = findColumn(headers, COL_CANDIDATES.y);

  // 컬럼을 찾지 못하면 오류 표시 후 종료
  if (!xCol || !yCol) {
    setStatus('flatStatus',
      `❌ X/Y 컬럼을 찾지 못했습니다. 헤더: [${headers.join(', ')}]`,
      true);
    console.error('[flat] 컬럼 탐지 실패. 전체 헤더:', headers);
    return;
  }

  console.log(`[flat] 사용 컬럼 — X: "${xCol}", Y: "${yCol}"`);

  let added = 0;
  let skipped = 0;

  rows.forEach((row, idx) => {
    const x = row[xCol]; // 경도 (longitude)
    const y = row[yCol]; // 위도  (latitude)

    if (!isValidNumber(x) || !isValidNumber(y)) {
      skipped++;
      return; // 좌표가 없는 행은 무시
    }

    const lat = parseFloat(y);
    const lng = parseFloat(x);

    // 대한민국 범위 대략 체크 (선택적 경고)
    // 위도 33~38, 경도 124~132 — 벗어나도 오류는 아님
    const inKorea =
      lat >= 33 && lat <= 38.5 &&
      lng >= 124 && lng <= 132;

    if (!inKorea) {
      console.warn(
        `[flat] 행 ${idx + 2}: 좌표(${lat}, ${lng})가 한국 범위 밖입니다.`
      );
    }

    // 팝업 HTML 생성
    const popupHtml = `
      <div class="popup-title">📍 flat 마커 #${added + 1}</div>
      <div class="popup-row">
        <span class="popup-label">X (경도):</span>
        <span class="popup-value">${lng.toFixed(6)}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Y (위도):</span>
        <span class="popup-value">${lat.toFixed(6)}</span>
      </div>
      ${buildExtraPopupRows(row, [xCol, yCol])}
    `;

    // 마커 생성 & 팝업 바인딩
    L.marker([lat, lng], { icon: ICON_FLAT })
      .bindPopup(popupHtml, { maxWidth: 260 })
      .addTo(layers.flat);

    added++;
  });

  counts.flat = added;
  updateCountDisplay();

  setStatus('flatStatus', `✅ ${added}개 마커 추가 (${skipped}개 스킵)`);
  console.log(`[flat] 마커 추가 완료 — 표시: ${added}개, 스킵: ${skipped}개`);
}

/**
 * check_all 파일 데이터를 받아 마커를 지도에 추가한다.
 *
 * @param {Object[]} rows - 파싱된 행 배열
 */
function addCheckMarkers(rows) {
  if (!rows || rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const latCol = findColumn(headers, COL_CANDIDATES.lat);
  const lngCol = findColumn(headers, COL_CANDIDATES.lng);

  if (!latCol || !lngCol) {
    setStatus('checkStatus',
      `❌ 위도/경도 컬럼을 찾지 못했습니다. 헤더: [${headers.join(', ')}]`,
      true);
    console.error('[check_all] 컬럼 탐지 실패. 전체 헤더:', headers);
    return;
  }

  console.log(
    `[check_all] 사용 컬럼 — 위도: "${latCol}", 경도: "${lngCol}"`
  );

  let added = 0;
  let skipped = 0;

  rows.forEach((row, idx) => {
    const latVal = row[latCol];
    const lngVal = row[lngCol];

    // 위도 또는 경도가 없거나 숫자가 아니면 건너뜀
    if (!isValidNumber(latVal) || !isValidNumber(lngVal)) {
      skipped++;
      return;
    }

    const lat = parseFloat(latVal);
    const lng = parseFloat(lngVal);

    // 팝업 HTML
    const popupHtml = `
      <div class="popup-title">🔵 check_all 마커 #${added + 1}</div>
      <div class="popup-row">
        <span class="popup-label">위도:</span>
        <span class="popup-value">${lat.toFixed(6)}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">경도:</span>
        <span class="popup-value">${lng.toFixed(6)}</span>
      </div>
      ${buildExtraPopupRows(row, [latCol, lngCol])}
    `;

    L.marker([lat, lng], { icon: ICON_CHECK })
      .bindPopup(popupHtml, { maxWidth: 260 })
      .addTo(layers.check);

    added++;
  });

  counts.check = added;
  updateCountDisplay();

  setStatus('checkStatus', `✅ ${added}개 마커 추가 (${skipped}개 스킵)`);
  console.log(
    `[check_all] 마커 추가 완료 — 표시: ${added}개, 스킵: ${skipped}개`
  );
}

/**
 * 좌표 컬럼 외 나머지 컬럼을 팝업에 추가 행으로 삽입한다.
 * (최대 8개 컬럼까지만 표시)
 *
 * @param {Object} row        - 데이터 행
 * @param {string[]} exclude  - 제외할 컬럼 이름 배열
 * @returns {string} HTML 문자열
 */
function buildExtraPopupRows(row, exclude) {
  const keys = Object.keys(row)
    .filter(k => !exclude.includes(k))
    .slice(0, 8); // 너무 많으면 잘라냄

  if (keys.length === 0) return '';

  const rows = keys
    .map(k => {
      const val = row[k] !== undefined && row[k] !== null ? row[k] : '-';
      return `
        <div class="popup-row">
          <span class="popup-label">${k}:</span>
          <span class="popup-value">${val}</span>
        </div>`;
    })
    .join('');

  return `<hr style="border-color:#0f3460;margin:5px 0;">${rows}`;
}

/* ──────────────────────────────────────────────
   7. 파일 파싱 — XLSX
────────────────────────────────────────────── */

/**
 * xlsx 파일을 읽어 첫 번째 시트의 데이터를 JSON 배열로 반환한다.
 * SheetJS 라이브러리 사용.
 *
 * @param {File} file   - 사용자가 선택한 File 객체
 * @param {Function} cb - 콜백 (rows: Object[]) => void
 */
function readXlsx(file, cb) {
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      // ArrayBuffer → Workbook 파싱
      const data     = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });

      // 첫 번째 시트 선택
      const sheetName = workbook.SheetNames[0];
      const sheet     = workbook.Sheets[sheetName];

      // 시트 → JSON 배열 (첫 행을 헤더로 사용)
      const rows = XLSX.utils.sheet_to_json(sheet, {
        defval: '',   // 빈 셀은 빈 문자열로
        raw:    false, // 날짜 등을 문자열로 통일
      });

      console.log(
        `[XLSX] 파일: "${file.name}", 시트: "${sheetName}", 행 수: ${rows.length}`
      );

      cb(rows);
    } catch (err) {
      console.error('[XLSX] 파싱 오류:', err);
      cb(null, err);
    }
  };

  reader.onerror = (err) => {
    console.error('[XLSX] FileReader 오류:', err);
    cb(null, err);
  };

  reader.readAsArrayBuffer(file);
}

/* ──────────────────────────────────────────────
   8. 파일 파싱 — CSV / TXT
────────────────────────────────────────────── */

/**
 * CSV / TXT 파일을 읽어 JSON 배열로 반환한다.
 * Papa Parse 라이브러리 사용.
 *
 * @param {File} file   - 사용자가 선택한 File 객체
 * @param {Function} cb - 콜백 (rows: Object[]) => void
 */
function readCsv(file, cb) {
  Papa.parse(file, {
    header:       true,   // 첫 행을 헤더로
    skipEmptyLines: true, // 빈 줄 무시
    dynamicTyping: false, // 숫자 자동 변환 끔 (isValidNumber에서 직접 처리)
    complete: (result) => {
      console.log(
        `[CSV] 파일: "${file.name}", 행 수: ${result.data.length}`,
        result.errors.length ? `오류: ${result.errors.length}건` : ''
      );
      cb(result.data);
    },
    error: (err) => {
      console.error('[CSV] 파싱 오류:', err);
      cb(null, err);
    },
  });
}

/* ──────────────────────────────────────────────
   9. 이벤트 — 파일 input change 핸들러
────────────────────────────────────────────── */

/** flat 파일 선택 시 */
document.getElementById('flatFile').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;

  // 파일명 표시
  document.getElementById('flatFileName').textContent = file.name;
  setStatus('flatStatus', '⏳ 파일 로딩 중...');

  // 기존 flat 마커 제거
  layers.flat.clearLayers();
  counts.flat = 0;
  updateCountDisplay();

  // 확장자에 따라 파서 선택
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'xlsx') {
    readXlsx(file, (rows, err) => {
      if (err || !rows) {
        setStatus('flatStatus', '❌ XLSX 파싱 실패', true);
        return;
      }
      addFlatMarkers(rows);
      autoFitBounds();
    });
  } else if (ext === 'csv' || ext === 'txt') {
    readCsv(file, (rows, err) => {
      if (err || !rows) {
        setStatus('flatStatus', '❌ CSV 파싱 실패', true);
        return;
      }
      addFlatMarkers(rows);
      autoFitBounds();
    });
  } else {
    setStatus('flatStatus', '❌ 지원하지 않는 파일 형식입니다 (.xlsx/.csv/.txt)', true);
  }
});

/** check_all 파일 선택 시 */
document.getElementById('checkFile').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;

  document.getElementById('checkFileName').textContent = file.name;
  setStatus('checkStatus', '⏳ 파일 로딩 중...');

  // 기존 check 마커 제거
  layers.check.clearLayers();
  counts.check = 0;
  updateCountDisplay();

  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'xlsx') {
    readXlsx(file, (rows, err) => {
      if (err || !rows) {
        setStatus('checkStatus', '❌ XLSX 파싱 실패', true);
        return;
      }
      addCheckMarkers(rows);
      autoFitBounds();
    });
  } else if (ext === 'csv' || ext === 'txt') {
    // check_all이 CSV인 경우도 위도/경도 컬럼으로 처리
    readCsv(file, (rows, err) => {
      if (err || !rows) {
        setStatus('checkStatus', '❌ CSV 파싱 실패', true);
        return;
      }
      addCheckMarkers(rows);
      autoFitBounds();
    });
  } else {
    setStatus('checkStatus', '❌ 지원하지 않는 파일 형식입니다', true);
  }
});

/* ──────────────────────────────────────────────
   10. 버튼 이벤트
────────────────────────────────────────────── */

/** 전체 마커 삭제 */
document.getElementById('btnClearAll').addEventListener('click', () => {
  layers.flat.clearLayers();
  layers.check.clearLayers();
  counts.flat  = 0;
  counts.check = 0;
  updateCountDisplay();
  setStatus('flatStatus', '');
  setStatus('checkStatus', '');
  console.log('[지도] 전체 마커 삭제');
});

/** 모든 마커가 보이도록 지도 범위 자동 조정 */
document.getElementById('btnFitBounds').addEventListener('click', autoFitBounds);

/* ──────────────────────────────────────────────
   11. 유틸 함수
────────────────────────────────────────────── */

/**
 * 현재 표시된 모든 마커를 포함하도록 지도 뷰를 자동 조정한다.
 */
function autoFitBounds() {
  const allMarkers = [];

  // flat 레이어의 마커 수집
  layers.flat.eachLayer(m => {
    if (m.getLatLng) allMarkers.push(m.getLatLng());
  });

  // check 레이어의 마커 수집
  layers.check.eachLayer(m => {
    if (m.getLatLng) allMarkers.push(m.getLatLng());
  });

  if (allMarkers.length === 0) {
    console.log('[지도] 마커가 없어 범위 조정을 건너뜁니다.');
    return;
  }

  const bounds = L.latLngBounds(allMarkers);
  map.fitBounds(bounds, { padding: [40, 40] }); // 여백 40px
  console.log(`[지도] 범위 조정 — ${allMarkers.length}개 마커 포함`);
}

/**
 * 상태 메시지를 지정된 요소에 표시한다.
 *
 * @param {string}  elementId - 대상 요소 ID
 * @param {string}  message   - 표시할 메시지
 * @param {boolean} isError   - true이면 오류 스타일 적용
 */
function setStatus(elementId, message, isError = false) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className   = 'status-msg' + (isError ? ' error' : '');
}

/**
 * 마커 개수 통계를 화면에 업데이트한다.
 */
function updateCountDisplay() {
  document.getElementById('flatCount').textContent  =
    `flat: ${counts.flat}개`;
  document.getElementById('checkCount').textContent =
    `check_all: ${counts.check}개`;
}

/* ──────────────────────────────────────────────
   12. 초기화 실행
────────────────────────────────────────────── */

// DOM 로드 완료 후 지도 초기화
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  console.log('[앱] 초기화 완료 — 파일을 선택하여 마커를 표시하세요.');
  console.log('[앱] 지원 파일: flat.xlsx / flat.csv / check_all.xlsx');
});

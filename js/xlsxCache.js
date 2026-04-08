/**
 * xlsxCache.js — IndexedDB 기반 파싱 결과 캐시
 *
 * 동작 방식:
 *   - 파일의 (이름 + 크기 + 수정일시)를 키로 파싱 결과를 IndexedDB에 저장
 *   - 같은 파일을 다시 올리면 파싱 없이 캐시에서 즉시 반환
 *   - 캐시 항목은 최대 MAX_ENTRIES 개 유지 (LRU 방식으로 오래된 것 삭제)
 */

const DB_NAME    = 'xlsxCacheDB';
const DB_VERSION = 1;
const STORE_NAME = 'parsedData';
const MAX_ENTRIES = 10;  // 최대 캐시 항목 수

/** IndexedDB 연결 프로미스 (싱글턴) */
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        store.createIndex('accessedAt', 'accessedAt'); // LRU용 인덱스
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });

  return _dbPromise;
}

/**
 * 파일 고유 키 생성
 * (파일명 + 크기 + 마지막 수정일시) 조합 → 내용이 같으면 같은 키
 */
function makeCacheKey(file) {
  return `${file.name}__${file.size}__${file.lastModified}`;
}

/**
 * 캐시에서 파싱 결과를 조회한다.
 * @param {File} file
 * @returns {Promise<Object[]|null>} 캐시된 rows 배열 또는 null
 */
export async function getCache(file) {
  try {
    const db  = await openDB();
    const key = makeCacheKey(file);

    return new Promise((resolve) => {
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req   = store.get(key);

      req.onsuccess = (e) => {
        const entry = e.target.result;
        if (!entry) { resolve(null); return; }

        // LRU: 접근 시각 갱신
        entry.accessedAt = Date.now();
        store.put(entry);

        console.log(`[캐시] HIT — "${file.name}" (${entry.rows.length}행)`);
        resolve(entry.rows);
      };

      req.onerror = () => resolve(null);
    });
  } catch {
    return null; // IndexedDB 사용 불가 환경에서는 캐시 없이 진행
  }
}

/**
 * 파싱 결과를 캐시에 저장한다.
 * @param {File}     file
 * @param {Object[]} rows - 파싱된 행 배열
 */
export async function setCache(file, rows) {
  try {
    const db  = await openDB();
    const key = makeCacheKey(file);

    return new Promise((resolve) => {
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // 저장
      store.put({
        cacheKey:   key,
        fileName:   file.name,
        rows,
        accessedAt: Date.now(),
      });

      // 캐시 항목이 MAX_ENTRIES 초과 시 가장 오래된 것 삭제 (LRU)
      const idxReq = store.index('accessedAt').openCursor();
      const keys   = [];

      idxReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          keys.push(cursor.primaryKey);
          cursor.continue();
        } else {
          // 오래된 순 정렬은 인덱스가 이미 오름차순
          if (keys.length > MAX_ENTRIES) {
            const toDelete = keys.slice(0, keys.length - MAX_ENTRIES);
            toDelete.forEach(k => store.delete(k));
            console.log(`[캐시] 오래된 항목 ${toDelete.length}개 삭제`);
          }
          resolve();
        }
      };

      tx.onerror = () => resolve();
    });
  } catch {
    // 캐시 저장 실패는 무시 (기능에 영향 없음)
  }
}

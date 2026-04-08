# 지도 시각화 프로젝트 (web_map)

엑셀/CSV 데이터를 Leaflet.js 지도 위에 좌표 마커로 시각화하는 웹 앱입니다.

---

## 프로젝트 구조

```
web_map/
├── index.html          # 메인 페이지
├── css/
│   └── style.css       # 스타일
├── js/
│   └── script.js       # 지도 & 파일 파싱 로직
├── data/
│   └── sample_flat.csv # 샘플 데이터
├── flat.xlsx           # flat 좌표 파일 (X좌표값, Y좌표값)
└── check_all.xlsx      # check_all 파일 (위도, 경도)
```

---

## 파일 형식

### flat 파일 (빨간 마커)
| 컬럼 | 설명 |
|------|------|
| X좌표값 | 경도 (longitude) |
| Y좌표값 | 위도 (latitude) |

> 지원 형식: `.xlsx`, `.csv`, `.txt`
> 컬럼명 대소문자 무관, `x`, `lng`, `longitude`, `경도` 등 자동 인식

### check_all 파일 (파란 마커)
| 컬럼 | 설명 |
|------|------|
| 위도 / latitude / lat | 위도 |
| 경도 / longitude / lng | 경도 |

> 값이 없는 행은 자동 무시

---

## 실행 방법

### 로컬 실행 (VS Code Live Server 권장)
1. VS Code에서 `index.html` 열기
2. 우하단 **Go Live** 클릭
3. 브라우저에서 자동 열림

### 또는 Python 로컬 서버
```bash
cd d:/map_using/web_map
python -m http.server 8080
# 브라우저: http://localhost:8080
```

> `file://` 프로토콜로 직접 열면 CORS 오류가 날 수 있습니다.
> GitHub Pages 또는 로컬 서버 사용을 권장합니다.

---

## GitHub 업로드 및 Pages 배포

### 1단계: Git 초기화 및 원격 연결
```bash
cd d:/map_using/web_map

git init
git remote add origin https://github.com/jangshunghans/web_map.git
```

### 2단계: 파일 스테이징 및 커밋
```bash
git add .
git commit -m "feat: 지도 시각화 프로젝트 초기 설정"
```

### 3단계: GitHub에 Push
```bash
# 처음 push (브랜치 설정 포함)
git branch -M main
git push -u origin main
```

### 4단계: GitHub Pages 활성화
1. GitHub 저장소 페이지 접속
   `https://github.com/jangshunghans/web_map`
2. **Settings** 탭 클릭
3. 왼쪽 메뉴 **Pages** 선택
4. **Source** → `Deploy from a branch` 선택
5. **Branch** → `main`, 폴더 → `/ (root)` 선택 후 **Save**
6. 약 1~2분 후 배포 완료

### 5단계: 배포 URL 확인
```
https://jangshunghans.github.io/web_map/
```

---

## 의존 라이브러리 (CDN)

| 라이브러리 | 용도 | 버전 |
|-----------|------|------|
| Leaflet.js | 지도 렌더링 | 1.9.4 |
| SheetJS (xlsx) | XLSX 파싱 | 0.18.5 |
| Papa Parse | CSV 파싱 | 5.4.1 |

모두 CDN으로 로드되어 **별도 설치 불필요**합니다.

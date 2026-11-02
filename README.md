# 무덱스 (Mudex) — 1단계 시제품

OpenAI API로 만든 '나만의 코덱스', 영상 전용 에이전트입니다.
2026-11-27 광주교육연수원 연수에서 연수생 20명이 내려받아 씁니다.

| 하는 일 | 누가 | 비용 |
|---|---|---|
| 대화, 스토리보드, 편집 지시 | 무덱스(OpenAI 모델) | 강사 API (코드별 한도) |
| 키프레임 이미지 | 무덱스(OpenAI 이미지 모델) | 강사 API (코드별 한도) |
| 영상 생성(클링) | 연수생 힉스필드 계정(MCP 로그인) | 연수생 구독 크레딧 |
| 자르기, 잇기, 음악, 음량 | 무덱스 ffmpeg 도구 | 무료 |

## 2026-11-03 시험 결과

| 항목 | 결과 | 근거 |
|---|---|---|
| 1. 힉스필드 MCP OAuth | **됨** | 동적 클라이언트 등록 201 → 브라우저 로그인 → `127.0.0.1` 콜백 → 토큰 200(갱신 토큰 있음, 24시간) → MCP initialize 200 → **도구 185개**(generate_video·generate_image·jobs_wait·media_upload 포함) → `balance` 200. 저장 토큰으로 다시 붙기도 확인 |
| 2. 강사 코드로 OpenAI 쓰기 | **됨** | 정상 코드 대화 성공. 틀린·만료·꺼진 코드 거절. 한도를 넘으면 402로 차단 |
| 3. 편집 에이전트 한 바퀴 | **됨** | "세 클립 이어 18초로, 음악 얹어 내보내기" → **18.000초(432프레임), −14.08 LUFS, 트루피크 −1.79 dBTP**. 84초 걸림, 모델 비용 0.0064달러 |

## 화면 (2026-11-03 2단계)

`무덱스 실행.bat`를 두 번 누르면 로컬 서버(`127.0.0.1:4870`)가 켜집니다. 엣지가 주소창 없는 앱 창으로 열립니다. 검은 창을 닫으면 꺼집니다.

- **왼쪽**: 작업 목록(작업마다 `작업/<이름>/` 폴더), 힉스필드 로그인·크레딧, 강사 코드·남은 한도
- **가운데**: 대화. 도구 호출이 카드로 보이고, 아래에 할 일 목록이 있습니다. 결과는 프로그램이 직접 잰 길이·음량 카드로 나옵니다.
- **오른쪽**: 미리보기(재생, 타임라인, 측정값), 생성 대기열, 8fps 검수, 파일(끌어다 놓기로 넣기)
- **기본 모델**: `gpt-6.1-terra`, 추론 보통(medium). Responses API로 부릅니다. Terra는 Chat Completions에서 추론과 도구 호출을 함께 쓸 수 없기 때문입니다.
- **생성 흐름**: 스토리보드 → 키프레임 4장(OpenAI 이미지, 크레딧 0) → 사진 고르기 → 크레딧 허락 카드(Kling 3.0 5초 6.25) → 생성 → 8fps 검수
- 실제로 확인한 것:
  - Terra로 편집 한 바퀴: 18.000초, −14.2 LUFS, 0.0088달러
  - 키프레임 4장: 0.051달러
  - 사진 고르기
  - 허락 카드(거절로 답함)
- 아직 확인하지 못한 것: 클링 실제 생성. 로그인한 계정이 무료 플랜(0.08크레딧)입니다.
- 힉스필드가 비용 대신 "프리셋을 쓸까요?" 추천을 돌려줄 때가 있습니다. 무덱스는 추천을 거절하고(`declined_preset_id`) 프롬프트 그대로 만듭니다. 무료 체험 생성(unlim)은 쓰지 않고 크레딧으로 냅니다.

## MCP 연결 실습 (커넥터 화면)

왼쪽 아래 **🔌 커넥터 (MCP)**를 누르면 클로드의 "커스텀 커넥터 추가"와 같은 흐름을 그대로 해 볼 수 있습니다.

1. **＋ 커스텀 커넥터 추가**에서 이름 `Higgsfield`, 주소 `https://mcp.higgsfield.ai/mcp`를 넣습니다. "힉스필드 주소 넣기" 버튼을 써도 됩니다.
2. **연결**을 누르면 브라우저에 로그인 창이 뜹니다. 로그인하고 **허용**을 누릅니다.
3. 무덱스로 돌아오면 **● 연결됨 · 도구 185**가 보입니다.
4. **도구 보기**에서 검색하고 설명을 읽어 봅니다. `balance`를 **▶ 실행해 보기**로 눌러 첫 호출을 합니다.

| | 진짜 | 연습 모드(체크) |
|---|---|---|
| 로그인 창 | 힉스필드 실제 로그인(OAuth) | 무덱스가 띄우는 연습용 "허용" 창. 계정을 쓰지 않고 아무것도 보내지 않음 |
| 도구 목록 | 서버에서 실시간으로 받음(185개) | 2026-11-03에 받은 185개 그대로(`app/practice_tools.json`) |
| 실행해 보기 | 실제 결과(예: 0.08크레딧, free) | 같은 모양의 연습 값(200크레딧, starter) |
| 영상 생성 | 에이전트가 이 연결로 생성 | 생성은 안 됨 |

- 화면에서 눌러 볼 수 있는 도구는 크레딧이 들지 않는 조회 도구뿐입니다: `balance`, `models_explore`, `list_workspaces`, `get_preferences`, `list_voices`, `list_projects`.
- 힉스필드가 아닌 다른 원격 MCP 주소도 붙일 수 있습니다. 조건은 OAuth 동적 등록을 지원하는 서버입니다. 시험은 힉스필드로만 했습니다.
- **2026-11-03 점검 결과**:
  - 잘못된 주소 거절
  - 연결 전 도구 목록 거절
  - 연습: 로그인 창 → 허용 → 도구 185개 → balance
  - 생성 도구 직접 실행 차단
  - 진짜: 도구 185개, balance 실제 값

- 시연 영상·기록·화면 시안 그림은 공개 전인 영상 자료를 써서 이 저장소에는 넣지 않았습니다(강사 PC의 `시연/`, `mockups/assets/`).

## 폴더

```
app/            편집 에이전트 (Node, 의존성 없음)
  agent.mjs       모델 ↔ 도구 반복. 중계 서버만 부르고 OpenAI 키는 없음
  ffmpeg_tools.mjs 도구: list_clips, probe, trim, concat, add_music, export_final, measure
  cli.mjs         명령줄 시연
  make_demo.mjs   크레딧 없이 시험 재료(클립 3 + 음악) 만들기
relay/          중계 서버
  supabase/functions/mudex-relay/index.ts  엣지 함수(배포본과 같음)
  supabase/migrations/…sql                 DB 구조(mumuclass 프로젝트의 mudex 스키마)
  admin.mjs       강사용 코드 발급·조회·끄기
probe/          힉스필드 OAuth 로그인 시험
mockups/        화면 시안 2장 (html, png)
.secrets/       관리 비밀값, 힉스필드 토큰 (git 제외, 화면·로그에 안 찍음)
work/           작업 폴더 (git 제외)
```

## 실행 방법

필요한 것: Node 20 이상, ffmpeg와 ffprobe(PATH에 있거나 `bin/ffmpeg.exe`, `bin/ffprobe.exe`에 두기).

### 강사: 코드 발급

```bash
node relay/admin.mjs create 20 3 2026-11-28 "광주 2기"
```

인자는 차례로 개수, 1인 한도(달러), 만료일(그날 밤 23:59, 한국 시각), 이름입니다.

```bash
node relay/admin.mjs list
```

```bash
node relay/admin.mjs disable MDX-XXXX-XXXX
```

관리 비밀값은 `.secrets/admin_secret.txt`에 있습니다. DB에는 해시만 저장됩니다.

### 편집 에이전트 시연

```bash
node app/make_demo.mjs work/demo
```

```bash
node app/cli.mjs --code MDX-XXXX-XXXX --dir work/demo "클립 3개 이어 붙이고 18초로, 음악 얹어서 내보내 줘"
```

결과는 `work/demo/out/`에 생깁니다. 끝나면 모델의 말과 별개로 프로그램이 결과 파일의 길이와 음량을 직접 재서 보여 줍니다.

### 힉스필드 로그인 시험

```bash
node probe/hf_login.mjs
```

브라우저가 열리면 로그인하고 허용을 누릅니다(15분 대기). 성공하면 도구 목록이 `probe/hf_tools.json`에 저장되고 `balance` 결과가 찍힙니다. 크레딧은 쓰지 않습니다.

## 중계 서버

- 주소: `https://nqspbiprvsbjluqpjvpo.supabase.co/functions/v1/mudex-relay`
- `GET /status`: 남은 한도, 만료일, 허용 모델
- `POST /v1/chat/completions`: 허용 모델 gpt-5-mini, gpt-5-nano, gpt-5, gpt-4.1(-mini)
- `POST /v1/images/generations`: gpt-image-1, gpt-image-1-mini, 한 번에 최대 4장
- OpenAI 키는 Supabase 함수 비밀값 `OPENAI_API_KEY`에만 있습니다. 단가는 `mudex.models` 표에서 바꿉니다(재배포 필요 없음).
- 한도는 요청 **전**에 검사합니다. 그래서 한도 직전의 마지막 요청 하나만큼은 넘을 수 있습니다(보통 0.01달러 미만).

## 알아 둘 것

- **이 PC에서 Node `fs.rmSync`를 부르면 프로세스가 오류 없이 꺼집니다**(종료 코드 127). 그래서 무덱스 코드는 `unlinkSync`와 `rmdirSync`만 씁니다.
- 이미지 모델(gpt-image)은 OpenAI **조직 인증**(Settings → Organization → General → Verify Organization)이 끝나야 열립니다.
- ChatGPT Pro 구독의 월 API 크레딧은 **크레딧을 받은 조직의 키**로만 쓰입니다. 결제 주기가 끝나면 사라집니다.
- 힉스필드 REST API 키는 구독 크레딧과 결제가 따로라서 쓰지 않습니다. 연수생 크레딧을 쓰는 길은 MCP(OAuth)뿐입니다.

## 남은 일

1. 무덱스 안에서 힉스필드 도구를 에이전트 도구로 붙이기(generate_video, jobs_wait, media_upload), 토큰 자동 갱신.
2. 이미지 통로 실제 시험(조직 인증 뒤).
3. 화면 구현: 시안 기준 3단 화면, 로컬 서버 + 엣지 앱 창. 압축만 풀어 실행하는 판(Node·ffmpeg 동봉).
4. 클링 생성 한 번 시험. 사용자 허락을 받고 Kling 3.0 5초 약 6크레딧으로.

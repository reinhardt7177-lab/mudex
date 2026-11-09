# Cloudflare 운영 안내

공개 앱: https://mudex.reinhardt7177.workers.dev

## 로그인과 저장

강사 코드를 기존 중계 서버 `/status`로 검증한 뒤 7일짜리 HttpOnly·Secure 쿠키를 발급합니다. 코드로부터 HMAC으로 만든 작업공간 ID를 사용하므로 코드가 URL에 노출되지 않습니다. 코드마다 별도 Durable Object와 Container를 사용합니다. 코드 변경은 새 코드의 작업공간으로 이동합니다.

클라우드 로그인 서명 키는 Workers secret `SESSION_SECRET`입니다. 코드·토큰·파일은 브라우저 간에 공유되지 않습니다. 단, 같은 강사 코드를 공유하는 사람은 같은 사용자로 취급됩니다.

영구 데이터는 R2 `mudex-files`에 사용자별 경로로 보관합니다. 서버 시작 전에 복원하고, 변경 요청 응답·에이전트 완료·로그인 완료 전에 저장합니다. 서버가 실행 중이면 15초마다 추가 저장합니다. FFmpeg 임시 파일과 재생성할 수 있는 썸네일은 제외하고, 검수 시트는 저장합니다.

서버 종료 시 신규 요청을 막고 진행 중인 요청·영상 작업을 확인한 뒤 파일 저장을 완료하고 Container를 종료합니다. Containers 디스크만으로 영구 보관하지 않습니다.

## 재배포

화면 또는 Worker 수정:

```sh
npm ci
npm test
npm run check:deploy
npm run deploy
```

`app/` 서버 코드를 수정한 경우 Linux 이미지도 새로 만들어야 합니다. Docker를 사용할 수 있는 환경에서:

```sh
docker build --platform linux/amd64 -t mudex:cloud-v4 .
npx wrangler containers push mudex:cloud-v4
```

출력된 이미지 주소로 `wrangler.jsonc`의 `containers[0].image`를 갱신한 뒤 `npm run deploy`를 실행합니다. 새 태그를 사용하십시오. 처음 이미지가 준비되거나 이미지가 바뀐 뒤에는 배포 명령이 끝나도 서버 이미지 적용에 시간이 걸릴 수 있습니다.

```sh
npx wrangler whoami
npx wrangler containers list
npx wrangler containers instances a03eb806-9311-4d25-a8a6-1861f520ee3a
npx wrangler tail
```

이 PC의 최초 이미지는 Docker 서비스 설치 없이 `crane`으로 공식 Node 이미지에 FFmpeg와 앱 파일 레이어를 추가해서 만들었습니다. 기반 이미지의 SHA256은 Dockerfile에 고정했습니다. 저장소에는 사용자 파일·로컬 서명 키·임시 레지스트리 자격증명을 포함하지 않습니다.

## 확인 결과 (2026-11-09)

- 자동 테스트 11개: 세션 위조·만료, 사용자별 저장 경로, OAuth state, 강사 코드 연결, 업로드·작업 복원, 멀티파트 저장, 종료 중 동시 요청 차단, 코드 복구
- 로컬 실행 HTTP 200 유지
- 공개 앱: 잘못된 코드 거절, 로그인 없는 API 거절
- 실제 Containers: 1초 MP4 업로드 → ffprobe 길이·해상도 측정 → FFmpeg 썸네일 생성
- 다른 사용자의 파일 URL 접근 404
- 서버 프로세스 ID가 달라지는 완전 종료·재시작 뒤 R2 영상 바이트 일치 및 썸네일 재생성 확인
- 힉스필드 실제 OAuth 동적 등록 및 공개 HTTPS 콜백 주소 수락 확인. 사용자 계정으로 로그인 완료하거나 유료 영상 생성은 하지 않았습니다.
- 데스크톱 1440×1000, 모바일 390×844 화면 검토. 작은 화면의 작업·계정 및 파일·미리보기 메뉴 접근 확인

모델 대화·유료 영상 생성의 실제 실행에는 유효한 강사 코드와 사용자의 힉스필드 로그인이 필요합니다. 이번 배포 점검에서는 생성 비용을 사용하지 않았습니다.

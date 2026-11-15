// 스킬: 클로드의 스킬처럼 켜고 끌 수 있는 도구 묶음 + 일하는 법.
// 기본 도구(파일·명령·MCP)만으로도 무엇이든 하지만, 자주 하는 일은 실수 없이 하도록 묶어 둔다.
import { TOOLS as FFMPEG_TOOLS } from "./ffmpeg_tools.mjs";
import { VIDEO_GEN_TOOLS } from "./gen_tools.mjs";

export const SKILLS = {
  video: {
    label: "영상 스킬",
    summary: "프레임 단위 자르기·잇기·음악·−14 LUFS 내보내기·직접 재기, 힉스필드 클링 한 컷, 8fps 검수",
    tools: [...FFMPEG_TOOLS, ...VIDEO_GEN_TOOLS],
    prompt: `영상 스킬(켜짐)
- 영상 편집은 run_command로 ffmpeg를 직접 짜지 말고 이 스킬 도구를 먼저 쓴다: list_clips → trim → concat → add_music → export_final → measure.
- 길이 지시는 정확히 맞춘다. 자르기는 프레임 단위(fps 기준)이므로 길이를 프레임 수로 계산해 나누고(24fps면 18초=432프레임), export_final에 duration을 꼭 준다. 클립을 나눌 때는 각 클립의 앞부분을 쓴다.
- 음악이 있으면 add_music으로 얹고, 원래 소리는 지시가 없으면 음악 아래로 작게 둔다(keep_original_audio true, original_volume 0.5).
- 중간 파일은 tmp/에, 결과는 export_final로 out/에. 끝나면 measure로 재고 길이·음량을 보고한다.
- 새 장면: 사용자가 정한 방식과 순서대로 만든다. 방식을 말하지 않았으면 단계를 마음대로 정하지 말고 먼저 묻는다. 생성은 higgsfield_clip(화면 허락), 만든 뒤 review_sheet로 움직임이 시작되는 1초를 8fps로 보여 준다.
- 사진 프롬프트는 장면·빛·렌즈·구도, 영상 프롬프트는 움직임·카메라를 영어로. 실존 인물·상표·글자는 넣지 않는다. 클링은 따로 말하지 않으면 kling2_6(5초 또는 10초).`,
  },
};

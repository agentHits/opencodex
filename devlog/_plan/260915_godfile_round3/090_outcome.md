# 090 — 실제로 일어난 일과 계획의 차이

이 단위는 목표대로 끝났다. 다섯 파일이 facade 뒤로 분해돼 `origin/dev`(머지 커밋 `09067c586a`)에 있고, 착지 후 trunk 회귀도 성공했다. 다만 계획서가 약속한 전달 형태와 실제가 두 군데 다르고, "순수 이동"이라는 표현이 세 지점에서 정확하지 않다. 독립 감사가 그 둘을 지적했고 이 문서가 기록을 바로잡는다.

## 전달 형태: 6단 스택이 아니라 2개 PR

`000_plan.md`의 사이클 표는 파일마다 브랜치를 하나씩 두는 6단 체인(`codex/m3-l2-config` ~ `codex/m3-l6-openai-chat`)을 그렸고 완료 조건에 "6개 PR 전부 MERGED"를 적었다. 실제로는 두 개로 수렴했다.

| 실제 PR | 브랜치 | base | 내용 |
|---|---|---|---|
| [#4658](https://github.com/lidge-jun/opencodex/pull/4658) | `codex/m3-impl` | `codex/m3-l1-roadmap` | 다섯 파일 분해와 동반 수정 |
| [#4655](https://github.com/lidge-jun/opencodex/pull/4655) | `codex/m3-l1-roadmap` | `dev` | 로드맵 문서 + 위 구현의 trunk 착지 |

이유는 실행 방식에 있다. 다섯 파일은 서로 겹치지 않아서 한 워킹트리에서 다섯 에이전트가 동시에 작업했고, 그 결과가 한 트리에 함께 쌓였다. 파일별 커밋으로는 나눌 수 있었지만 브랜치로는 나눌 수 없었다. `structure/runtime.md`, `structure/providers/openai-tiers.md` 같은 소유 문서를 세 파일이 함께 고쳤기 때문에, 그 헝크를 브랜치별로 가르면 중간 레이어의 문서가 자기 트리와 어긋난다.

따라서 각 decade 문서가 적은 브랜치 이름(`010:5`의 `m3-l6-config`, `050:5`의 `m3-l6-adapters-chat`)과 PR 개수(`020` 3개, `030` 9개, `040` 6개)는 실행되지 않은 계획이다. 그 문서들의 이동 계약, 원본 행 범위, 함정 항목은 그대로 유효하고 실제로 그대로 실행됐다.

## "순수 이동"이 정확하지 않은 세 지점

감사가 파사드에서 삭제된 줄을 전수 대조해 찾아냈다. 잘라 붙이기만 한 것이 아니라 접근 방식이 바뀐 곳이 셋이다. 셋 다 동작은 같지만 기록은 정확해야 한다.

`src/config.ts`의 경고 메모는 원래 `Set.has`와 `Set.add`를 직접 불렀다. 지금은 `src/config/warn-memo.ts`의 접근자를 거친다. Set 선언과 reconcile 본문은 바이트 동일이지만 호출 지점이 달라졌다. 같은 파일의 기본값 병합 인라인 블록은 `src/config/diagnostics.ts`의 `mergeConfigDefaults`로 빠졌고 `typeof` 가드가 하나 늘었다. 핀 세 개와 providers 병합은 같다.

`src/codex/auth-api.ts`의 quota 시퀀스는 원래 변수를 직접 증감했고 지금은 `src/codex/auth-api/pool-quota-probe.ts`의 접근자 네 개를 거친다. 모듈 스코프 변수를 단일 소유로 유지하려면 다른 방법이 없었다. ESM live binding은 바깥에서 쓸 수 없기 때문이다.

## 검증 증거

- 파사드 export 표면은 분해 전후 동일하다. 감사가 `origin/dev~1`과 `origin/dev`로 독립 재현했다.
- 심볼 일곱 개의 본문을 바이트 비교해 동일함을 확인했다(`withConfigMutationLockSync`, `reconcileConfigWarningMemos`, `isTerminalPoolAuthResponse`, `fetchProviderModelsWithAuth`, `toolsToChatFormatForProvider`, `messagesToChatFormat`, ANTHROPIC 시드 3종).
- 새 리프 39개 중 최대가 1,221줄이다. 순환 import 없음, 상대 import 미해석 0.
- `#4655` exact head `9eb6290367`에서 24 SUCCESS / 2 SKIPPED. 착지 후 trunk 회귀는 run `34899536061`, head `09067c586a`, conclusion success.

## 보안 기록

`000_plan.md`가 `auth-api.ts`의 credential 이동에 "별도 검토 기록"을 요구했다. 그 기록은 [`#4655`의 통합 코멘트](https://github.com/lidge-jun/opencodex/pull/4655#issuecomment-5670986566)에 있다. access·refresh 토큰이 라우트 모듈에 도달하지 않고, Pool/Direct/API-key 조기 반환 술어 두 개가 한 게이트 모듈에 함께 남았으며, 로직 변경 없이 위치만 이동했다는 내용이다.

자동 리뷰어는 이 PR들을 보지 않았다. CodeRabbit은 base가 기본 브랜치가 아니면 auto review를 건너뛰고, `#4658`의 base는 `codex/m3-l1-roadmap`이었다. 그래서 이 단위의 코드 검토는 hosted CI와 위 독립 감사가 전부다.

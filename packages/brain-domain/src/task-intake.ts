import type {
  TaskIntakeSession,
  TaskIntakeSlot
} from "@agent/shared-types";

export type TaskIntakeFilledSlots = Partial<Record<TaskIntakeSlot, string>>;

export interface TaskIntakeAnalysis {
  requiredSlots: TaskIntakeSlot[];
  filledSlots: TaskIntakeFilledSlots;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function uniqueSlots(slots: TaskIntakeSlot[]): TaskIntakeSlot[] {
  return [...new Set(slots)];
}

const TASK_REQUEST_CUES = [
  /(해줘|해주세요|해 줄래|부탁해|보내줘|전달해줘|답장해줘|잡아줘|예약해줘|추가해줘|정리해줘|치워줘|확인해줘|찾아줘|실행해줘|옮겨줘|이동해줘)/,
  /(메일|이메일|문자|메시지|연락|일정|약속|미팅|회의|캘린더|스케줄|브라우저|탭|파일|폴더|바탕화면|다운로드|메일함|워크스페이스|프로젝트)/
];

const LOCATION_PATTERNS = [
  /(바탕화면|다운로드|문서|프로젝트|폴더|workspace|탭|메일함|브라우저|사진첩|데스크톱)/
];

const TIME_PATTERNS = [
  /(오늘|내일|모레|다음 주|이번 주|주말|월요일|화요일|수요일|목요일|금요일|토요일|일요일|오전|오후|저녁|아침|점심|밤)/,
  /\b\d{1,2}시\b/,
  /\b\d{1,2}:\d{2}\b/,
  /\b\d{1,2}월 \d{1,2}일\b/,
  /\b\d{1,2}\/\d{1,2}\b/
];

export function looksLikeStandaloneTaskRequest(text: string): boolean {
  return hasAny(normalize(text), TASK_REQUEST_CUES);
}

export function inferRequiredSlots(text: string): TaskIntakeSlot[] {
  const normalized = normalize(text);
  const required: TaskIntakeSlot[] = [];

  const hasScheduleDomain = hasAny(normalized, [
    /(일정|약속|미팅|회의|캘린더|스케줄)/
  ]);
  const hasScheduleAction = hasAny(normalized, [/(잡아줘|예약해줘|추가해줘)/]);
  const isScheduleTask = hasScheduleDomain || (hasScheduleAction && hasAny(normalized, TIME_PATTERNS) === false);

  if (isScheduleTask) {
    required.push("time");
  }

  const hasMessageDomain = hasAny(normalized, [/(메일|이메일|문자|메시지|연락)/]);
  const hasMessageAction = hasAny(normalized, [/(보내줘|전달해줘|답장해줘)/]);
  const isMessageTask = hasMessageDomain && hasMessageAction;

  if (isMessageTask) {
    required.push("target");
  }

  const hasCleanupAction = hasAny(normalized, [/(정리|cleanup|clean up|치워|정돈)/]);
  const hasCleanupDomain = hasAny(normalized, [
    /(브라우저|탭|파일|폴더|바탕화면|다운로드|메일함|사진|문서|workspace|프로젝트)/
  ]);
  const isCleanupTask = hasCleanupAction && hasCleanupDomain;

  if (isCleanupTask) {
    if (!hasAny(normalized, LOCATION_PATTERNS)) {
      required.push("location");
    }

    required.push("scope");
  }

  if (
    hasAny(normalized, [/(삭제|지워|제거|비워)/])
  ) {
    if (!hasAny(normalized, LOCATION_PATTERNS)) {
      required.push("location");
    }
    required.push("risk_ack");
  }

  return uniqueSlots(required);
}

export function extractFilledSlots(
  text: string
): TaskIntakeFilledSlots {
  const normalized = normalize(text);
  const filled: Partial<Record<TaskIntakeSlot, string>> = {};

  if (
    hasAny(normalized, [/(에게|한테|to )/, /(엄마|아빠|팀|고객|매니저|친구|민수|지은|지훈|수진)/])
  ) {
    filled.target = text.trim();
  }

  if (hasAny(normalized, TIME_PATTERNS)) {
    filled.time = text.trim();
  }

  if (hasAny(normalized, LOCATION_PATTERNS)) {
    filled.location = text.trim();
  }

  if (
    hasAny(normalized, [
      /(중복|오래된|안 읽은|불필요한|중요한 건 빼고|임시 파일|관련 없는|사진만|문서만|탭만|메일만|종류별|파일 종류별|확장자별|날짜별|큰 파일만|큰 파일부터|작은 파일만|폴더별)/,
      /(어디까지|범위|scope|만 정리|만 삭제|만 남기고)/
    ])
  ) {
    filled.scope = text.trim();
  }

  if (
    hasAny(normalized, [/(괜찮|승인|확인했어|삭제해도 돼|지워도 돼|백업했어|응 지워)/])
  ) {
    filled.risk_ack = text.trim();
  }

  return filled;
}

function computeMissingSlots(
  requiredSlots: TaskIntakeSlot[],
  filledSlots: TaskIntakeFilledSlots
): TaskIntakeSlot[] {
  return requiredSlots.filter((slot) => !filledSlots[slot]);
}

function appendWorkingText(
  workingText: string,
  filledSlots: TaskIntakeFilledSlots
): string {
  let next = workingText.trim();
  let appended = false;

  for (const value of Object.values(filledSlots)) {
    if (!value) {
      continue;
    }

    const normalizedValue = normalize(value);
    if (!normalize(next).includes(normalizedValue)) {
      next = `${next} ${value}`.trim();
      appended = true;
    }
  }

  return appended ? next : workingText.trim();
}

export function buildTaskIntakeSession(
  text: string,
  brainSessionId: string,
  now: string,
  analysis?: TaskIntakeAnalysis
): TaskIntakeSession {
  const sourceText = text.trim();
  const requiredSlots = analysis?.requiredSlots ?? inferRequiredSlots(sourceText);
  const filledSlots = analysis?.filledSlots ?? extractFilledSlots(sourceText);
  const missingSlots = computeMissingSlots(requiredSlots, filledSlots);

  return {
    brainSessionId,
    status: missingSlots.length === 0 ? "ready" : "collecting",
    sourceText,
    workingText: sourceText,
    requiredSlots,
    filledSlots,
    missingSlots,
    createdAt: now,
    updatedAt: now
  };
}

export function mergeTaskIntakeAnswer(
  session: TaskIntakeSession,
  answerText: string,
  now: string,
  filledSlotPatch?: TaskIntakeFilledSlots
): TaskIntakeSession {
  const newlyFilled = filledSlotPatch ?? extractFilledSlots(answerText);
  const filledSlots = {
    ...session.filledSlots,
    ...newlyFilled
  };
  const missingSlots = computeMissingSlots(session.requiredSlots, filledSlots);

  return {
    ...session,
    status: missingSlots.length === 0 ? "ready" : "collecting",
    filledSlots,
    missingSlots,
    workingText: appendWorkingText(
      session.workingText,
      newlyFilled
    ),
    updatedAt: now
  };
}

export function isTaskIntakeReady(session: TaskIntakeSession): boolean {
  return session.missingSlots.length === 0;
}

export function buildExecutableTaskText(session: TaskIntakeSession): string {
  return session.workingText;
}

export function findMissingTaskSlots(text: string): TaskIntakeSlot[] {
  return buildTaskIntakeSession(text, "preview", "now").missingSlots;
}

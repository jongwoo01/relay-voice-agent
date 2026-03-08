import type { TaskIntakeSlot } from "@agent/shared-types";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function findMissingTaskSlots(text: string): TaskIntakeSlot[] {
  const normalized = normalize(text);
  const missing = new Set<TaskIntakeSlot>();

  const isScheduleTask = hasAny(normalized, [
    /(일정|약속|미팅|회의|캘린더|스케줄)/,
    /(잡아줘|예약해줘|추가해줘)/
  ]);

  if (
    isScheduleTask &&
    !hasAny(normalized, [
      /(오늘|내일|모레|다음 주|이번 주|오전|오후|저녁|아침|점심|밤)/,
      /\b\d{1,2}시\b/,
      /\b\d{1,2}:\d{2}\b/,
      /\b\d{1,2}월 \d{1,2}일\b/
    ])
  ) {
    missing.add("time");
  }

  const isMessageTask = hasAny(normalized, [
    /(메일|이메일|문자|메시지|연락)/,
    /(보내줘|전달해줘|답장해줘)/
  ]);
  if (isMessageTask && !hasAny(normalized, [/(에게|한테|to )/, /(엄마|아빠|팀|고객|매니저|친구)/])) {
    missing.add("target");
  }

  const isCleanupTask = hasAny(normalized, [
    /(정리|cleanup|clean up|치워|정돈)/,
    /(브라우저|탭|파일|폴더|바탕화면|다운로드|메일함)/
  ]);
  if (
    isCleanupTask &&
    !hasAny(normalized, [
      /(브라우저|탭|파일|폴더|바탕화면|다운로드|메일함|사진|문서|workspace|프로젝트)/
    ])
  ) {
    missing.add("scope");
  }

  if (hasAny(normalized, [/(옮겨|이동|정리|정돈|정리해줘|확인해줘)/]) && !hasAny(normalized, [/(바탕화면|다운로드|문서|프로젝트|폴더|workspace|탭|메일함)/])) {
    missing.add("location");
  }

  if (
    hasAny(normalized, [/(삭제|지워|제거|비워)/]) &&
    !hasAny(normalized, [/(괜찮|승인|확인했어|중요한 건 빼고|백업)/])
  ) {
    missing.add("risk_ack");
  }

  return [...missing];
}

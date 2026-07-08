const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// uuid 컬럼에 형식이 아닌 값을 그대로 질의하면 PostgreSQL 캐스팅 오류로
// 500이 된다 — 조회 전에 걸러 "없음"으로 취급하기 위한 헬퍼.
export function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

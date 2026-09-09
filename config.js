// ─────────────────────────────────────────────────────────────
//  로그인 설정
//
//  Supabase 프로젝트를 만든 뒤, 아래 두 줄에 값을 붙여넣으세요.
//  (Supabase 대시보드 → Project Settings → API 에서 복사)
//
//    SUPABASE_URL : https://dvgnqnfriocrtvwwspft.supabase.co/rest/v1/
//    SUPABASE_KEY : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2Z25xbmZyaW9jcnR2d3dzcGZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NTczMDcsImV4cCI6MjEwNDUzMzMwN30.1CsOVGmJTYpagwBXHl3tl9gzcCU07wGngxCAN95uHzQ
//
//  * 이 키는 공개돼도 되는 키입니다. GitHub에 올라가도 괜찮아요.
//    대신 LOGIN-SETUP.md 에 있는 SQL을 꼭 실행해서 보안 규칙(RLS)을 켜 두세요.
//    그래야 다른 사람이 내 잔고를 읽거나 바꿀 수 없습니다.
//
//  * 비워두면 로그인 기능만 꺼진 채로, 지금처럼 브라우저 저장으로 잘 동작합니다.
// ─────────────────────────────────────────────────────────────
window.APP_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
};

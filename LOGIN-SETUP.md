# 구글 로그인 붙이기 (30~40분)

이 문서대로만 하면 로그인 기능이 켜집니다.
**아직 안 해도 사이트는 잘 돌아갑니다** — 설정 전에는 로그인 버튼이 아예 안 보이고,
지금처럼 브라우저 저장으로 동작합니다.

준비물: 구글 계정 하나, 이미 배포된 사이트 주소 (`https://○○○.vercel.app`)

---

## 1단계 · Supabase 프로젝트 만들기 (10분)

1. <https://supabase.com> 접속 → **Start your project** → 깃허브 계정으로 로그인
2. **New project** 클릭
   - Name: `mock-trading` (아무거나)
   - Database Password: 아무거나 만들고 **어딘가 적어두세요** (나중에 쓸 일은 거의 없음)
   - Region: `Northeast Asia (Seoul)` 선택
3. **Create new project** → 2분 정도 기다리면 준비됩니다

## 2단계 · 데이터 저장할 표 만들기 (3분)

왼쪽 메뉴에서 **SQL Editor** → **New query** → 아래를 통째로 붙여넣고 **Run** 을 누르세요.

```sql
create table if not exists public.portfolios (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.portfolios enable row level security;

drop policy if exists "read own portfolio" on public.portfolios;
create policy "read own portfolio" on public.portfolios
  for select using (auth.uid() = user_id);

drop policy if exists "insert own portfolio" on public.portfolios;
create policy "insert own portfolio" on public.portfolios
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own portfolio" on public.portfolios;
create policy "update own portfolio" on public.portfolios
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

> 이 SQL의 뒷부분(`row level security`)이 **보안의 핵심**입니다.
> 이걸 켜야 로그인한 사람이 자기 잔고만 읽고 쓸 수 있어요. 빼먹으면 안 됩니다.

## 3단계 · 구글 로그인 열쇠 만들기 (15분)

먼저 Supabase에서 주소 하나를 복사해 둡니다.

- Supabase 왼쪽 메뉴 **Authentication** → **Sign In / Providers** → **Google** 클릭
- 거기 적힌 **Callback URL** 을 복사 (`https://xxxx.supabase.co/auth/v1/callback` 형태)
- 이 창은 켜 둔 채로 다음으로 넘어가세요

이제 구글 쪽 설정입니다.

1. <https://console.cloud.google.com> 접속 → 위쪽에서 **프로젝트 만들기** → 이름 아무거나
2. 검색창에 `Google Auth Platform` 입력 → **브랜딩(Branding)** 에서 앱 정보 입력
   - 앱 이름: `모의투자 데스크`, 사용자 지원 이메일: 본인 이메일
   - 대상(Audience): **외부(External)**
   - **애플리케이션 홈페이지**: `https://○○○.vercel.app`
   - **개인정보처리방침 URL**: `https://○○○.vercel.app/privacy.html`
   - **서비스 약관 URL**: `https://○○○.vercel.app/terms.html`
   - 앱 로고는 비워두세요 (넣으면 구글 심사 대상이 됩니다)
   - 홈페이지·방침 URL은 **프로덕션으로 게시할 때 필수**입니다. 이 저장소의 `privacy.html`,
     `terms.html` 이 배포돼 있어야 입력할 수 있습니다.
3. **사용자 인증 정보(Credentials)** → **사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - **승인된 JavaScript 원본** 에 추가:
     - `https://○○○.vercel.app` (내 사이트 주소)
     - `http://localhost:3000` (내 컴퓨터에서 테스트할 때 필요)
   - **승인된 리디렉션 URI** 에 추가:
     - 아까 복사한 Supabase **Callback URL**
   - 만들기 → **클라이언트 ID**와 **클라이언트 보안 비밀번호**가 뜹니다 (복사)
4. 다시 **OAuth 동의 화면** 으로 가서 **앱 게시(PUBLISH APP)** 를 누르세요.
   - 이걸 안 하면 내가 등록한 테스트 계정만 로그인됩니다. 아무나 쓰게 하려면 필수예요.

## 4단계 · Supabase에 열쇠 넣기 (2분)

1. 켜 뒀던 Supabase **Authentication → Providers → Google** 화면으로 돌아가서
   - **Enable Sign in with Google** 켜기
   - Client ID / Client Secret 붙여넣기 → **Save**
2. **Authentication → URL Configuration**
   - **Site URL**: `https://○○○.vercel.app`
   - **Redirect URLs** 에 아래 두 개 추가:
     - `https://○○○.vercel.app`
     - `http://localhost:3000`

## 5단계 · 사이트에 연결하기 (2분)

1. Supabase **Project Settings → API** 에서 두 가지를 복사
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public** 키 (`Publishable key` 로 표시될 수도 있습니다)
2. 프로젝트 폴더의 **`config.js`** 를 열어 붙여넣기

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_KEY: "여기에_공개키_붙여넣기",
};
```

3. `config.js` 를 GitHub에 올리면 → Vercel이 자동 배포 → 사이트에 **구글로 로그인** 버튼이 생깁니다.

> **이 키를 공개해도 되나요?** 네. 이 키는 공개용으로 설계된 키이고,
> 2단계에서 켠 보안 규칙(RLS)이 "각자 자기 데이터만" 접근하도록 막아줍니다.
> 대신 **`service_role` 키는 절대로** 이 파일이나 GitHub에 넣지 마세요.

---

## 확인해 보기

1. 사이트 접속 → 로그인 없이 몇 주 매수 → **구글로 로그인**
2. "게스트로 하던 잔고와 거래내역을 계정으로 옮겼어요" 안내가 뜨면 성공
3. 휴대폰에서 같은 사이트 → 같은 구글 계정으로 로그인 → **PC와 같은 잔고**가 보이면 완성

## 잘 안 될 때

| 증상 | 원인 / 해결 |
|---|---|
| 로그인 후 `redirect_uri_mismatch` | 구글의 **승인된 리디렉션 URI** 가 Supabase Callback URL과 정확히 같은지 확인 |
| 로그인은 되는데 잔고가 안 옮겨짐 | 2단계 SQL을 실행했는지 확인 (SQL Editor에서 다시 Run 해도 안전합니다) |
| "계정 데이터를 불러오지 못했어요" | 표 이름이 `portfolios` 인지, RLS 정책 3개가 다 만들어졌는지 확인 |
| 나만 로그인되고 남들은 안 됨 | 3단계 4번 **앱 게시(PUBLISH APP)** 를 안 한 경우 |
| 로그인 버튼이 안 보임 | `config.js` 의 두 값이 비어 있거나 오타 |

## 알아둘 점

- 무료 플랜은 월 사용자 5만 명, DB 500MB까지입니다. 이 사이트 규모에서는 한참 남습니다.
- 다만 **1주일 동안 아무도 접속 안 하면** Supabase 프로젝트가 자동으로 잠자기 상태가 됩니다.
  대시보드에서 한 번 깨워주면 다시 동작합니다.
- 로그아웃하면 다시 게스트 상태(이 브라우저 저장)로 돌아갑니다.

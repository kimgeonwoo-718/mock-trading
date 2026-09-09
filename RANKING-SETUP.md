# 수익률 랭킹 켜기 (3분)

랭킹 기능을 쓰려면 Supabase에 표를 하나 더 만들어야 합니다.
**이 SQL을 실행하기 전까지는** 사이트에 랭킹 칸이 보이긴 하지만
"랭킹을 불러오지 못했어요"라고 나옵니다.

로그인 설정([LOGIN-SETUP.md](./LOGIN-SETUP.md))이 먼저 끝나 있어야 합니다.

## 실행할 SQL

Supabase → **SQL Editor** → **New query** → 아래를 통째로 붙여넣고 **Run**.

```sql
create table if not exists public.leaderboard (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  nickname     text not null check (char_length(nickname) between 2 and 12),
  total_assets numeric not null,
  return_pct   numeric not null,
  updated_at   timestamptz not null default now()
);

-- 같은 닉네임 중복 방지 (대소문자 구분 없이)
create unique index if not exists leaderboard_nickname_key
  on public.leaderboard (lower(nickname));

alter table public.leaderboard enable row level security;

-- 순위는 누구나(로그인 안 한 사람도) 볼 수 있게
drop policy if exists "read leaderboard" on public.leaderboard;
create policy "read leaderboard" on public.leaderboard
  for select using (true);

-- 쓰기는 자기 줄만
drop policy if exists "insert own rank" on public.leaderboard;
create policy "insert own rank" on public.leaderboard
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own rank" on public.leaderboard;
create policy "update own rank" on public.leaderboard
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own rank" on public.leaderboard;
create policy "delete own rank" on public.leaderboard
  for delete using (auth.uid() = user_id);
```

`Success. No rows returned` 이 뜨면 성공입니다.

## 어떻게 동작하나

- 랭킹은 **로그인한 사람이 직접 참가 버튼을 눌러야** 올라갑니다. 자동으로 올라가지 않아요.
- 참가할 때 닉네임을 정하고, 그 뒤로는 자산이 바뀔 때마다(몇 초 뒤) 자동으로 순위가 갱신됩니다.
- 순위표에 보이는 것: **닉네임, 총자산, 수익률**. 이메일이나 구글 이름은 공개되지 않습니다.
- "참가 취소"를 누르면 내 줄이 삭제되고 순위에서 사라집니다.
- 랭킹은 로그인하지 않은 방문자도 구경할 수 있습니다 (참가만 로그인 필요).

## 알아둘 점

- 순위 숫자는 **브라우저에서 계산해서 보내는 값**입니다. 마음먹고 조작하려는 사람은
  가짜 수익률을 올릴 수 있어요. 가상의 돈이라 실질적인 피해는 없지만, 나중에 사람이 많아지면
  서버에서 검증하는 방식으로 바꾸는 게 좋습니다.
- 닉네임은 2~12자이고 중복될 수 없습니다.
- 표를 지우고 싶으면 `drop table public.leaderboard;` 를 실행하면 됩니다.

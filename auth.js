// 구글 로그인 + 계정별 데이터 저장 (Supabase)
//
// config.js 에 값이 비어 있으면 이 파일은 아무 일도 하지 않습니다.
// 그 경우 사이트는 로그인 없이(게스트 전용) 지금까지처럼 동작합니다.
window.Auth = (function () {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_KEY);

  let client = null;
  let user = null;
  let listener = null;
  let ready = false;

  function sdk() {
    // CDN(UMD)으로 불러오면 window.supabase 에 들어옵니다.
    const lib = window.supabase || window.Supabase;
    return lib && typeof lib.createClient === "function" ? lib : null;
  }

  function displayName() {
    if (!user) return "";
    const meta = user.user_metadata || {};
    return meta.full_name || meta.name || user.email || "사용자";
  }

  function avatarUrl() {
    const meta = (user && user.user_metadata) || {};
    return meta.avatar_url || meta.picture || "";
  }

  // 로그인 상태를 확인하고, 이후 상태가 바뀌면 onChange 를 불러줍니다.
  async function init(onChange) {
    listener = onChange;
    if (!configured) return null;

    const lib = sdk();
    if (!lib) {
      console.warn("Supabase 라이브러리를 불러오지 못했습니다.");
      return null;
    }

    client = lib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    try {
      const { data } = await client.auth.getSession();
      user = data && data.session ? data.session.user : null;
    } catch (err) {
      console.warn("로그인 상태 확인 실패:", err);
      user = null;
    }
    ready = true;

    client.auth.onAuthStateChange((event, session) => {
      const next = session ? session.user : null;
      const prevId = user ? user.id : null;
      const nextId = next ? next.id : null;
      user = next;
      if (prevId !== nextId && listener) listener(user, event);
    });

    return user;
  }

  async function signInWithGoogle() {
    if (!client) throw new Error("NOT_CONFIGURED");
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
  }

  // 계정에 저장된 스냅샷을 가져옵니다. 아직 없으면 null.
  async function loadRemote() {
    if (!client || !user) return null;
    const { data, error } = await client
      .from("portfolios")
      .select("data")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  }

  // 스냅샷을 계정에 저장합니다 (있으면 덮어쓰기).
  async function saveRemote(snapshot) {
    if (!client || !user) throw new Error("NOT_SIGNED_IN");
    const { error } = await client
      .from("portfolios")
      .upsert({ user_id: user.id, data: snapshot, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
  }

  return {
    configured,
    init,
    signInWithGoogle,
    signOut,
    loadRemote,
    saveRemote,
    isReady: () => ready,
    getUser: () => user,
    displayName,
    avatarUrl,
  };
})();

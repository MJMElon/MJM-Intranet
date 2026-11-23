/* MJM Intranet：Supabase 设定（anon key 是公开的，权限由数据库 RLS 控制） */
window.GW_CONFIG = {
  supabaseUrl: "https://briqzyxfxsvulyizzbiu.supabase.co",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyaXF6eXhmeHN2dWx5aXp6Yml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDc3ODksImV4cCI6MjA4OTUyMzc4OX0.LGs2Jd3jiAQsfgtzBU_yfTIjEEVWsWgd0n_mOyrAl1Q",
  // 公司时区（日期显示）
  timeZone: "Asia/Kuala_Lumpur",
};

/* 本地开发：网址带 ?local 或在 localhost 时，可用 localStorage 的 gw_local_config 覆盖 */
(function () {
  try {
    const local = localStorage.getItem("gw_local_config");
    if (local && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      Object.assign(window.GW_CONFIG, JSON.parse(local));
    }
  } catch (e) {
    /* 忽略 */
  }
})();

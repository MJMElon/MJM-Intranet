/* 每个页面 <head> 第一个载入：主题（避免闪烁）、Tailwind、共用函式库。
   函式库版本固定，升级时一次改这里。 */
(function () {
  try {
    const theme = localStorage.getItem("gw_theme") || "system";
    const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {
    /* 忽略 */
  }

  const base = document.currentScript.src.replace(/shared\/head\.js.*$/, "");
  // 每次发布 GitHub Actions 把 __GW_VERSION__ 换成那次的版本号：浏览器才会拿新的档案，不会一直用旧的
  const ver = "?v=__GW_VERSION__";
  const libs = [
    // 函式库放在自己的网站（shared/vendor），不从 CDN 载入：CDN 被入侵也影响不到这里
    base + "shared/vendor/supabase-js-2.118.0.js",
    base + "shared/vendor/lucide-0.469.0.min.js",
    base + "shared/config.js" + ver,
    base + "lang/en.js" + ver,
    base + "shared/core.js" + ver,
  ];
  // 样式是事先编译好的（shared/app.css）；改了画面的 class 之后执行 npm run build:css
  document.write('<link rel="stylesheet" href="' + base + 'shared/app.css' + ver + '">');
  libs.forEach((src) => document.write('<script src="' + src + '"><\/script>'));
})();

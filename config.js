// ===== 部署配置 =====
// 内网 / 本机使用：保持 API_BASE 为空字符串 ""（前端和后端在同一台机器，直接同源调用）。
// 部署到 GitHub Pages 等独立站点：把 API_BASE 改成你后端的公网地址（隧道地址），
//   例如： "https://zhongcao.example.com"   注意末尾不要带斜杠 "/"。
window.APP_CONFIG = {
  API_BASE: "https://valuable-biz-albany-examined.trycloudflare.com",
};

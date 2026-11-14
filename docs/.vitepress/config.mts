import { defineConfig } from "vitepress";

const chineseSidebar = [
  {
    text: "入门与使用",
    items: [
      { text: "快速开始", link: "/guide/quickstart" },
      { text: "Android App", link: "/guide/android-app" },
      { text: "MCP 客户端", link: "/guide/mcp-client" },
      { text: "Webhook 消息", link: "/guide/webhooks" },
    ],
  },
  {
    text: "开发与维护",
    items: [
      { text: "API 参考", link: "/guide/api-reference" },
      { text: "隐私与安全", link: "/guide/privacy-security" },
      { text: "部署、开发与发布", link: "/guide/operations" },
    ],
  },
];

const englishSidebar = [
  {
    text: "Guides",
    items: [
      { text: "Quick start", link: "/en/guide/quickstart" },
      { text: "Android app", link: "/en/guide/android-app" },
      { text: "MCP client", link: "/en/guide/mcp-client" },
      { text: "Webhook messages", link: "/en/guide/webhooks" },
    ],
  },
  {
    text: "Reference",
    items: [
      { text: "API reference", link: "/en/guide/api-reference" },
      { text: "Privacy & security", link: "/en/guide/privacy-security" },
      { text: "Operations & release", link: "/en/guide/operations" },
    ],
  },
];

export default defineConfig({
  title: "CanaryMCP",
  description: "Android device context with owner-controlled Remote MCP and webhooks",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/BOOMDEE/CanaryMCP" }],
  },
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      themeConfig: {
        nav: [
          { text: "指南", link: "/guide/quickstart" },
          { text: "API", link: "/guide/api-reference" },
          { text: "隐私与安全", link: "/guide/privacy-security" },
        ],
        sidebar: chineseSidebar,
        outline: { label: "本页目录" },
        docFooter: { prev: "上一页", next: "下一页" },
      },
    },
    en: {
      label: "English",
      lang: "en-US",
      themeConfig: {
        nav: [
          { text: "Guides", link: "/en/guide/quickstart" },
          { text: "API", link: "/en/guide/api-reference" },
          { text: "Privacy & security", link: "/en/guide/privacy-security" },
        ],
        sidebar: englishSidebar,
        outline: { label: "On this page" },
        docFooter: { prev: "Previous", next: "Next" },
      },
    },
  },
});

// web/src/lib/keywords.ts — v1 中文/英文關鍵詞字典（人工列舉，非完整分詞）。
// spec §3.3：文字分析只分析 Series.title，每系列標題對同關鍵字最多計 1。
// 英文關鍵詞在 token 邊界命中（/^[A-Za-z0-9]+$/ → 以 token 集合比對，AI 不命中 SAIL）；
// 中文關鍵詞以子字串比對（不執行期切詞）。
// 關鍵詞本身為純數字或英文停用詞 → titleKeywordStats 排除（review #3 補強 1）。
export const DEFAULT_KEYWORDS: string[] = [
  "AI", "Agent", "實戰", "系統", "開發", "Claude", "Coding", "Vibe",
  "自動化", "資安", "資料", "架構", "設計", "Codex", "工作流", "LLM",
  "前端", "測試", "ChatGPT", "安全", "Gemini", "Kubernetes", "後端",
  "部署", "MCP", "RAG", "K8s", "效能", "開源", "雲端",
];

// 英文停用詞：作為關鍵詞傳入時被排除（不列入統計）。
export const ENGLISH_STOPWORDS: string[] = [
  "a", "an", "the", "of", "for", "with", "and", "to", "in", "on",
  "at", "from", "by", "is", "are", "it", "this", "that", "as", "or",
];

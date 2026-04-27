'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

type ApiRes<T = unknown> = { success: boolean; data?: T; error?: string }

const api = {
  get: <T = unknown>(path: string) => fetchApi<ApiRes<T>>(path),
  post: <T = unknown>(path: string, body: unknown) =>
    fetchApi<ApiRes<T>>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T = unknown>(path: string, body: unknown) =>
    fetchApi<ApiRes<T>>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path: string) =>
    fetchApi<ApiRes>(path, { method: 'DELETE' }),
}

interface AiSettingsData {
  id: string
  provider: string
  api_key: string
  model_id: string
  system_prompt: string | null
  max_tokens: number
  temperature: number
  is_active: number
}

interface KnowledgeArticle {
  id: string
  title: string
  category: string
  content: string
  source_url: string | null
  is_active: number
  created_at: string
}

interface AiReplyLog {
  id: string
  friend_id: string
  display_name: string | null
  user_message: string
  ai_response: string
  tokens_used: number
  latency_ms: number
  created_at: string
}

const CATEGORIES = [
  { value: 'general', label: '一般' },
  { value: 'product', label: '商品情報' },
  { value: 'shipping', label: '送料・配送' },
  { value: 'faq', label: 'よくある質問' },
  { value: 'policy', label: 'ポリシー' },
  { value: 'campaign', label: 'キャンペーン' },
]

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'google', label: 'Google (Gemini)' },
]

const MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  google: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
}

export default function AiSettingsPage() {
  // --- AI Settings State ---
  const [settings, setSettings] = useState<AiSettingsData | null>(null)
  const [provider, setProvider] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('claude-sonnet-4-6')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState(500)
  const [temperature, setTemperature] = useState(0.7)
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [originalApiKey, setOriginalApiKey] = useState('')

  // --- Test ---
  const [testMessage, setTestMessage] = useState('')
  const [testResponse, setTestResponse] = useState('')
  const [testing, setTesting] = useState(false)

  // --- Knowledge ---
  const [articles, setArticles] = useState<KnowledgeArticle[]>([])
  const [showAddArticle, setShowAddArticle] = useState(false)
  const [editArticle, setEditArticle] = useState<KnowledgeArticle | null>(null)
  const [articleTitle, setArticleTitle] = useState('')
  const [articleCategory, setArticleCategory] = useState('general')
  const [articleContent, setArticleContent] = useState('')
  const [articleUrl, setArticleUrl] = useState('')

  // --- Scrape ---
  const [showScrape, setShowScrape] = useState(false)
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [scraping, setScraping] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<{ title: string; content: string; sourceUrl: string } | null>(null)

  // --- Logs ---
  const [logs, setLogs] = useState<AiReplyLog[]>([])
  const [activeTab, setActiveTab] = useState<'settings' | 'knowledge' | 'logs'>('settings')

  // --- Toast ---
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2500)
  }

  const fetchSettings = useCallback(async () => {
    try {
      const res = await api.get('/api/ai-settings')
      if (res.success && res.data) {
        const d = res.data as AiSettingsData
        setSettings(d)
        setProvider(d.provider)
        setApiKey(d.api_key)
        setOriginalApiKey(d.api_key)
        setModelId(d.model_id)
        setSystemPrompt(d.system_prompt || '')
        setMaxTokens(d.max_tokens)
        setTemperature(d.temperature)
        setIsActive(Boolean(d.is_active))
      }
    } catch {}
  }, [])

  const fetchArticles = useCallback(async () => {
    try {
      const res = await api.get('/api/knowledge')
      if (res.success) setArticles(res.data as KnowledgeArticle[])
    } catch {}
  }, [])

  const fetchLogs = useCallback(async () => {
    try {
      const res = await api.get('/api/ai-reply-logs?limit=50')
      if (res.success) setLogs(res.data as AiReplyLog[])
    } catch {}
  }, [])

  useEffect(() => {
    fetchSettings()
    fetchArticles()
    fetchLogs()
  }, [fetchSettings, fetchArticles, fetchLogs])

  // --- Handlers ---
  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      const apiKeyChanged = apiKey !== originalApiKey
      const res = await api.put('/api/ai-settings', {
        provider,
        apiKey: apiKeyChanged ? apiKey : undefined,
        modelId,
        systemPrompt: systemPrompt || null,
        maxTokens,
        temperature,
        isActive,
      })
      if (res.success) {
        showToast('設定を保存しました')
        await fetchSettings()
      } else {
        showToast(`保存失敗: ${(res as { error?: string }).error || '不明なエラー'}`, 'error')
      }
    } catch (err) {
      showToast(`保存失敗: ${String(err)}`, 'error')
    }
    setSaving(false)
  }

  const handleTest = async () => {
    if (!testMessage.trim()) return
    setTesting(true)
    setTestResponse('')
    try {
      const res = await api.post('/api/ai-settings/test', { message: testMessage })
      if (res.success) {
        const d = res.data as { response: string; tokensUsed: number; latencyMs: number }
        setTestResponse(`${d.response}\n\n--- ${d.tokensUsed} tokens / ${d.latencyMs}ms ---`)
      } else {
        setTestResponse(`エラー: ${(res as { error?: string }).error || '不明なエラー'}`)
      }
    } catch (err) {
      setTestResponse(`エラー: ${String(err)}`)
    }
    setTesting(false)
  }

  const handleSaveArticle = async () => {
    if (!articleTitle.trim() || !articleContent.trim()) return
    try {
      if (editArticle) {
        await api.put(`/api/knowledge/${editArticle.id}`, {
          title: articleTitle,
          category: articleCategory,
          content: articleContent,
          sourceUrl: articleUrl || null,
        })
        showToast('ナレッジを更新しました')
      } else {
        await api.post('/api/knowledge', {
          title: articleTitle,
          category: articleCategory,
          content: articleContent,
          sourceUrl: articleUrl || null,
        })
        showToast('ナレッジを追加しました')
      }
      resetArticleForm()
      await fetchArticles()
    } catch (err) {
      showToast(`保存失敗: ${String(err)}`, 'error')
    }
  }

  const handleDeleteArticle = async (id: string) => {
    if (!confirm('このナレッジを削除しますか？')) return
    try {
      await api.delete(`/api/knowledge/${id}`)
      showToast('ナレッジを削除しました')
      await fetchArticles()
    } catch (err) {
      showToast(`削除失敗: ${String(err)}`, 'error')
    }
  }

  const handleScrape = async () => {
    if (!scrapeUrl.trim()) return
    setScraping(true)
    setScrapeResult(null)
    try {
      const res = await api.post('/api/knowledge/scrape', { url: scrapeUrl })
      if (res.success) {
        const d = res.data as { title: string; content: string; sourceUrl: string }
        setScrapeResult(d)
        setArticleTitle(d.title)
        setArticleContent(d.content)
        setArticleUrl(d.sourceUrl)
        setArticleCategory('general')
        setShowScrape(false)
        setShowAddArticle(true)
        setEditArticle(null)
      } else {
        alert(`読み取り失敗: ${(res as { error?: string }).error}`)
      }
    } catch (err) {
      alert(`読み取り失敗: ${String(err)}`)
    }
    setScraping(false)
  }

  const startEditArticle = (a: KnowledgeArticle) => {
    setEditArticle(a)
    setArticleTitle(a.title)
    setArticleCategory(a.category)
    setArticleContent(a.content)
    setArticleUrl(a.source_url || '')
    setShowAddArticle(true)
  }

  const resetArticleForm = () => {
    setShowAddArticle(false)
    setEditArticle(null)
    setArticleTitle('')
    setArticleCategory('general')
    setArticleContent('')
    setArticleUrl('')
    setScrapeResult(null)
  }

  return (
    <>
      <Header title="AI自動返信" description="AIがナレッジを参照して自動返信します（Reply API = 無料）" />

      {/* トースト */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white animate-fade-in ${
            toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          }`}
          style={{ backgroundColor: toast.type === 'success' ? '#06C755' : undefined }}
        >
          {toast.message}
        </div>
      )}

      {/* タブ */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { id: 'settings' as const, label: '設定' },
          { id: 'knowledge' as const, label: `ナレッジ (${articles.length})` },
          { id: 'logs' as const, label: '返信ログ' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* === 設定タブ === */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            {/* ON/OFF */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">AI自動返信</h3>
                <p className="text-xs text-gray-500 mt-0.5">ONにすると友だちのメッセージにAIが自動返信します</p>
              </div>
              <button
                onClick={() => setIsActive(!isActive)}
                className={`relative w-12 h-7 rounded-full transition-colors ${isActive ? 'bg-green-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${isActive ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            <hr className="border-gray-100" />

            {/* プロバイダー */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">AIプロバイダー</label>
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value)
                  setModelId(MODELS[e.target.value]?.[0]?.value || '')
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* APIキー */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">APIキー</label>
              <div className="flex gap-2">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="sk-ant-... / AIza..."
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="px-3 py-2 text-xs border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  {showApiKey ? '隠す' : '表示'}
                </button>
              </div>
            </div>

            {/* モデル */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">モデル</label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {(MODELS[provider] || []).map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* 最大トークン */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                最大トークン: {maxTokens}
              </label>
              <input
                type="range"
                min="200"
                max="4000"
                step="100"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>200</span>
                <span>短い回答向き</span>
                <span>4000</span>
              </div>
            </div>

            {/* 温度 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                温度: {temperature}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>正確</span>
                <span>創造的</span>
              </div>
            </div>

            {/* システムプロンプト */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                システムプロンプト <span className="text-xs text-gray-400 font-normal">（空欄でデフォルト使用）</span>
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={5}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="あなたはお店のカスタマーサポートAIです。ナレッジベースの情報を元に、お客様の質問に丁寧に回答してください..."
              />
            </div>

            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="w-full py-2.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>

          {/* テスト送信 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">テスト送信</h3>
            <div className="flex gap-2 mb-3">
              <input
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="テストメッセージを入力..."
                onKeyDown={(e) => e.key === 'Enter' && handleTest()}
              />
              <button
                onClick={handleTest}
                disabled={testing || !testMessage.trim()}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {testing ? '生成中...' : '送信'}
              </button>
            </div>
            {testResponse && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap">{testResponse}</div>
            )}
          </div>
        </div>
      )}

      {/* === ナレッジタブ === */}
      {activeTab === 'knowledge' && (
        <div className="space-y-4">
          {/* アクションボタン */}
          <div className="flex gap-2">
            <button
              onClick={() => { resetArticleForm(); setShowAddArticle(true) }}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg"
              style={{ backgroundColor: '#06C755' }}
            >
              + 手動追加
            </button>
            <button
              onClick={() => { setShowScrape(true); setScrapeUrl(''); setScrapeResult(null) }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              URLから読み取り
            </button>
          </div>

          {/* URLスクレイプダイアログ */}
          {showScrape && (
            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">URLからナレッジを読み取り</h3>
              <div className="flex gap-2">
                <input
                  value={scrapeUrl}
                  onChange={(e) => setScrapeUrl(e.target.value)}
                  className="flex-1 border border-blue-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="https://your-store.com/about"
                  onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
                />
                <button
                  onClick={handleScrape}
                  disabled={scraping || !scrapeUrl.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg disabled:opacity-50"
                >
                  {scraping ? '読み取り中...' : '読み取り'}
                </button>
                <button
                  onClick={() => setShowScrape(false)}
                  className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                >
                  閉じる
                </button>
              </div>
            </div>
          )}

          {/* 追加/編集フォーム */}
          {showAddArticle && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">
                {editArticle ? 'ナレッジを編集' : 'ナレッジを追加'}
                {scrapeResult && <span className="text-xs text-blue-600 ml-2">（URLから読み取り済み — 内容を確認・編集してください）</span>}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">タイトル</label>
                  <input
                    value={articleTitle}
                    onChange={(e) => setArticleTitle(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">カテゴリ</label>
                  <select
                    value={articleCategory}
                    onChange={(e) => setArticleCategory(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">内容</label>
                <textarea
                  value={articleContent}
                  onChange={(e) => setArticleContent(e.target.value)}
                  rows={8}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="お店の情報、商品説明、FAQなどを入力..."
                />
              </div>
              {articleUrl && (
                <p className="text-xs text-gray-400">元URL: {articleUrl}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleSaveArticle}
                  disabled={!articleTitle.trim() || !articleContent.trim()}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {editArticle ? '更新' : '追加'}
                </button>
                <button
                  onClick={resetArticleForm}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* ナレッジ一覧 */}
          {articles.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-500">ナレッジがまだありません。お店のURLを読み取るか、手動で追加してください。</p>
            </div>
          ) : (
            <div className="space-y-2">
              {articles.map((a) => (
                <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-medium text-gray-900">{a.title}</h4>
                        <span className="px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded-full">
                          {CATEGORIES.find(c => c.value === a.category)?.label || a.category}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 line-clamp-2">{a.content.slice(0, 150)}...</p>
                      {a.source_url && (
                        <p className="text-[10px] text-gray-400 mt-1">{a.source_url}</p>
                      )}
                    </div>
                    <div className="flex gap-1 ml-3 shrink-0">
                      <button
                        onClick={() => startEditArticle(a)}
                        className="px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-md"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDeleteArticle(a.id)}
                        className="px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-md"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* === ログタブ === */}
      {activeTab === 'logs' && (
        <div>
          <button
            onClick={fetchLogs}
            className="mb-4 px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            更新
          </button>
          {logs.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-500">AI返信ログはまだありません</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-700">{log.display_name || '不明'}</span>
                    <div className="flex items-center gap-3 text-[10px] text-gray-400">
                      <span>{log.tokens_used} tokens</span>
                      <span>{log.latency_ms}ms</span>
                      <span>{new Date(log.created_at).toLocaleString('ja-JP')}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex gap-2">
                      <span className="text-xs text-gray-400 shrink-0 mt-0.5">Q:</span>
                      <p className="text-sm text-gray-700">{log.user_message}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-xs text-green-500 shrink-0 mt-0.5">A:</span>
                      <p className="text-sm text-gray-900">{log.ai_response}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

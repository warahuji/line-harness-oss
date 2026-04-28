'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

type ApiRes<T = unknown> = { success: boolean; data?: T; error?: string }

const api = {
  get: <T = unknown>(path: string) => fetchApi<ApiRes<T>>(path),
  post: <T = unknown>(path: string, body: unknown) =>
    fetchApi<ApiRes<T>>(path, { method: 'POST', body: JSON.stringify(body) }),
}

interface Proposal {
  id: string
  runId: string
  clusterLabel: string | null
  representativeText: string
  exampleMessages: string[]
  messageCount: number
  rank: number
  suggestedAnswer: string | null
  suggestedCategory: string
  status: 'pending' | 'adopted' | 'rejected' | 'duplicate'
  knowledgeArticleId: string | null
  createdAt: string
}

interface RunRow {
  id: string
  lineAccountId: string | null
  status: string
  startedAt: string | null
  completedAt: string | null
  messageCount: number
  clusterCount: number
  noiseCount: number
  dateFrom: string | null
  dateTo: string | null
  costUsd: number | null
  errorMessage: string | null
  createdAt: string
}

interface FormState {
  title: string
  category: string
  content: string
}

const CATEGORIES = [
  { value: 'general', label: '一般' },
  { value: 'product', label: '商品情報' },
  { value: 'shipping', label: '送料・配送' },
  { value: 'faq', label: 'よくある質問' },
  { value: 'policy', label: 'ポリシー' },
  { value: 'campaign', label: 'キャンペーン' },
]

function RunSummary({ run }: { run: RunRow }) {
  const [open, setOpen] = useState(false)
  const dt = run.completedAt || run.startedAt || run.createdAt
  const dateStr = dt ? new Date(dt).toLocaleString('ja-JP') : '—'
  const cost = run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : '—'

  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-sm font-medium text-gray-700">
          実行履歴サマリー（最新: {dateStr}）
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
          <div><span className="font-medium">処理件数:</span> {run.messageCount.toLocaleString()}件</div>
          <div><span className="font-medium">クラスタ数:</span> {run.clusterCount}</div>
          <div><span className="font-medium">コスト:</span> {cost}</div>
          <div>
            <span className="font-medium">ステータス:</span>{' '}
            <span className={run.status === 'completed' ? 'text-green-600' : run.status === 'failed' ? 'text-red-500' : 'text-yellow-600'}>
              {run.status === 'completed' ? '完了' : run.status === 'failed' ? '失敗' : run.status}
            </span>
          </div>
          {run.dateFrom && <div><span className="font-medium">期間:</span> {run.dateFrom} 〜 {run.dateTo || '—'}</div>}
        </div>
      )}
    </div>
  )
}

function ProposalCard({
  proposal,
  editForm,
  onFormChange,
  onAdopt,
  onReject,
  adopting,
  rejecting,
}: {
  proposal: Proposal
  editForm: FormState
  onFormChange: (id: string, field: keyof FormState, value: string) => void
  onAdopt: (id: string) => void
  onReject: (id: string) => void
  adopting: boolean
  rejecting: boolean
}) {
  const [examplesOpen, setExamplesOpen] = useState(false)
  const examples = proposal.exampleMessages || []
  const previewExamples = examplesOpen ? examples : examples.slice(0, 2)

  const catLabel = CATEGORIES.find(c => c.value === proposal.suggestedCategory)?.label || proposal.suggestedCategory

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
      {/* ヘッダー行 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold text-gray-400">#{proposal.rank}</span>
        <h3 className="text-sm font-semibold text-gray-900 flex-1">
          {proposal.clusterLabel || proposal.representativeText.slice(0, 40)}
        </h3>
        <span className="text-xs text-gray-500">{proposal.messageCount.toLocaleString()}件</span>
        <span className="px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded-full">
          {catLabel}
        </span>
      </div>

      {/* 代表テキスト */}
      <p className="text-xs text-gray-500 mb-3 whitespace-pre-wrap">
        代表: 「{proposal.representativeText.slice(0, 100)}{proposal.representativeText.length > 100 ? '...' : ''}」
      </p>

      <hr className="border-gray-100 mb-3" />

      {/* 例メッセージ */}
      {examples.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setExamplesOpen(!examplesOpen)}
            className="text-xs text-gray-400 hover:text-gray-600 mb-1.5 flex items-center gap-1"
          >
            <svg className={`w-3 h-3 transition-transform ${examplesOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            例 ({examples.length}件)
          </button>
          <ul className="space-y-1">
            {previewExamples.map((msg, i) => (
              <li key={i} className="text-xs text-gray-600 whitespace-pre-wrap pl-3 border-l-2 border-gray-100">
                {examplesOpen ? msg : (msg.length > 80 ? msg.slice(0, 80) + '...' : msg)}
              </li>
            ))}
          </ul>
          {!examplesOpen && examples.length > 2 && (
            <button
              onClick={() => setExamplesOpen(true)}
              className="mt-1 text-[10px] text-gray-400 hover:text-gray-600"
            >
              他 {examples.length - 2} 件を表示
            </button>
          )}
        </div>
      )}

      <hr className="border-gray-100 mb-3" />

      {/* ナレッジ化フォーム */}
      <div className="space-y-2.5">
        <p className="text-xs font-semibold text-gray-700">ナレッジ化</p>

        <div>
          <label className="block text-[10px] font-medium text-gray-500 mb-1">タイトル</label>
          <input
            value={editForm.title}
            onChange={(e) => onFormChange(proposal.id, 'title', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            placeholder="ナレッジのタイトル"
          />
        </div>

        <div>
          <label className="block text-[10px] font-medium text-gray-500 mb-1">カテゴリ</label>
          <select
            value={editForm.category}
            onChange={(e) => onFormChange(proposal.id, 'category', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-medium text-gray-500 mb-1">内容</label>
          <textarea
            value={editForm.content}
            onChange={(e) => onFormChange(proposal.id, 'content', e.target.value)}
            rows={5}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="AIが生成した回答候補を確認・編集してください..."
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onAdopt(proposal.id)}
            disabled={adopting || !editForm.title.trim() || !editForm.content.trim()}
            className="flex-1 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors"
            style={{ backgroundColor: '#06C755' }}
          >
            {adopting ? '処理中...' : '採用してナレッジ化'}
          </button>
          <button
            onClick={() => onReject(proposal.id)}
            disabled={rejecting}
            className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50 transition-colors"
          >
            {rejecting ? '...' : '却下'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function FaqExtractionPage() {
  const [activeTab, setActiveTab] = useState<'pending' | 'runs' | 'adopted'>('pending')
  const [runs, setRuns] = useState<RunRow[]>([])
  const [latestRunId, setLatestRunId] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [adopted, setAdopted] = useState<Proposal[]>([])
  const [editForms, setEditForms] = useState<Record<string, FormState>>({})
  const [adoptingIds, setAdoptingIds] = useState<Set<string>>(new Set())
  const [rejectingIds, setRejectingIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  // --- Toast ---
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2500)
  }

  // --- フォーム初期化ヘルパー ---
  const initForm = (p: Proposal): FormState => ({
    title: p.clusterLabel || p.representativeText.slice(0, 60),
    category: p.suggestedCategory || 'faq',
    content: p.suggestedAnswer || '',
  })

  const buildForms = (ps: Proposal[]): Record<string, FormState> => {
    const forms: Record<string, FormState> = {}
    for (const p of ps) forms[p.id] = initForm(p)
    return forms
  }

  // --- データ取得 ---
  const fetchRuns = useCallback(async () => {
    try {
      const res = await api.get<RunRow[]>('/api/faq-extraction/runs')
      if (res.success && res.data) {
        setRuns(res.data)
        return res.data
      }
    } catch {}
    return []
  }, [])

  const fetchProposals = useCallback(async (runId: string) => {
    try {
      const res = await api.get<Proposal[]>(`/api/faq-extraction/runs/${runId}/proposals`)
      if (res.success && res.data) {
        return res.data
      }
    } catch {}
    return []
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const runsData = await fetchRuns()
    if (runsData.length > 0) {
      const latest = runsData[0]
      setLatestRunId(latest.id)
      const ps = await fetchProposals(latest.id)
      const pending = ps.filter(p => p.status === 'pending')
      const adoptedPs = ps.filter(p => p.status === 'adopted')
      setProposals(pending)
      setAdopted(adoptedPs)
      setEditForms(buildForms(pending))
    }
    setLoading(false)
  }, [fetchRuns, fetchProposals])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // 履歴タブのrun行クリック時
  const handleRunClick = async (runId: string) => {
    setSelectedRunId(runId)
    setActiveTab('pending')
    const ps = await fetchProposals(runId)
    const pending = ps.filter(p => p.status === 'pending')
    const adoptedPs = ps.filter(p => p.status === 'adopted')
    setProposals(pending)
    setAdopted(adoptedPs)
    setEditForms(buildForms(pending))
  }

  // --- フォーム変更 ---
  const handleFormChange = (id: string, field: keyof FormState, value: string) => {
    setEditForms(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }))
  }

  // --- 採用 ---
  const handleAdopt = async (id: string) => {
    const form = editForms[id]
    if (!form?.title.trim() || !form?.content.trim()) return
    setAdoptingIds(prev => new Set(prev).add(id))
    try {
      const res = await api.post(`/api/faq-extraction/proposals/${id}/adopt`, {
        title: form.title,
        category: form.category,
        content: form.content,
      })
      if (res.success) {
        showToast('ナレッジ化しました')
        setProposals(prev => prev.filter(p => p.id !== id))
      } else {
        showToast(`採用失敗: ${(res as { error?: string }).error || '不明なエラー'}`, 'error')
      }
    } catch (err) {
      showToast(`採用失敗: ${String(err)}`, 'error')
    }
    setAdoptingIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  // --- 却下 ---
  const handleReject = async (id: string) => {
    if (!confirm('この提案を却下しますか？')) return
    setRejectingIds(prev => new Set(prev).add(id))
    try {
      const res = await api.post(`/api/faq-extraction/proposals/${id}/reject`, {})
      if (res.success) {
        showToast('却下しました')
        setProposals(prev => prev.filter(p => p.id !== id))
      } else {
        showToast(`却下失敗: ${(res as { error?: string }).error || '不明なエラー'}`, 'error')
      }
    } catch (err) {
      showToast(`却下失敗: ${String(err)}`, 'error')
    }
    setRejectingIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  const latestRun = runs.length > 0 ? runs[0] : null
  const displayRunId = selectedRunId || latestRunId

  return (
    <>
      <Header
        title="FAQ抽出"
        description="メッセージログから頻出質問をクラスタリングしてナレッジ候補を提案します"
      />

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
          { id: 'pending' as const, label: `提案 (${proposals.length})` },
          { id: 'runs' as const, label: `履歴 (${runs.length})` },
          { id: 'adopted' as const, label: `採用済 (${adopted.length})` },
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

      {/* === 提案タブ === */}
      {activeTab === 'pending' && (
        <div>
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-400">読み込み中...</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <p className="text-sm font-medium text-gray-700 mb-1">FAQ抽出がまだ実行されていません</p>
              <p className="text-xs text-gray-400">
                ローカルで{' '}
                <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">python scripts/extract-faq.py --submit</code>{' '}
                を実行してください
              </p>
            </div>
          ) : proposals.length === 0 ? (
            <div>
              {latestRun && <RunSummary run={latestRun} />}
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <p className="text-sm text-gray-500">未処理の提案はありません</p>
                <p className="text-xs text-gray-400 mt-1">すべて採用または却下されました</p>
              </div>
            </div>
          ) : (
            <div>
              {latestRun && <RunSummary run={latestRun} />}
              <p className="text-xs text-gray-400 mb-3">
                {displayRunId !== latestRunId && (
                  <button
                    onClick={() => loadAll()}
                    className="text-blue-500 hover:underline mr-2"
                  >
                    最新に戻る
                  </button>
                )}
                {proposals.length}件の提案
              </p>
              {proposals.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  editForm={editForms[p.id] || initForm(p)}
                  onFormChange={handleFormChange}
                  onAdopt={handleAdopt}
                  onReject={handleReject}
                  adopting={adoptingIds.has(p.id)}
                  rejecting={rejectingIds.has(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* === 履歴タブ === */}
      {activeTab === 'runs' && (
        <div>
          {runs.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-500">実行履歴がまだありません</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">日時</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">件数</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">クラスタ</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">コスト</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const dt = run.completedAt || run.startedAt || run.createdAt
                    const dateStr = dt ? new Date(dt).toLocaleString('ja-JP') : '—'
                    const cost = run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : '—'
                    return (
                      <tr
                        key={run.id}
                        onClick={() => handleRunClick(run.id)}
                        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-gray-700">{dateStr}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{run.messageCount.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{run.clusterCount}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{cost}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                            run.status === 'completed'
                              ? 'bg-green-100 text-green-700'
                              : run.status === 'failed'
                              ? 'bg-red-100 text-red-600'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {run.status === 'completed' ? '完了' : run.status === 'failed' ? '失敗' : run.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* === 採用済タブ === */}
      {activeTab === 'adopted' && (
        <div>
          {adopted.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-500">採用済の提案はまだありません</p>
            </div>
          ) : (
            <div className="space-y-2">
              {adopted.map((p) => {
                const catLabel = CATEGORIES.find(c => c.value === p.suggestedCategory)?.label || p.suggestedCategory
                const adoptedDate = p.createdAt ? new Date(p.createdAt).toLocaleDateString('ja-JP') : '—'
                return (
                  <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-gray-900 flex-1">
                        {p.clusterLabel || p.representativeText.slice(0, 50)}
                      </h4>
                      <span className="px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded-full">
                        {catLabel}
                      </span>
                      <span className="text-xs text-gray-400">採用日 {adoptedDate}</span>
                      {p.knowledgeArticleId && (
                        <a
                          href="/ai-settings"
                          className="px-2.5 py-1 text-xs text-blue-600 hover:text-blue-700 border border-blue-200 rounded-md hover:bg-blue-50 transition-colors"
                        >
                          ナレッジを開く
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )
}

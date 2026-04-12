'use client'

import { useState, useEffect } from 'react'

interface SendConfirmDialogProps {
  title: string
  targetCount: number
  accountName: string
  onConfirm: () => void
  onCancel: () => void
}

export default function SendConfirmDialog({ title, targetCount, accountName, onConfirm, onCancel }: SendConfirmDialogProps) {
  const [countdown, setCountdown] = useState(3)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">配信を送信しますか？</h3>
        <dl className="space-y-2 text-sm mb-4">
          <div className="flex justify-between">
            <dt className="text-gray-500">タイトル</dt>
            <dd className="text-gray-900 font-medium">{title}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">対象</dt>
            <dd className="text-gray-900 font-medium">{targetCount.toLocaleString('ja-JP')}人</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">アカウント</dt>
            <dd className="text-gray-900 font-medium">{accountName}</dd>
          </div>
        </dl>
        <p className="text-xs text-amber-600 mb-4">送信後は取り消せません</p>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            disabled={countdown > 0}
            className="flex-1 px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: '#06C755' }}
          >
            {countdown > 0 ? `送信する (${countdown})` : '送信する'}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}

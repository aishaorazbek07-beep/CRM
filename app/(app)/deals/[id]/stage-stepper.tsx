import { Check } from 'lucide-react'
import { cn } from '@/components/ui'
import { DEAL_STAGES } from '@/lib/labels'
import { updateDealForm } from '../actions'

export function StageStepper({
  dealId,
  stage,
  stageIdx,
}: {
  dealId: string
  stage: string
  stageIdx: number
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {DEAL_STAGES.map((s, i) => {
        const done = i < stageIdx
        const current = s.key === stage
        return (
          <form key={s.key} action={updateDealForm}>
            <input type="hidden" name="deal_id" value={dealId} />
            <input type="hidden" name="stage" value={s.key} />
            <button
              type="submit"
              title={`Перевести на этап: ${s.label}`}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
                current
                  ? 'border-steel-600 bg-steel-600 text-white'
                  : done
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-ink-200 bg-white text-ink-500 hover:border-steel-500 dark:border-white/10 dark:bg-white/5 dark:text-ink-400'
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold',
                  current ? 'bg-white/25' : done ? 'bg-emerald-500 text-white' : 'bg-ink-200 dark:bg-white/10'
                )}
              >
                {done ? <Check size={10} /> : i + 1}
              </span>
              {s.short}
            </button>
          </form>
        )
      })}
    </div>
  )
}

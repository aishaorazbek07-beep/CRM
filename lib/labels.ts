export const DEAL_STAGES = [
  { key: 'lead', label: 'Заявка / ТЗ', short: 'Заявка' },
  { key: 'design', label: 'Проектирование и расчёт', short: 'Расчёт' },
  { key: 'approval', label: 'Согласование КП', short: 'КП' },
  { key: 'contract', label: 'Договор и оплата', short: 'Договор' },
  { key: 'supply', label: 'Снабжение', short: 'Снабжение' },
  { key: 'production', label: 'Производство', short: 'Цех' },
  { key: 'qc', label: 'ОТК', short: 'ОТК' },
  { key: 'shipment', label: 'Отгрузка и документы', short: 'Отгрузка' },
] as const

export type DealStage = (typeof DEAL_STAGES)[number]['key']

export const DEAL_STAGE_LABEL: Record<string, string> = Object.fromEntries(
  DEAL_STAGES.map((s) => [s.key, s.label])
)

export const PROD_STAGES = [
  { key: 'waiting_components', label: 'Ожидание комплектующих', color: 'amber' },
  { key: 'cutting', label: 'Заготовительный участок', color: 'sky' },
  { key: 'welding', label: 'Сварка и сборка', color: 'blue' },
  { key: 'assembly', label: 'Комплектация и монтаж', color: 'indigo' },
  { key: 'qc', label: 'ОТК', color: 'violet' },
  { key: 'painting', label: 'Покраска / антикор', color: 'fuchsia' },
  { key: 'ready_to_ship', label: 'Готово к отгрузке', color: 'emerald' },
  { key: 'shipped', label: 'Отгружено', color: 'slate' },
] as const

export type ProdStage = (typeof PROD_STAGES)[number]['key']

export const PROD_STAGE_LABEL: Record<string, string> = Object.fromEntries(
  PROD_STAGES.map((s) => [s.key, s.label])
)

export const ROLE_LABEL: Record<string, string> = {
  director: 'Директор',
  sales: 'Менеджер по продажам',
  procurement: 'Снабжение / закуп',
  production: 'Начальник производства',
  warehouse: 'Кладовщик',
}

export const SOURCE_LABEL: Record<string, string> = {
  site: 'Сайт',
  tender: 'Тендерная площадка',
  call: 'Звонок',
  email: 'Почта',
  whatsapp: 'WhatsApp',
  referral: 'Рекомендация',
  other: 'Другое',
}

export const PO_STATUS = [
  { key: 'draft', label: 'Черновик' },
  { key: 'ordered', label: 'Заказано' },
  { key: 'paid', label: 'Оплачено' },
  { key: 'in_transit', label: 'В пути' },
  { key: 'received', label: 'На складе' },
  { key: 'cancelled', label: 'Отменено' },
] as const

export const PO_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  PO_STATUS.map((s) => [s.key, s.label])
)

export const PR_STATUS_LABEL: Record<string, string> = {
  new: 'Новая',
  in_work: 'В работе',
  ordered: 'Заказано',
  partially_received: 'Частично получено',
  closed: 'Закрыта',
  cancelled: 'Отменена',
}

export const DEAL_STATUS_LABEL: Record<string, string> = {
  active: 'В работе',
  won: 'Выиграна',
  lost: 'Проиграна',
  paused: 'Приостановлена',
}

export const ITEM_KIND_LABEL: Record<string, string> = {
  material: 'Материал',
  component: 'Комплектующее',
  product: 'Изделие',
  service: 'Услуга',
}

export const SPEC_SOURCE_LABEL: Record<string, string> = {
  stock: 'Со склада',
  purchase: 'Закуп',
  production: 'Собственное производство',
  outsource: 'Подряд',
}

export const RESERVE_KIND_LABEL: Record<string, string> = {
  soft: 'Информационный',
  hard: 'Жёсткий',
}

export const WAREHOUSE_KIND_LABEL: Record<string, string> = {
  material: 'Материалы',
  production: 'Цех',
  finished: 'Готовая продукция',
}

export const MOVE_TYPE_LABEL: Record<string, string> = {
  receipt: 'Приход',
  issue: 'Выдача в цех',
  transfer: 'Перемещение',
  writeoff: 'Списание',
  return: 'Возврат',
  shipment: 'Отгрузка',
  adjustment: 'Корректировка',
}

export const TASK_TYPE_LABEL: Record<string, string> = {
  min_stock: 'Неснижаемый остаток',
  deficit: 'Дефицит',
  approval: 'Согласование',
  purchase_eta: 'Срок поставки',
  general: 'Задача',
}

/** Какие разделы доступны роли */
export const ROLE_NAV: Record<string, string[]> = {
  director: ['dashboard', 'deals', 'counterparties', 'catalog', 'warehouse', 'procurement', 'production', 'reports', 'tasks', 'settings'],
  sales: ['dashboard', 'deals', 'counterparties', 'catalog', 'warehouse', 'production', 'tasks'],
  procurement: ['dashboard', 'deals', 'counterparties', 'catalog', 'warehouse', 'procurement', 'tasks'],
  production: ['dashboard', 'production', 'warehouse', 'deals', 'tasks'],
  warehouse: ['dashboard', 'warehouse', 'procurement', 'production', 'tasks'],
}

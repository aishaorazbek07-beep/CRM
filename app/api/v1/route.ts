import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    name: 'Unified CRM API',
    version: '1',
    auth: 'заголовок x-api-key или параметр ?key=',
    endpoints: [
      '/api/v1/export/deals',
      '/api/v1/export/specifications',
      '/api/v1/export/substitutions',
      '/api/v1/export/stock',
      '/api/v1/export/balances',
      '/api/v1/export/purchases',
      '/api/v1/export/production',
      '/api/v1/export/stage-durations',
      '/api/v1/export/deal-stage-durations',
      '/api/v1/export/moves',
      '/api/v1/export/counterparties',
      '/api/v1/export/items',
    ],
    params: {
      format: 'json | csv',
      from: 'YYYY-MM-DD',
      to: 'YYYY-MM-DD',
      limit: 'до 50000',
    },
  })
}

// Edge Function pública de redirección. Desplegar con:  supabase functions deploy r --no-verify-jwt
// Variables de entorno (Supabase las inyecta automáticamente): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Opcional:  INFO_PAGE_URL=https://TU-APP/aviso.html   (recomendado en el dominio por defecto de Supabase, ver README)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createHandler } from './handler.ts'

declare const Deno: { env: { get(k: string): string | undefined }; serve: (h: (r: Request) => Response | Promise<Response>) => void }

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// La service_role key vive solo acá, en el servidor. Nunca se envía al navegador.
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

const handler = createHandler({
  infoPageUrl: Deno.env.get('INFO_PAGE_URL') || undefined,
  getLink: async (code) => {
    const { data, error } = await db.from('qr_links').select('id,destination,status,stats_enabled').eq('code', code).maybeSingle()
    if (error) throw error
    return data
  },
  insertHit: async (hit) => {
    const { error } = await db.from('qr_hits').insert(hit)
    if (error) throw error
  },
  log: (m) => console.error(m), // solo etiquetas fijas: nunca IPs, destinos ni datos del visitante
})

Deno.serve(handler)

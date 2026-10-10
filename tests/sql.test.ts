// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Ejecuta la migración REAL (supabase/migrations/001_init.sql) en PostgreSQL (PGlite) con roles y
 * auth.uid() imitando a Supabase. Prueba RLS, triggers, retención y persistencia de verdad.
 * Limitación: no es el servicio de Supabase en sí (auth real, pg_cron, red).
 */
const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const dir = mkdtempSync(join(tmpdir(), 'qrs-pg-'))
let db: PGlite

const migration = readFileSync(new URL('../supabase/migrations/001_init.sql', import.meta.url), 'utf8').replace(/create extension if not exists pgcrypto;/i, '-- (pgcrypto omitida en la prueba; gen_random_uuid es nativa)')

async function as(user: string | null, fn: () => Promise<unknown>) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`)
  try { return await fn() } finally { await db.exec('reset role') }
}
async function boot() {
  const d = new PGlite(dir)
  await d.waitReady
  return d
}

beforeAll(async () => {
  db = await boot()
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    insert into auth.users values ('${A}'), ('${B}') on conflict do nothing;
  `)
  await db.exec(migration)
  await db.exec('grant all on all tables in schema public to service_role;')
})
afterAll(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }) })

const insertLink = (code: string, dest = 'https://destino.com.ar/a') =>
  db.query(`insert into qr_links (code, name, destination) values ($1, 'Mi QR', $2) returning id`, [code, dest])

describe('aceptación 5: aislamiento entre usuarios (RLS)', () => {
  let idA = ''
  it('A crea un enlace y lo ve', async () => {
    await as(A, async () => { const r = await insertLink('aaaa1111'); idA = (r.rows[0] as { id: string }).id })
    const rows = await as(A, () => db.query('select code from qr_links')) as { rows: unknown[] }
    expect(rows.rows).toHaveLength(1)
  })
  it('B no ve el enlace de A', async () => {
    const r = await as(B, () => db.query('select * from qr_links')) as { rows: unknown[] }
    expect(r.rows).toHaveLength(0)
  })
  it('B no puede modificar ni borrar el enlace de A (0 filas afectadas)', async () => {
    const u = await as(B, () => db.query(`update qr_links set destination='https://malo.com/' where id=$1 returning id`, [idA])) as { rows: unknown[] }
    expect(u.rows).toHaveLength(0)
    const d = await as(B, () => db.query(`delete from qr_links where id=$1 returning id`, [idA])) as { rows: unknown[] }
    expect(d.rows).toHaveLength(0)
    const still = await db.query(`select destination from qr_links where id=$1`, [idA])
    expect((still.rows[0] as { destination: string }).destination).toBe('https://destino.com.ar/a')
  })
  it('B no puede crear enlaces a nombre de A', async () => {
    await expect(as(B, () => db.query(`insert into qr_links (code, owner, name, destination) values ('bbbb2222', $1, 'x', 'https://x.com.ar/')`, [A]))).rejects.toThrow(/row-level security/i)
  })
  it('un visitante anónimo no puede leer ni escribir nada', async () => {
    await expect(as(null, () => db.query('select * from qr_links'))).rejects.toThrow(/permission denied/i)
    await expect(as(null, () => db.query(`insert into qr_links (code, owner, name, destination) values ('cccc3333', '${A}', 'x', 'https://x.com.ar/')`))).rejects.toThrow(/permission denied/i)
    await expect(as(null, () => db.query('select * from qr_hits'))).rejects.toThrow(/permission denied/i)
  })
})

describe('validación y guardas en el servidor', () => {
  it('rechaza destinos inseguros aunque el cliente los envíe', async () => {
    for (const bad of ['http://x.com.ar/', 'javascript:alert(1)', 'https://localhost/', 'https://127.0.0.1/', 'https://10.1.2.3/', 'https://192.168.1.1/', 'https://u:p@x.com.ar/', 'https://sinpunto/']) {
      await expect(as(A, () => insertLink(`z${Math.random().toString(36).slice(2, 9)}`, bad)), bad).rejects.toThrow()
    }
  })
  it('el código (URL impresa) y el dueño no se pueden cambiar', async () => {
    await expect(as(A, () => db.query(`update qr_links set code='nuevo1234' where code='aaaa1111'`))).rejects.toThrow(/immutable_field/)
    await expect(as(A, () => db.query(`update qr_links set owner='${B}' where code='aaaa1111'`))).rejects.toThrow()
  })
  it('cambiar el destino actualiza updated_at y conserva el código', async () => {
    const before = await db.query(`select updated_at from qr_links where code='aaaa1111'`)
    await new Promise((r) => setTimeout(r, 15))
    await as(A, () => db.query(`update qr_links set destination='https://nuevo.com.ar/b' where code='aaaa1111'`))
    const after = await db.query(`select code, destination, updated_at from qr_links where code='aaaa1111'`)
    const a = after.rows[0] as { code: string; destination: string; updated_at: Date }
    expect(a.code).toBe('aaaa1111'); expect(a.destination).toBe('https://nuevo.com.ar/b')
    expect(+a.updated_at).toBeGreaterThan(+(before.rows[0] as { updated_at: Date }).updated_at)
  })
  it('respeta el máximo configurable por usuario', async () => {
    await db.exec(`update app_settings set value = 2 where key = 'max_links_per_user'`)
    await as(B, () => insertLink('bbbb0001')); await as(B, () => insertLink('bbbb0002'))
    await expect(as(B, () => insertLink('bbbb0003'))).rejects.toThrow(/limit_reached/)
    await db.exec(`update app_settings set value = 50 where key = 'max_links_per_user'`)
  })
  it('restricciones de formato (código, estado, retención)', async () => {
    await expect(as(A, () => insertLink('AB'))).rejects.toThrow()
    await expect(as(A, () => db.query(`update qr_links set status='hackeado' where code='aaaa1111'`))).rejects.toThrow()
    await expect(as(A, () => db.query(`update qr_links set retention_days=9999 where code='aaaa1111'`))).rejects.toThrow()
  })
})

describe('estadísticas: acceso y retención', () => {
  let idA = ''
  it('solo el servicio puede registrar visitas; el dueño las lee; otro usuario no', async () => {
    idA = ((await db.query(`select id from qr_links where code='aaaa1111'`)).rows[0] as { id: string }).id
    await expect(as(A, () => db.query(`insert into qr_hits (link_id) values ($1)`, [idA]))).rejects.toThrow(/permission denied|row-level/i)
    await db.exec(`set role service_role`)
    await db.query(`insert into qr_hits (link_id, device, is_bot) values ($1,'mobile',false), ($1,'desktop',true)`, [idA])
    await db.exec('reset role')
    const own = await as(A, () => db.query('select count(*)::int as n from qr_hits')) as { rows: { n: number }[] }
    expect(own.rows[0].n).toBe(2)
    const other = await as(B, () => db.query('select count(*)::int as n from qr_hits')) as { rows: { n: number }[] }
    expect(other.rows[0].n).toBe(0)
  })
  it('la tabla no tiene columnas de IP ni de identificación', async () => {
    const cols = await db.query(`select column_name from information_schema.columns where table_name='qr_hits' order by 1`)
    expect((cols.rows as { column_name: string }[]).map((c) => c.column_name)).toEqual(['device', 'id', 'is_bot', 'link_id', 'ts'])
  })
  it('purge_old_hits borra según el plazo de cada enlace', async () => {
    await db.query(`insert into qr_hits (link_id, ts) values ($1, now() - interval '120 days'), ($1, now() - interval '10 days')`, [idA])
    await as(A, () => db.query(`update qr_links set retention_days = 30 where id = $1`, [idA]))
    const r = await db.query('select purge_old_hits() as n')
    expect(Number((r.rows[0] as { n: number | string | bigint }).n)).toBe(1)
    await expect(as(A, () => db.query('select purge_old_hits()'))).rejects.toThrow(/permission denied/i)
  })
  it('el dueño puede borrar sus estadísticas; otro usuario no', async () => {
    const b = await as(B, () => db.query(`delete from qr_hits where link_id=$1 returning id`, [idA])) as { rows: unknown[] }
    expect(b.rows).toHaveLength(0)
    const a = await as(A, () => db.query(`delete from qr_hits where link_id=$1 returning id`, [idA])) as { rows: unknown[] }
    expect(a.rows.length).toBeGreaterThan(0)
  })
  it('borrar un enlace borra sus visitas (en cascada)', async () => {
    await db.exec('set role service_role')
    await db.query(`insert into qr_hits (link_id) values ($1)`, [idA])
    await db.exec('reset role')
    await as(A, () => db.query(`delete from qr_links where id=$1`, [idA]))
    expect(((await db.query('select count(*)::int as n from qr_hits where link_id=$1', [idA])).rows[0] as { n: number }).n).toBe(0)
  })
})

describe('aceptación 8: los cambios sobreviven al reinicio', () => {
  it('cierra y reabre la base: el enlace y su destino siguen ahí', async () => {
    await as(A, () => insertLink('persist01', 'https://persistente.com.ar/x'))
    await db.close()
    db = await boot()
    const r = await db.query(`select code, destination from qr_links where code='persist01'`)
    expect(r.rows).toEqual([{ code: 'persist01', destination: 'https://persistente.com.ar/x' }])
  })
})

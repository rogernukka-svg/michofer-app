# MiChofer

App demo funcional con login Supabase, modo pasajera segura y solicitud de viaje.

## Arrancar

```bash
npm install
npm run dev
```

## Supabase

1. Crear proyecto en Supabase.
2. Ejecutar `supabase/schema.sql` en SQL Editor.
3. Copiar `.env.example` a `.env`.
4. Pegar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
5. Reiniciar `npm run dev`.

Sin `.env`, la app funciona como demo visual. Con `.env`, exige login real.

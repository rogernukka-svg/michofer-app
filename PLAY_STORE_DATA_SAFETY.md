# MiChofer - Play Store Data Safety

Nota: esta guia debe revisarse contra la implementacion real, SDKs instalados y el flujo publicado antes de completar Play Console.

## Datos que probablemente deben declararse

### Datos personales
- Nombre y apellido.
- Email.
- Foto de perfil.
- Telefono si se solicita al chofer o pasajero.

### Ubicacion
- Ubicacion precisa.
- Ubicacion aproximada.
- Uso: punto de recogida, choferes cercanos, rutas, navegacion, seguimiento de viaje y seguridad.

### Mensajes
- Chat del viaje.

### Fotos, videos, archivos y documentos
- Foto de perfil.
- Fotos o documentos de verificacion del chofer si aplica.
- Documentacion del chofer.

### Informacion financiera
- Si la app no procesa tarjetas ni pagos dentro de la app, no declarar pagos todavia.
- Si se agregan pagos integrados en el futuro, actualizar esta seccion.

### Actividad de la app
- Viajes solicitados.
- Historial de viajes.
- Estado de viaje.
- Disponibilidad del chofer.

### IDs de usuario
- ID de cuenta Supabase.
- Email asociado a la cuenta.

## Propositos de uso
- Funcionalidad de la app.
- Administracion de cuentas.
- Seguridad.
- Prevencion de fraude.
- Comunicacion entre pasajero y chofer.
- Soporte.
- Rutas, mapas, ubicacion y navegacion.

## Compartido con terceros
- Google Maps, Google Places, Google Routes y Google Roads para mapas, busqueda, rutas y ajuste visual a calles.
- Supabase como proveedor de autenticacion, base de datos y almacenamiento.
- Hosting y proveedores tecnicos necesarios para operar la app.
- Google OAuth si el usuario inicia sesion con Google.

## Seguridad
- Datos transmitidos por HTTPS.
- Accesos controlados por autenticacion y politicas de Supabase.
- El usuario puede solicitar eliminacion de cuenta y datos desde `/delete-account`.
- MiChofer no debe declarar venta de datos personales si no vende datos.

## URLs para Play Console
- Privacy Policy URL: `https://DOMINIO/privacy`
- Account deletion URL: `https://DOMINIO/delete-account`
- Support URL: `https://DOMINIO/support`

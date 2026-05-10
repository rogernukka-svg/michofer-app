export default function Register() {
  return (
    <div className="page">
      <div className="card">
        <h1>Crear cuenta</h1>

        <input placeholder="Nombre completo" />
        <input placeholder="Correo" />
        <input placeholder="Contraseña" type="password" />

        <button>Continuar</button>
      </div>
    </div>
  )
}
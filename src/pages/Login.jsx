export default function Login() {
  return (
    <div className="page">
      <div className="card">
        <h1>Iniciar sesión</h1>

        <input placeholder="Correo" />
        <input placeholder="Contraseña" type="password" />

        <button>Entrar</button>

        <p className="link">
          ¿No tenés cuenta? Crear cuenta
        </p>
      </div>
    </div>
  )
}
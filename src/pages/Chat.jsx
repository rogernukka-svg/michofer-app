export default function Chat() {
  return (
    <div className="page">
      <div className="card">
        <h1>Chat</h1>

        <div className="message left">
          Hola, estoy llegando.
        </div>

        <div className="message right">
          Perfecto, te espero.
        </div>

        <input placeholder="Escribí un mensaje..." />
      </div>
    </div>
  )
}
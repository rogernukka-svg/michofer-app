import { useEffect, useMemo, useState } from 'react'
import {
  ExternalLink,
  Eye,
  FileText,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react'
import { adminReviewDriverCategory, adminReviewWomenMode, supabase } from '../lib/supabase'
import { categoryStatusLabel, getRideCategoryMeta } from '../lib/rideCategories'

const ADMIN_EMAILS = ['robycho@gmail.com', 'rogercho@gmail.com']

const DOCUMENT_LABELS = {
  driver_license: 'Licencia de conducir',
  green_card: 'Cédula verde',
  vehicle_photo: 'Foto vehículo',
  driver_profile_photo: 'Foto perfil',
  criminal_record: 'Antecedentes',
  vehicle_insurance: 'Seguro',
  vehicle_registration: 'Registro',
}

function statusLabel(status) {
  if (status === 'approved') return 'Aprobado'
  if (status === 'rejected') return 'Rechazado'
  if (status === 'submitted') return 'En revisión'
  return 'Incompleto'
}

function isImageFile(value) {
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(value || ''))
}

function isPdfFile(value) {
  return /\.pdf$/i.test(String(value || ''))
}

function isAdminAccount(user, profile) {
  const email = String(user?.email || '').toLowerCase()
  return profile?.role === 'admin' || ADMIN_EMAILS.includes(email)
}

export default function Admin() {
  const [loading, setLoading] = useState(true)
  const [drivers, setDrivers] = useState([])
  const [message, setMessage] = useState('')
  const [adminUser, setAdminUser] = useState(null)
  const [adminProfile, setAdminProfile] = useState(null)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('submitted')
  const [expandedDocs, setExpandedDocs] = useState({})
  const [categoryRequests, setCategoryRequests] = useState([])
  const [womenRequests, setWomenRequests] = useState([])

  useEffect(() => {
    loadDrivers()

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      loadDrivers()
    })

    return () => {
      listener?.subscription?.unsubscribe()
    }
  }, [])

  const stats = useMemo(() => {
    return drivers.reduce(
      (acc, driver) => {
        const status = driver.verification_status || 'incomplete'
        acc.total += 1
        acc[status] = (acc[status] || 0) + 1
        return acc
      },
      { total: 0, submitted: 0, approved: 0, rejected: 0, incomplete: 0 }
    )
  }, [drivers])

  const filteredDrivers = useMemo(() => {
    if (filterStatus === 'all') return drivers

    return drivers.filter((driver) => {
      const status = driver.verification_status || 'incomplete'
      return status === filterStatus
    })
  }, [drivers, filterStatus])

  async function getCurrentUser() {
    const { data: sessionData } = await supabase.auth.getSession()
    const sessionUser = sessionData?.session?.user || null

    if (sessionUser) return sessionUser

    const { data: authData } = await supabase.auth.getUser()
    return authData?.user || null
  }

  async function loadDrivers() {
    setLoading(true)
    setMessage('')

    const currentUser = await getCurrentUser()
    setAdminUser(currentUser)

    if (!currentUser) {
      setDrivers([])
      setCategoryRequests([])
      setWomenRequests([])
      setAdminProfile(null)
      setMessage('No hay sesión activa. Iniciá sesión con robycho@gmail.com o rogercho@gmail.com y volvé a /admin.')
      setLoading(false)
      return
    }

    const { data: ownProfile, error: ownProfileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle()

    if (ownProfileError) {
      console.warn('ADMIN PROFILE LOAD ERROR:', ownProfileError)
    }

    const fallbackAdminProfile = {
      id: currentUser.id,
      email: currentUser.email,
      role: ADMIN_EMAILS.includes(String(currentUser.email || '').toLowerCase()) ? 'admin' : 'sin rol',
      full_name: currentUser.user_metadata?.full_name || 'Admin',
    }

    const finalProfile = ownProfile || fallbackAdminProfile
    setAdminProfile(finalProfile)

    if (!isAdminAccount(currentUser, finalProfile)) {
      setDrivers([])
      setCategoryRequests([])
      setWomenRequests([])
      setMessage(`Estás logueado como ${currentUser.email}, pero su rol no es admin.`)
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('driver_profiles')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('ADMIN DRIVER LOAD ERROR:', error)
      setDrivers([])
      setMessage('Tu usuario es admin, pero RLS no está devolviendo choferes. Ejecutá las políticas SQL de admin.')
      setLoading(false)
      return
    }

    const { data: categoryData, error: categoryError } = await supabase
      .from('category_approval_requests')
      .select('*')
      .order('updated_at', { ascending: false })

    if (categoryError) {
      console.warn('ADMIN CATEGORY REQUESTS LOAD ERROR:', categoryError)
      setCategoryRequests([])
    } else {
      setCategoryRequests(categoryData || [])
    }

    const { data: womenData, error: womenError } = await supabase
      .from('profiles')
      .select('*')
      .eq('women_mode_status', 'requested')
      .order('updated_at', { ascending: false })

    if (womenError) {
      console.warn('ADMIN WOMEN REQUESTS LOAD ERROR:', womenError)
      setWomenRequests([])
    } else {
      setWomenRequests(womenData || [])
    }

    if (!data?.length) {
      setMessage('Admin activo. Todavía no hay choferes registrados o RLS no está devolviendo registros.')
    }

    setDrivers(data || [])
    setLoading(false)
  }

  async function openDocument(key, doc) {
    setMessage('')

    if (!doc?.path) {
      setMessage('Ese documento no tiene archivo guardado.')
      return
    }

    setPreviewLoading(true)

    const { data, error } = await supabase.storage
      .from('driver-documents')
      .createSignedUrl(doc.path, 60 * 10)

    setPreviewLoading(false)

    if (error || !data?.signedUrl) {
      console.error('ADMIN DOCUMENT PREVIEW ERROR:', error)
      setMessage('No pude abrir el documento. Revisá la política de lectura del bucket driver-documents para admin.')
      return
    }

    const fileName = doc.name || doc.path.split('/').pop() || DOCUMENT_LABELS[key]

    setPreviewDoc({
      label: DOCUMENT_LABELS[key] || 'Documento',
      name: fileName,
      url: data.signedUrl,
      isImage: isImageFile(fileName),
      isPdf: isPdfFile(fileName),
    })
  }

  async function updateDriverStatus(driver, status) {
    setMessage('')

    const approved = status === 'approved'
    const reviewedAt = new Date().toISOString()

    const { error } = await supabase
      .from('driver_profiles')
      .update({
        verification_status: status,
        verified: approved,
        is_online: approved ? driver.is_online : false,
        is_available: approved ? driver.is_available : false,
        reviewed_at: reviewedAt,
        updated_at: reviewedAt,
      })
      .eq('user_id', driver.user_id)

    if (error) {
      console.error('ADMIN DRIVER REVIEW ERROR:', error)
      setMessage('No pude guardar la revisión. Revisá permisos RLS de admin.')
      return
    }

    setDrivers((current) =>
      current.map((item) =>
        item.user_id === driver.user_id
          ? {
              ...item,
              verification_status: status,
              verified: approved,
              is_online: approved ? item.is_online : false,
              is_available: approved ? item.is_available : false,
              reviewed_at: reviewedAt,
            }
          : item
      )
    )

    setMessage(approved ? 'Chofer aprobado. Ya puede comenzar viajes.' : 'Chofer rechazado. Queda bloqueado para recibir viajes.')
  }

  async function updateCategoryRequest(request, decision) {
    setMessage('')

    const { error } = await adminReviewDriverCategory({
      workerId: request.worker_id,
      categoryCode: request.category_code,
      decision,
      reason: decision === 'approved' ? null : 'Rechazado desde panel admin',
    })

    if (error) {
      console.error('ADMIN CATEGORY REVIEW ERROR:', error)
      setMessage('No pude revisar la categoría. Revisá permisos admin.')
      return
    }

    setMessage(decision === 'approved' ? 'Categoría aprobada.' : 'Categoría rechazada.')
    await loadDrivers()
  }

  async function updateWomenRequest(profileRequest, decision) {
    setMessage('')

    const { error } = await adminReviewWomenMode({
      userId: profileRequest.id,
      decision,
      reason: decision === 'approved' ? null : 'Rechazado desde panel admin',
    })

    if (error) {
      console.error('ADMIN WOMEN REVIEW ERROR:', error)
      setMessage('No pude revisar MiChofer Ella. Revisá permisos admin.')
      return
    }

    setMessage(decision === 'approved' ? 'Acceso Ella aprobado.' : 'Acceso Ella rechazado.')
    await loadDrivers()
  }

  function filterTitle() {
    if (filterStatus === 'approved') return 'Aprobados'
    if (filterStatus === 'rejected') return 'Rechazados'
    if (filterStatus === 'all') return 'Todos los choferes'
    return 'En revisión'
  }

  return (
    <div className="admin-screen">
      <style>{adminStyles}</style>

      <main className="admin-shell">
        <header className="admin-top">
          <div>
            <p>MI CHOFER</p>
            <h1>Verificación</h1>
          </div>

          <button type="button" onClick={loadDrivers} aria-label="Actualizar">
            <RefreshCw size={20} />
          </button>
        </header>

        <section className="admin-stats">
          <div>
            <ShieldCheck size={20} />
            <span>En revisión</span>
            <strong>{stats.submitted}</strong>
          </div>

          <div>
            <UserCheck size={20} />
            <span>Aprobados</span>
            <strong>{stats.approved}</strong>
          </div>
        </section>

        <section className="admin-filters" aria-label="Filtros de verificación">
          <button
            type="button"
            className={filterStatus === 'submitted' ? 'active' : ''}
            onClick={() => setFilterStatus('submitted')}
          >
            En revisión
            <strong>{stats.submitted}</strong>
          </button>

          <button
            type="button"
            className={filterStatus === 'approved' ? 'active' : ''}
            onClick={() => setFilterStatus('approved')}
          >
            Aprobados
            <strong>{stats.approved}</strong>
          </button>

          <button
            type="button"
            className={filterStatus === 'rejected' ? 'active' : ''}
            onClick={() => setFilterStatus('rejected')}
          >
            Rechazados
            <strong>{stats.rejected}</strong>
          </button>

          <button
            type="button"
            className={filterStatus === 'all' ? 'active' : ''}
            onClick={() => setFilterStatus('all')}
          >
            Todos
            <strong>{stats.total}</strong>
          </button>
        </section>

        {message && <div className="admin-message">{message}</div>}

        <section className="admin-session">
          <strong>{adminUser?.email || 'Sin sesión'}</strong>
          <span>Rol: {adminProfile?.role || 'sin perfil visible'}</span>
        </section>

        {!adminUser && (
          <a className="admin-login-link" href="/login">
            Iniciar sesión como admin
          </a>
        )}

        {womenRequests.length > 0 && (
          <section className="admin-list">
            <div className="admin-list-title">
              <strong>MiChofer Ella pasajeras</strong>
              <span>{womenRequests.length} pendiente{womenRequests.length === 1 ? '' : 's'}</span>
            </div>

            {womenRequests.map((request) => (
              <article key={request.id} className="admin-driver-card admin-category-review-card">
                <div className="admin-driver-head">
                  <div>
                    <span className="admin-status submitted">En revisión</span>
                    <h2>{request.full_name || request.email || 'Pasajera MiChofer'}</h2>
                    <p>Solicitó acceso a viajes con conductoras verificadas.</p>
                  </div>
                </div>

                <div className="admin-driver-meta">
                  <span>{request.email || 'Sin correo'}</span>
                  <span>Género privado</span>
                  <span>{request.women_mode_status || 'requested'}</span>
                </div>

                <div className="admin-actions">
                  <button className="approve" type="button" onClick={() => updateWomenRequest(request, 'approved')}>
                    Aprobar Ella
                  </button>

                  <button className="reject" type="button" onClick={() => updateWomenRequest(request, 'rejected')}>
                    Rechazar
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}

        {categoryRequests.filter((request) => ['requested', 'in_review'].includes(request.status)).length > 0 && (
          <section className="admin-list">
            <div className="admin-list-title">
              <strong>Categorías de chofer</strong>
              <span>
                {categoryRequests.filter((request) => ['requested', 'in_review'].includes(request.status)).length} pendiente
              </span>
            </div>

            {categoryRequests
              .filter((request) => ['requested', 'in_review'].includes(request.status))
              .map((request) => {
                const driver = drivers.find((item) => item.user_id === request.worker_id)
                const meta = getRideCategoryMeta(request.category_code)

                return (
                  <article key={request.id} className="admin-driver-card admin-category-review-card">
                    <div className="admin-driver-head">
                      <div>
                        <span className="admin-status submitted">{categoryStatusLabel('requested')}</span>
                        <h2>{meta.title}</h2>
                        <p>{driver?.full_name || 'Chofer MiChofer'} quiere activar esta categoría.</p>
                      </div>
                    </div>

                    <div className="admin-driver-meta">
                      <span>{driver?.email || 'Sin correo visible'}</span>
                      <span>{driver?.car_brand || 'Vehículo'} {driver?.car_model || ''}</span>
                      <span>{driver?.plate || 'Sin matrícula'}</span>
                    </div>

                    <div className="admin-actions">
                      <button className="approve" type="button" onClick={() => updateCategoryRequest(request, 'approved')}>
                        Aprobar categoría
                      </button>

                      <button className="reject" type="button" onClick={() => updateCategoryRequest(request, 'rejected')}>
                        Rechazar
                      </button>
                    </div>
                  </article>
                )
              })}
          </section>
        )}

        {loading ? (
          <section className="admin-empty">Cargando choferes...</section>
        ) : drivers.length === 0 ? (
          <section className="admin-empty">Todavía no hay choferes registrados.</section>
        ) : filteredDrivers.length === 0 ? (
          <section className="admin-empty">No hay choferes en {filterTitle().toLowerCase()}.</section>
        ) : (
          <section className="admin-list">
            <div className="admin-list-title">
              <strong>{filterTitle()}</strong>
              <span>{filteredDrivers.length} resultado{filteredDrivers.length === 1 ? '' : 's'}</span>
            </div>

            {filteredDrivers.map((driver) => {
              const documents = driver.documents || {}
              const documentCount = Object.keys(documents).length
              const status = driver.verification_status || 'incomplete'
              const showDocuments = status === 'submitted' || expandedDocs[driver.user_id]

              return (
                <article key={driver.user_id} className="admin-driver-card">
                  <div className="admin-driver-head">
                    <div>
                      <span className={`admin-status ${status}`}>
                        {statusLabel(status)}
                      </span>

                      <h2>{driver.full_name || 'Chofer MiChofer'}</h2>

                      <p>
                        {driver.car_brand || 'Vehículo'} {driver.car_model || ''} · {driver.plate || 'Sin matrícula'}
                      </p>
                    </div>
                  </div>

                  <div className="admin-driver-meta">
                    <span>{driver.phone || 'Sin teléfono'}</span>
                    <span>{driver.email || 'Sin correo'}</span>
                    <span>{driver.payout_alias || 'Sin alias'}</span>
                  </div>

                  <div className={showDocuments ? 'admin-docs' : 'admin-docs collapsed'}>
                    <div className="admin-doc-summary">
                      <FileText size={18} />
                      <strong>{documentCount}/7 documentos</strong>
                    </div>

                    {status !== 'submitted' && (
                      <button
                        type="button"
                        className="toggle-docs"
                        onClick={() =>
                          setExpandedDocs((current) => ({
                            ...current,
                            [driver.user_id]: !current[driver.user_id],
                          }))
                        }
                      >
                        {showDocuments ? 'Ocultar archivos' : 'Ver archivos'}
                      </button>
                    )}

                    {showDocuments && Object.entries(DOCUMENT_LABELS).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={documents[key] ? 'done' : ''}
                        onClick={() => openDocument(key, documents[key])}
                        disabled={!documents[key] || previewLoading}
                        title={documents[key] ? 'Ver documento' : 'Documento pendiente'}
                      >
                        {documents[key] ? <Eye size={14} /> : <XCircle size={14} />}
                        {label}
                      </button>
                    ))}
                  </div>

                  {status !== 'approved' && status !== 'rejected' && (
                    <div className="admin-actions">
                      <button
                        type="button"
                        className="approve"
                        onClick={() => updateDriverStatus(driver, 'approved')}
                      >
                        Aprobar
                      </button>

                      <button
                        type="button"
                        className="reject"
                        onClick={() => {
                          if (window.confirm('Rechazar este chofer impedirá que reciba viajes.')) {
                            updateDriverStatus(driver, 'rejected')
                          }
                        }}
                      >
                        Rechazar
                      </button>
                    </div>
                  )}
                </article>
              )
            })}
          </section>
        )}
      </main>

      {previewDoc && (
        <div className="admin-preview-backdrop" onClick={() => setPreviewDoc(null)}>
          <section className="admin-preview" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p>DOCUMENTO</p>
                <h2>{previewDoc.label}</h2>
                <span>{previewDoc.name}</span>
              </div>

              <button
                type="button"
                className="admin-preview-close"
                onClick={() => setPreviewDoc(null)}
                aria-label="Cerrar vista previa"
              >
                <X size={20} />
              </button>
            </header>

            <div className="admin-preview-body">
              {previewDoc.isImage ? (
                <img src={previewDoc.url} alt={previewDoc.label} />
              ) : previewDoc.isPdf ? (
                <iframe src={previewDoc.url} title={previewDoc.label} />
              ) : (
                <div className="admin-preview-file">
                  <FileText size={38} />
                  <strong>No hay vista previa para este formato.</strong>
                </div>
              )}
            </div>

            <a href={previewDoc.url} target="_blank" rel="noreferrer">
              <ExternalLink size={18} />
              Abrir archivo completo
            </a>
          </section>
        </div>
      )}
    </div>
  )
}

const adminStyles = `
  .admin-screen {
    min-height: 100vh;
    background: #050706;
    color: #07110f;
    display: flex;
    justify-content: center;
    font-family: Inter, Arial, sans-serif;
  }

  .admin-shell {
    width: 100%;
    max-width: 960px;
    min-height: 100vh;
    padding: 24px;
    background: #f5f7f6;
  }

  .admin-top {
    min-height: 86px;
    border-radius: 28px;
    background: #07110f;
    color: white;
    padding: 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .admin-top p {
    margin: 0 0 8px;
    color: #63c0ba;
    font-size: 11px;
    letter-spacing: .16em;
    font-weight: 950;
  }

  .admin-top h1 {
    margin: 0;
    font-size: 32px;
    line-height: 1;
    font-weight: 950;
  }

  .admin-top button {
    width: 52px;
    height: 52px;
    border: 0;
    border-radius: 18px;
    background: rgba(255,255,255,.1);
    color: white;
    display: grid;
    place-items: center;
    cursor: pointer;
  }

  .admin-stats {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .admin-stats div,
  .admin-driver-card,
  .admin-empty {
    border-radius: 26px;
    background: white;
    box-shadow: 0 12px 30px rgba(0,0,0,.06);
  }

  .admin-stats div {
    min-height: 118px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .admin-stats svg {
    color: #63c0ba;
  }

  .admin-stats span {
    color: #667085;
    font-size: 13px;
    font-weight: 900;
  }

  .admin-stats strong {
    font-size: 34px;
    line-height: 1;
    font-weight: 950;
  }

  .admin-filters {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .admin-filters button {
    min-height: 54px;
    border: 0;
    border-radius: 18px;
    background: #ffffff;
    color: #667085;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
    padding: 0 11px;
    font-size: 12px;
    font-weight: 950;
    cursor: pointer;
    box-shadow: 0 12px 30px rgba(0,0,0,.05);
  }

  .admin-filters button.active {
    background: #07110f;
    color: #ffffff;
  }

  .admin-filters strong {
    font-size: 18px;
    line-height: 1;
  }

  .admin-message,
  .admin-session,
  .admin-empty,
  .admin-login-link {
    margin-top: 14px;
    padding: 16px;
    font-weight: 900;
  }

  .admin-message {
    border-radius: 20px;
    background: #fff4cc;
    color: #442d00;
  }

  .admin-session {
    border-radius: 20px;
    background: #ffffff;
    display: grid;
    gap: 5px;
    box-shadow: 0 12px 30px rgba(0,0,0,.06);
  }

  .admin-session strong {
    color: #07110f;
    font-size: 14px;
  }

  .admin-session span {
    color: #667085;
    font-size: 13px;
  }

  .admin-login-link {
    display: flex;
    min-height: 52px;
    align-items: center;
    justify-content: center;
    border-radius: 18px;
    background: #07110f;
    color: white;
    text-decoration: none;
  }

  .admin-list {
    margin-top: 16px;
    display: grid;
    gap: 14px;
  }

  .admin-list-title {
    min-height: 50px;
    border-radius: 20px;
    background: #ffffff;
    padding: 0 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    box-shadow: 0 12px 30px rgba(0,0,0,.05);
  }

  .admin-list-title strong {
    font-size: 15px;
    font-weight: 950;
  }

  .admin-list-title span {
    color: #667085;
    font-size: 12px;
    font-weight: 900;
  }

  .admin-driver-card {
    padding: 16px;
    display: grid;
    gap: 14px;
  }

  .admin-driver-head {
    display: flex;
    justify-content: space-between;
    gap: 14px;
  }

  .admin-status {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    border-radius: 999px;
    padding: 0 10px;
    background: #fff4cc;
    color: #442d00;
    font-size: 12px;
    font-weight: 950;
  }

  .admin-status.approved {
    background: #e8f7f5;
    color: #075e57;
  }

  .admin-status.rejected {
    background: #ffe8e8;
    color: #b42318;
  }

  .admin-driver-card h2 {
    margin: 10px 0 0;
    font-size: 24px;
    line-height: 1;
    font-weight: 950;
  }

  .admin-driver-card p {
    margin: 7px 0 0;
    color: #667085;
    font-size: 14px;
    font-weight: 850;
  }

  .admin-driver-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .admin-driver-meta span {
    min-height: 34px;
    border-radius: 999px;
    background: #f1f4f3;
    padding: 8px 10px;
    color: #34403d;
    font-size: 12px;
    font-weight: 900;
  }

  .admin-docs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .admin-docs.collapsed {
    align-items: center;
  }

  .admin-doc-summary,
  .admin-docs button {
    min-height: 36px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 950;
  }

  .admin-doc-summary {
    background: #07110f;
    color: white;
  }

  .admin-docs button {
    border: 0;
    background: #f1f4f3;
    color: #667085;
    cursor: pointer;
  }

  .admin-docs button.done {
    background: #e8f7f5;
    color: #075e57;
  }

  .admin-docs button.toggle-docs {
    background: #ffffff;
    color: #07110f;
    box-shadow: inset 0 0 0 1px #dde5e2;
  }

  .admin-docs button:disabled {
    cursor: not-allowed;
    opacity: .72;
  }

  .admin-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .admin-actions button {
    min-height: 52px;
    border: 0;
    border-radius: 18px;
    font-size: 15px;
    font-weight: 950;
    cursor: pointer;
  }

  .admin-actions .approve {
    background: #07110f;
    color: white;
  }

  .admin-actions .reject {
    background: #ffe8e8;
    color: #b42318;
  }

  .admin-preview-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(5,7,6,.72);
    padding: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .admin-preview {
    width: min(920px, 100%);
    max-height: calc(100vh - 36px);
    border-radius: 30px;
    background: #ffffff;
    padding: 16px;
    display: grid;
    gap: 14px;
    box-shadow: 0 30px 90px rgba(0,0,0,.38);
  }

  .admin-preview header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }

  .admin-preview header p {
    margin: 0 0 6px;
    color: #63c0ba;
    font-size: 11px;
    letter-spacing: .16em;
    font-weight: 950;
  }

  .admin-preview h2 {
    margin: 0;
    color: #07110f;
    font-size: 24px;
    line-height: 1;
    font-weight: 950;
  }

  .admin-preview header span {
    display: block;
    margin-top: 7px;
    color: #667085;
    font-size: 13px;
    font-weight: 850;
  }

  .admin-preview-close {
    width: 48px;
    height: 48px;
    border: 0;
    border-radius: 17px;
    background: #f1f4f3;
    color: #07110f;
    display: grid;
    place-items: center;
    cursor: pointer;
    flex: 0 0 auto;
  }

  .admin-preview-body {
    min-height: 280px;
    max-height: 62vh;
    border-radius: 24px;
    background: #f1f4f3;
    overflow: hidden;
    display: grid;
    place-items: center;
  }

  .admin-preview-body img,
  .admin-preview-body iframe {
    width: 100%;
    height: 100%;
    min-height: 280px;
    border: 0;
  }

  .admin-preview-body img {
    object-fit: contain;
  }

  .admin-preview-file {
    padding: 26px;
    color: #667085;
    display: grid;
    justify-items: center;
    gap: 12px;
    text-align: center;
  }

  .admin-preview a {
    min-height: 52px;
    border-radius: 18px;
    background: #07110f;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-decoration: none;
    font-size: 15px;
    font-weight: 950;
  }

  @media (max-width: 560px) {
    .admin-shell {
      padding: 18px;
    }

    .admin-filters {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .admin-preview {
      border-radius: 24px;
    }
  }
`
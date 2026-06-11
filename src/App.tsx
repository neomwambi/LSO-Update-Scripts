import { useCallback, useEffect, useState } from 'react'
import './App.css'

type ConnectionStatus = {
  connected: boolean
  source: 'env' | 'manual' | null
  host?: string
  port?: number
  user?: string
  database?: string | null
  envFileConfigured: boolean
}

type ProcessResult = {
  ok: boolean
  errors?: string[]
  warnings?: string[]
  sheetName?: string
  mergedRowCount?: number
  lookupRowCount?: number
  noMatch?: {
    policy: string
    benefitName: string
    rowIndex: number
    ownerFirst?: string
    ownerSurname?: string
  }[]
  lookupSqlParameterized?: string
  uniqueNames?: string[]
  uniquePolicies?: string[]
  scripts?: Record<string, string>
  previews?: Record<string, string>
  previewCounts?: Record<string, number | null>
  totalPreviewRows?: number | null
  message?: string
}

const SCRIPT_LABELS: { key: keyof NonNullable<ProcessResult['scripts']>; title: string }[] = [
  { key: 'policyroleplayer_dob', title: '1. policyroleplayer - DateOfBirth' },
  { key: 'policyroleplayer_id', title: '2. policyroleplayer - IDNumber' },
  { key: 'individual', title: '3. members_prod.individual' },
  { key: 'policy_id', title: '4. policy - IDNumber (owner = benefit, column D)' },
  { key: 'policyroleplayer_searchmeta', title: '5. policyroleplayer - SearchMetaInfo' },
  { key: 'individual_searchmeta', title: '6. individual - SearchMetaInfo' },
  { key: 'policy_searchmeta', title: '7. policy - SearchMetaInfo' },
]

const defaultManual = {
  host: '127.0.0.1',
  port: '3306',
  user: '',
  password: '',
  database: 'policies_prod',
}

function App() {
  const [conn, setConn] = useState<ConnectionStatus | null>(null)
  const [manual, setManual] = useState(defaultManual)
  const [connectBusy, setConnectBusy] = useState(false)
  const [dbStatus, setDbStatus] = useState<'unknown' | 'ok' | 'fail'>('unknown')
  const [dbMessage, setDbMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [activeTab, setActiveTab] = useState<string>('policyroleplayer_dob')
  const [copiedHint, setCopiedHint] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState<'home' | 'database' | 'excel' | 'results'>('home')
  const [menuOpen, setMenuOpen] = useState(false)

  const goTo = useCallback((section: 'home' | 'database' | 'excel' | 'results', anchorId: string) => {
    setActiveNav(section)
    setMenuOpen(false)
    window.requestAnimationFrame(() => {
      document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const flashCopied = useCallback((label: string) => {
    setCopiedHint(label)
    window.setTimeout(() => setCopiedHint(null), 2000)
  }, [])

  const refreshConnectionStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/connection-status')
      const j = (await r.json()) as ConnectionStatus & { ok?: boolean }
      if (j.ok !== false) {
        setConn({
          connected: j.connected,
          source: j.source,
          host: j.host,
          port: j.port,
          user: j.user,
          database: j.database,
          envFileConfigured: j.envFileConfigured,
        })
      }
    } catch {
      setConn(null)
    }
  }, [])

  useEffect(() => {
    void refreshConnectionStatus()
  }, [refreshConnectionStatus])

  const testDb = useCallback(async () => {
    setDbMessage('')
    try {
      const r = await fetch('/api/test-db', { method: 'POST' })
      const j = await r.json()
      if (j.ok) {
        setDbStatus('ok')
        setDbMessage(j.message || 'Connected.')
        await refreshConnectionStatus()
      } else {
        setDbStatus('fail')
        setDbMessage(j.message || 'Connection failed.')
      }
    } catch (e) {
      setDbStatus('fail')
      setDbMessage(e instanceof Error ? e.message : 'Request failed.')
    }
  }, [refreshConnectionStatus])

  const connectFromEnv = useCallback(async () => {
    setConnectBusy(true)
    setDbMessage('')
    try {
      const r = await fetch('/api/connect-env', { method: 'POST' })
      const j = await r.json()
      if (j.ok) {
        setDbStatus('ok')
        setDbMessage(j.message || 'Connected.')
        await refreshConnectionStatus()
      } else {
        setDbStatus('fail')
        setDbMessage(j.message || 'Failed.')
      }
    } catch (e) {
      setDbStatus('fail')
      setDbMessage(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setConnectBusy(false)
    }
  }, [refreshConnectionStatus])

  const disconnectDb = useCallback(async () => {
    setConnectBusy(true)
    setDbMessage('')
    try {
      const r = await fetch('/api/disconnect', { method: 'POST' })
      const j = await r.json()
      setDbStatus('unknown')
      setDbMessage(j.message || 'Disconnected.')
      await refreshConnectionStatus()
    } catch (e) {
      setDbMessage(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setConnectBusy(false)
    }
  }, [refreshConnectionStatus])

  const connectManual = useCallback(async () => {
    setConnectBusy(true)
    setDbMessage('')
    try {
      const r = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: manual.host.trim(),
          port: Number(manual.port) || 3306,
          user: manual.user.trim(),
          password: manual.password,
          database: manual.database.trim() || undefined,
        }),
      })
      const j = await r.json()
      if (j.ok) {
        setDbStatus('ok')
        setDbMessage(j.message || 'Connected.')
        await refreshConnectionStatus()
      } else {
        setDbStatus('fail')
        setDbMessage(j.message || 'Connection failed.')
      }
    } catch (e) {
      setDbStatus('fail')
      setDbMessage(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setConnectBusy(false)
    }
  }, [manual, refreshConnectionStatus])

  const onFile = useCallback(async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/process', { method: 'POST', body: fd })
      const j = (await r.json()) as ProcessResult
      setResult(j)
      if (j.ok) setDbStatus('ok')
    } catch (e) {
      setResult({
        ok: false,
        errors: [e instanceof Error ? e.message : 'Upload failed.'],
      })
    } finally {
      setBusy(false)
    }
  }, [])

  const copy = useCallback(
    (text: string, label: string) => {
      void navigator.clipboard.writeText(text)
      flashCopied(label)
    },
    [flashCopied]
  )

  const allUpdateScripts = result?.ok
    ? SCRIPT_LABELS.map(({ key, title }) => {
        const sql = result.scripts?.[key]?.trim()
        if (!sql) return null
        return `-- ${title}\n${sql}`
      })
        .filter(Boolean)
        .join('\n\n')
    : ''

  const allPreviewScripts = result?.ok
    ? SCRIPT_LABELS.map(({ key, title }) => {
        const sql = result.previews?.[key]?.trim()
        if (!sql) return null
        return `-- ${title}\n${sql}`
      })
        .filter(Boolean)
        .join('\n\n')
    : ''

  const scriptKeys = SCRIPT_LABELS.map((s) => s.key)
  const currentScript =
    result?.scripts?.[activeTab as keyof NonNullable<ProcessResult['scripts']>] ?? ''
  const currentPreview =
    result?.previews?.[activeTab as keyof NonNullable<ProcessResult['previews']>] ?? ''

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <button
        type="button"
        className="nav-overlay"
        aria-label="Close menu"
        onClick={() => setMenuOpen(false)}
      />
      <header className="site-header">
        <div className="header-inner">
          <div className="header-brand">
            <img
              className="header-logo"
              src="/branding/logo-full.png"
              alt="MobiLife"
              width={180}
              height={44}
            />
            <span className="header-tagline">Lesotho benefit DOB / ID updates</span>
          </div>
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
          <nav id="primary-nav" className="top-nav" aria-label="Main navigation">
            <button
              type="button"
              className={`nav-btn${activeNav === 'home' ? ' active' : ''}`}
              onClick={() => goTo('home', 'section-home')}
            >
              Home
            </button>
            <button
              type="button"
              className={`nav-btn${activeNav === 'database' ? ' active' : ''}`}
              onClick={() => goTo('database', 'section-database')}
            >
              Database
            </button>
            <button
              type="button"
              className={`nav-btn${activeNav === 'excel' ? ' active' : ''}`}
              onClick={() => goTo('excel', 'section-excel')}
            >
              Upload spreadsheet
            </button>
            <button
              type="button"
              className={`nav-btn${activeNav === 'results' ? ' active' : ''}`}
              onClick={() => goTo('results', 'section-results')}
            >
              SQL output
            </button>
          </nav>
        </div>
      </header>

      <main className="main">
        <div className="main-inner">
          <section id="section-home" className="section-anchor hero">
            <img
              className="hero-bird"
              src="/branding/logo-bird.png"
              alt=""
              width={200}
              height={260}
            />
            <h1 className="hero-title">Lesotho benefit DOB / ID updates</h1>
            <p className="lede">
              Prepare database updates from the client Excel file (columns A through F). With{' '}
              <strong>VPN</strong> on, connect using your own MySQL user, upload the workbook, then copy
              generated scripts for <code>policyroleplayer</code>, <code>individual</code>,{' '}
              <code>policy</code>, and <code>SearchMetaInfo</code>.
            </p>

            <div className="feature-grid">
              <div className="feature-card">
                <h3>Database</h3>
                <p>Test the connection and sign in with .env or your credentials.</p>
                <button type="button" className="linkish" onClick={() => goTo('database', 'section-database')}>
                  Go to Database
                </button>
              </div>
              <div className="feature-card">
                <h3>Upload spreadsheet</h3>
                <p>Choose the Lesotho master template and generate SQL plus preview row counts.</p>
                <button type="button" className="linkish" onClick={() => goTo('excel', 'section-excel')}>
                  Choose file
                </button>
              </div>
            </div>

            <div className="how-to">
              <h2>How to use this tool</h2>
              <ol>
                <li>
                  Connect to MySQL (same server as your team, your own username). Use <strong>Test</strong>{' '}
                  or connect from <code>.env</code>.
                </li>
                <li>Upload the Excel file. Fix any validation errors or warnings shown in the results area.</li>
                <li>
                  Review preview counts, then copy each script or <strong>Copy all</strong>. Run statements in
                  your usual SQL client in the recommended order (data updates, then SearchMetaInfo).
                </li>
              </ol>
            </div>
          </section>

          <section id="section-database" className="section-anchor panel">
        <h2>Database</h2>
        {conn?.connected ? (
          <p className="status ok conn-line">
            Connected as <code>{conn.user}</code> @ <code>{conn.host}</code>
            {conn.port != null ? `:${conn.port}` : ''}
            {conn.database ? (
              <>
                {' '}
                / <code>{conn.database}</code>
              </>
            ) : null}
            <span className="conn-source">
              {' '}
              ({conn.source === 'env' ? 'from .env file' : 'credentials entered below'})
            </span>
          </p>
        ) : (
          <p className="hint">
            Not connected. Use a <code>.env</code> file on this PC, or enter your own database user
            below (never share your password; each colleague uses their own login).
          </p>
        )}

        <div className="db-actions">
          <button
            type="button"
            className="btn primary"
            disabled={connectBusy}
            onClick={() => void testDb()}
          >
            Test MySQL connection
          </button>
          {conn?.envFileConfigured && (
            <button
              type="button"
              className="btn"
              disabled={connectBusy}
              onClick={() => void connectFromEnv()}
            >
              Connect from .env
            </button>
          )}
          {conn?.connected && (
            <button
              type="button"
              className="btn"
              disabled={connectBusy}
              onClick={() => void disconnectDb()}
            >
              Disconnect
            </button>
          )}
        </div>

        {dbStatus !== 'unknown' && dbMessage && (
          <p className={dbStatus === 'ok' ? 'status ok' : 'status fail'}>{dbMessage}</p>
        )}

        <details className="details manual-connect">
          <summary>Connect with my credentials (no .env file)</summary>
          <p className="hint">
            Same <strong>host</strong> as the rest of the team; use <strong>your</strong> MySQL username
            and password. Values are sent only to your local API (<code>127.0.0.1</code>), not over the
            public internet.
          </p>
          <div className="form-grid">
            <label>
              Host
              <input
                className="input"
                value={manual.host}
                onChange={(e) => setManual((m) => ({ ...m, host: e.target.value }))}
                autoComplete="off"
              />
            </label>
            <label>
              Port
              <input
                className="input"
                value={manual.port}
                onChange={(e) => setManual((m) => ({ ...m, port: e.target.value }))}
                autoComplete="off"
              />
            </label>
            <label>
              Database (optional)
              <input
                className="input"
                value={manual.database}
                onChange={(e) => setManual((m) => ({ ...m, database: e.target.value }))}
                autoComplete="off"
              />
            </label>
            <label>
              MySQL user
              <input
                className="input"
                value={manual.user}
                onChange={(e) => setManual((m) => ({ ...m, user: e.target.value }))}
                autoComplete="username"
              />
            </label>
            <label className="span-2">
              Password
              <input
                className="input"
                type="password"
                value={manual.password}
                onChange={(e) => setManual((m) => ({ ...m, password: e.target.value }))}
                autoComplete="current-password"
              />
            </label>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={connectBusy || !manual.host.trim() || !manual.user.trim()}
            onClick={() => void connectManual()}
          >
            Connect with these credentials
          </button>
        </details>
      </section>

      <section id="section-excel" className="section-anchor panel">
        <h2>Excel file</h2>
        <label className="file-label">
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
          <span>{busy ? 'Working…' : 'Choose .xlsx file'}</span>
        </label>
      </section>

      <section id="section-results" className="section-anchor panel results">
        <h2>SQL output</h2>
        {!result && (
          <p className="hint">
            Upload a spreadsheet after connecting to MySQL to see validation, preview counts, and generated
            scripts.
          </p>
        )}
        {result && (
          <>
          {!result.ok && result.errors && result.errors.length > 0 && (
            <div className="callout error">
              <strong>Fix and re-upload</strong>
              <ul>
                {result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {result.warnings && result.warnings.length > 0 && (
            <div className="callout warn">
              <strong>Warnings</strong>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {result.ok && (
            <>
              <div className="stats">
                {result.sheetName && (
                  <span>
                    Sheet: <code>{result.sheetName}</code>
                  </span>
                )}
                {result.mergedRowCount != null && (
                  <span>Unique policy+benefit targets: {result.mergedRowCount}</span>
                )}
                {result.lookupRowCount != null && (
                  <span>Lookup rows returned: {result.lookupRowCount}</span>
                )}
                {result.totalPreviewRows != null && (
                  <span className="highlight">
                    Preview rows that would change (all scripts): {result.totalPreviewRows}
                  </span>
                )}
              </div>

              {result.previewCounts && (
                <ul className="count-list">
                  {SCRIPT_LABELS.map(({ key, title }) => {
                    const n = result.previewCounts?.[key]
                    if (n == null) return null
                    return (
                      <li key={key}>
                        {title}: <strong>{n}</strong>
                      </li>
                    )
                  })}
                </ul>
              )}

              {result.noMatch && result.noMatch.length > 0 && (
                <details className="details">
                  <summary>No DB match for these targets ({result.noMatch.length})</summary>
                  <ul className="compact-list">
                    {result.noMatch.map((n, i) => {
                      const owner = [n.ownerFirst, n.ownerSurname].filter(Boolean).join(' ').trim()
                      return (
                        <li key={i}>
                          Row {n.rowIndex}: {n.policy} - {n.benefitName}
                          {owner ? ` (owner: ${owner})` : ''}
                        </li>
                      )
                    })}
                  </ul>
                </details>
              )}

              <div className="copy-all-row">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!allUpdateScripts}
                  onClick={() => copy(allUpdateScripts, 'All UPDATE scripts copied to clipboard.')}
                >
                  Copy all UPDATE scripts
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!allPreviewScripts}
                  onClick={() =>
                    copy(allPreviewScripts, 'All preview SELECTs copied to clipboard.')
                  }
                >
                  Copy all preview SELECTs
                </button>
              </div>

              <div className="tabs">
                {scriptKeys.map((key) => {
                  const label = SCRIPT_LABELS.find((s) => s.key === key)?.title ?? key
                  return (
                    <button
                      key={key}
                      type="button"
                      className={activeTab === key ? 'tab active' : 'tab'}
                      onClick={() => setActiveTab(key)}
                    >
                      {label.replace(/^\d+\.\s*/, '')}
                    </button>
                  )
                })}
              </div>

              <div className="script-block">
                <div className="script-head">
                  <h3>UPDATE script</h3>
                  <button
                    type="button"
                    className="btn"
                    disabled={!currentScript}
                    onClick={() => copy(currentScript, 'UPDATE script copied to clipboard.')}
                  >
                    Copy
                  </button>
                </div>
                <pre className="sql">{currentScript || '- (nothing generated for this section)'}</pre>
              </div>

              <div className="script-block">
                <div className="script-head">
                  <h3>Preview SELECT (same CASE logic)</h3>
                  <button
                    type="button"
                    className="btn"
                    disabled={!currentPreview}
                    onClick={() => copy(currentPreview, 'Preview SELECT copied to clipboard.')}
                  >
                    Copy
                  </button>
                </div>
                <pre className="sql">{currentPreview || '-'}</pre>
              </div>
            </>
          )}

          {!result.ok && result.lookupSqlParameterized && result.uniqueNames && (
            <details className="details">
              <summary>Lookup SQL template (parameterized)</summary>
              <pre className="sql">{result.lookupSqlParameterized}</pre>
              <p className="hint">
                Bind names then policies twice, in order:{' '}
                <code>[...uniqueNames, ...uniquePolicies, ...uniqueNames, ...uniquePolicies]</code>
              </p>
            </details>
          )}
          </>
        )}
      </section>

      {copiedHint && <p className="toast" role="status">{copiedHint}</p>}

      <footer className="footer">
        <p>
          Runs on your machine only. Use VPN before connecting to MySQL. Do not commit <code>.env</code>.
        </p>
        <p>
          Each person runs this on their own PC: <code>npm.cmd run dev</code> (API on 3001, UI proxied).
          Do not commit <code>.env</code> or share passwords. Same DB host, individual MySQL users.
        </p>
      </footer>
        </div>
      </main>
    </div>
  )
}

export default App

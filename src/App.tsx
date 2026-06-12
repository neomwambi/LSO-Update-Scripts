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
  countParityVerified?: boolean | null
  message?: string
}

type ScriptKey = keyof NonNullable<ProcessResult['scripts']>

const SCRIPT_LABELS: { key: ScriptKey; title: string }[] = [
  { key: 'policyroleplayer_dob', title: '1. policyroleplayer - DateOfBirth' },
  { key: 'policyroleplayer_id', title: '2. policyroleplayer - IDNumber' },
  { key: 'individual', title: '3. members_prod.individual' },
  { key: 'policy_id', title: '4. policy - IDNumber (owner = benefit, column D)' },
  { key: 'policyroleplayer_searchmeta', title: '5. policyroleplayer - SearchMetaInfo' },
  { key: 'individual_searchmeta', title: '6. individual - SearchMetaInfo' },
  { key: 'policy_searchmeta', title: '7. policy - SearchMetaInfo' },
]

const DATA_SCRIPT_LABELS = SCRIPT_LABELS.filter(({ key }) => !String(key).includes('searchmeta'))
const SEARCHMETA_SCRIPT_LABELS = SCRIPT_LABELS.filter(({ key }) => String(key).includes('searchmeta'))

function sumPreviewCounts(
  labels: typeof SCRIPT_LABELS,
  counts: ProcessResult['previewCounts']
): number {
  return labels.reduce((sum, { key }) => {
    const n = counts?.[key]
    return sum + (typeof n === 'number' ? n : 0)
  }, 0)
}

function joinScriptBundle(
  labels: typeof SCRIPT_LABELS,
  scripts: ProcessResult['scripts'] | ProcessResult['previews'] | undefined
): string {
  return labels
    .map(({ key, title }) => {
      const sql = scripts?.[key]?.trim()
      if (!sql) return null
      return `-- ${title}\n${sql}`
    })
    .filter(Boolean)
    .join('\n\n')
}

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
  const [activeDataTab, setActiveDataTab] = useState<ScriptKey>('policyroleplayer_dob')
  const [activeSearchMetaTab, setActiveSearchMetaTab] =
    useState<ScriptKey>('policyroleplayer_searchmeta')
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

  const dataUpdateScripts = result?.ok ? joinScriptBundle(DATA_SCRIPT_LABELS, result.scripts) : ''
  const dataPreviewScripts = result?.ok ? joinScriptBundle(DATA_SCRIPT_LABELS, result.previews) : ''
  const searchMetaUpdateScripts = result?.ok
    ? joinScriptBundle(SEARCHMETA_SCRIPT_LABELS, result.scripts)
    : ''
  const searchMetaPreviewScripts = result?.ok
    ? joinScriptBundle(SEARCHMETA_SCRIPT_LABELS, result.previews)
    : ''

  const dataPreviewTotal = result?.previewCounts
    ? sumPreviewCounts(DATA_SCRIPT_LABELS, result.previewCounts)
    : 0
  const searchMetaPreviewTotal = result?.previewCounts
    ? sumPreviewCounts(SEARCHMETA_SCRIPT_LABELS, result.previewCounts)
    : 0

  const currentDataScript = result?.scripts?.[activeDataTab] ?? ''
  const currentDataPreview = result?.previews?.[activeDataTab] ?? ''
  const currentSearchMetaScript = result?.scripts?.[activeSearchMetaTab] ?? ''
  const currentSearchMetaPreview = result?.previews?.[activeSearchMetaTab] ?? ''

  const renderScriptGroup = (
    title: string,
    labels: typeof SCRIPT_LABELS,
    previewTotal: number,
    updateBundle: string,
    previewBundle: string,
    activeTab: ScriptKey,
    setActiveTab: (key: ScriptKey) => void,
    currentScript: string,
    currentPreview: string,
    copyUpdateLabel: string,
    copyPreviewLabel: string
  ) => (
    <div className="script-group">
      <div className="script-group-head">
        <h3 className="script-group-title">{title}</h3>
        <span className="script-group-total">
          Rows UPDATE will affect (same as preview): <strong>{previewTotal}</strong>
        </span>
      </div>

      {result?.previewCounts && (
        <ul className="count-list">
          {labels.map(({ key, title: label }) => {
            const n = result.previewCounts?.[key]
            if (n == null) return null
            return (
              <li key={key}>
                {label.replace(/^\d+\.\s*/, '')}: <strong>{n}</strong>
              </li>
            )
          })}
        </ul>
      )}

      <div className="copy-all-row">
        <button
          type="button"
          className="btn primary"
          disabled={!updateBundle}
          onClick={() => copy(updateBundle, copyUpdateLabel)}
        >
          Copy UPDATE scripts
        </button>
        <button
          type="button"
          className="btn"
          disabled={!previewBundle}
          onClick={() => copy(previewBundle, copyPreviewLabel)}
        >
          Copy preview SELECTs
        </button>
      </div>

      <div className="tabs">
        {labels.map(({ key, title: label }) => (
          <button
            key={key}
            type="button"
            className={activeTab === key ? 'tab active' : 'tab'}
            onClick={() => setActiveTab(key)}
          >
            {label.replace(/^\d+\.\s*/, '')}
          </button>
        ))}
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
    </div>
  )

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
                  Review row counts (verified with read-only SELECT/COUNT when connected). Copy UPDATE and
                  preview scripts and pass them to someone with write access. Run data updates first, then
                  SearchMetaInfo.
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
            Upload a spreadsheet after connecting to MySQL. A read-only login is enough: the app only runs
            SELECT and COUNT queries, then builds UPDATE scripts for you to copy and hand to someone with
            write access.
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
                    Rows UPDATE will affect (all scripts): {result.totalPreviewRows}
                  </span>
                )}
              </div>

              {result.countParityVerified === true && (
                <p className="status ok parity-note">
                  Read-only check passed. Nothing was updated in the database. Each UPDATE script is
                  limited to the same rows as its preview SELECT, and the row counts match live data.
                  SearchMetaInfo only covers rows that will receive a DOB/ID data change. Safe to copy
                  and pass to a colleague with write access.
                </p>
              )}

              {result.ok && result.countParityVerified == null && (
                <p className="hint">
                  Connect to MySQL (read-only is fine) before upload to verify row counts against live
                  data. Without a connection, scripts are still generated but counts are not checked.
                </p>
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

              {renderScriptGroup(
                'Data updates (DOB, ID, individual, policy)',
                DATA_SCRIPT_LABELS,
                dataPreviewTotal,
                dataUpdateScripts,
                dataPreviewScripts,
                activeDataTab,
                setActiveDataTab,
                currentDataScript,
                currentDataPreview,
                'Data UPDATE scripts copied to clipboard.',
                'Data preview SELECTs copied to clipboard.'
              )}

              {renderScriptGroup(
                'SearchMetaInfo audit (data changes only)',
                SEARCHMETA_SCRIPT_LABELS,
                searchMetaPreviewTotal,
                searchMetaUpdateScripts,
                searchMetaPreviewScripts,
                activeSearchMetaTab,
                setActiveSearchMetaTab,
                currentSearchMetaScript,
                currentSearchMetaPreview,
                'SearchMetaInfo UPDATE scripts copied to clipboard.',
                'SearchMetaInfo preview SELECTs copied to clipboard.'
              )}
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

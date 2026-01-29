import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { apiClient } from './api'
import type { EntryDetail, EntrySummary, Health, Settings } from './types'
import './App.css'

type Capture = {
  blob: Blob
  url: string
  source: 'camera' | 'upload' | 'demo'
}

const formatDate = (iso: string) => {
  const date = new Date(iso)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const confidenceLabel = (value?: number | null) => {
  if (value === null || value === undefined) return 'Confidence: --'
  return `Confidence: ${Math.round(value * 100)}%`
}

const createDemoSceneBlob = async (): Promise<Blob> => {
  const canvas = document.createElement('canvas')
  canvas.width = 960
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not available')

  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height)
  sky.addColorStop(0, '#bfe8ff')
  sky.addColorStop(0.5, '#fef3c7')
  sky.addColorStop(1, '#c9f2d6')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = '#ffd166'
  ctx.beginPath()
  ctx.arc(canvas.width * 0.78, canvas.height * 0.18, 70, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#8ad29f'
  ctx.beginPath()
  ctx.moveTo(0, canvas.height * 0.65)
  ctx.quadraticCurveTo(canvas.width * 0.3, canvas.height * 0.42, canvas.width * 0.6, canvas.height * 0.62)
  ctx.quadraticCurveTo(canvas.width * 0.8, canvas.height * 0.75, canvas.width, canvas.height * 0.6)
  ctx.lineTo(canvas.width, canvas.height)
  ctx.lineTo(0, canvas.height)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#6bb6ff'
  ctx.beginPath()
  ctx.moveTo(canvas.width * 0.12, canvas.height)
  ctx.quadraticCurveTo(canvas.width * 0.45, canvas.height * 0.7, canvas.width * 0.88, canvas.height)
  ctx.lineTo(canvas.width, canvas.height)
  ctx.lineTo(0, canvas.height)
  ctx.closePath()
  ctx.fill()

  for (let i = 0; i < 6; i += 1) {
    const x = canvas.width * 0.12 + i * 140
    const y = canvas.height * 0.55 + (i % 2) * 20
    ctx.fillStyle = '#3a8f5b'
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x - 40, y + 80)
    ctx.lineTo(x + 40, y + 80)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#2f6c45'
    ctx.fillRect(x - 8, y + 80, 16, 30)
  }

  for (let i = 0; i < 40; i += 1) {
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.6})`
    ctx.beginPath()
    ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height * 0.5, 2 + Math.random() * 3, 0, Math.PI * 2)
    ctx.fill()
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Failed to create demo blob'))
      }
    }, 'image/jpeg', 0.9)
  })
}

function App() {
  const [mode, setMode] = useState<'scan' | 'collection'>('scan')
  const [entries, setEntries] = useState<EntrySummary[]>([])
  const [selectedEntry, setSelectedEntry] = useState<EntryDetail | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [status, setStatus] = useState('')
  const [capture, setCapture] = useState<Capture | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [shareEntry, setShareEntry] = useState<EntryDetail | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [publicMode, setPublicMode] = useState(false)
  const [publicEntries, setPublicEntries] = useState<EntrySummary[]>([])
  const [publicError, setPublicError] = useState<string | null>(null)
  const [celebrate, setCelebrate] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const celebrateTimer = useRef<number | null>(null)

  useEffect(() => {
    const path = window.location.pathname
    if (path.startsWith('/share/')) {
      const token = path.replace('/share/', '').split('/')[0]
      if (token) {
        setShareToken(token)
      }
      return
    }
    if (path.startsWith('/public')) {
      setPublicMode(true)
    }
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [healthData, settingsData, entriesData] = await Promise.all([
          apiClient.health(),
          apiClient.getSettings(),
          apiClient.listEntries(),
        ])
        if (!active) return
        setHealth(healthData)
        setSettings(settingsData)
        setEntries(entriesData)
      } catch (err) {
        if (!active) return
        setStatus('Could not reach the backend. Start the Rust server on :4000.')
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!shareToken) return
    let active = true
    const loadShare = async () => {
      try {
        const entry = await apiClient.getSharedEntry(shareToken)
        if (active) setShareEntry(entry)
      } catch (err) {
        if (active) setShareError('Share link not found or expired.')
      }
    }
    loadShare()
    return () => {
      active = false
    }
  }, [shareToken])

  useEffect(() => {
    if (!publicMode) return
    let active = true
    const loadPublic = async () => {
      try {
        const data = await apiClient.listPublicEntries()
        if (active) setPublicEntries(data)
      } catch (err) {
        if (active) setPublicError('This dex is private right now.')
      }
    }
    loadPublic()
    return () => {
      active = false
    }
  }, [publicMode])

  useEffect(() => {
    return () => {
      if (capture?.url) URL.revokeObjectURL(capture.url)
    }
  }, [capture])

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraOn(false)
  }

  useEffect(() => {
    return () => stopCamera()
  }, [])

  useEffect(() => {
    return () => {
      if (celebrateTimer.current) {
        window.clearTimeout(celebrateTimer.current)
      }
    }
  }, [])

  const startCamera = async () => {
    setStatus('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraOn(true)
      setCapture(null)
    } catch (err) {
      setStatus('Camera access denied. Try Upload or Demo Scan instead.')
      setCameraOn(false)
    }
  }

  const capturePhoto = async () => {
    if (!videoRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current ?? document.createElement('canvas')
    canvas.width = video.videoWidth || 960
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((data) => resolve(data), 'image/jpeg', 0.9)
    })
    if (!blob) return

    stopCamera()
    setCapture({ blob, url: URL.createObjectURL(blob), source: 'camera' })
  }

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setCapture({ blob: file, url: URL.createObjectURL(file), source: 'upload' })
  }

  const handleDemo = async () => {
    setStatus('')
    try {
      const blob = await createDemoSceneBlob()
      setCapture({ blob, url: URL.createObjectURL(blob), source: 'demo' })
    } catch (err) {
      setStatus('Demo scene failed to render.')
    }
  }

  const analyzeCapture = async () => {
    if (!capture) return
    setIsAnalyzing(true)
    setStatus('Sending to Claude Opus 4.5...')
    try {
      const formData = new FormData()
      formData.append('image', capture.blob, 'nature.jpg')
      const data = await apiClient.createEntry(formData)
      setSelectedEntry(data.entry)
      setEntries((prev) => [data.entry, ...prev])
      setMode('scan')
      setStatus('Dex entry captured!')
      setCelebrate(true)
      if (celebrateTimer.current) {
        window.clearTimeout(celebrateTimer.current)
      }
      celebrateTimer.current = window.setTimeout(() => {
        setCelebrate(false)
      }, 1400)
    } catch (err) {
      setStatus('Classification failed. Check your Anthropic key and backend logs.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const refreshEntries = async () => {
    try {
      const data = await apiClient.listEntries()
      setEntries(data)
    } catch (err) {
      setStatus('Could not refresh the collection.')
    }
  }

  const selectEntry = async (entry: EntrySummary) => {
    try {
      const detail = await apiClient.getEntry(entry.id)
      setSelectedEntry(detail)
      setMode('collection')
    } catch (err) {
      setStatus('Could not load entry details.')
    }
  }

  const toggleShare = async () => {
    if (!selectedEntry) return
    try {
      const updated = await apiClient.toggleShare(selectedEntry.id, !selectedEntry.shared)
      setSelectedEntry(updated)
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === updated.id ? { ...entry, shared: updated.shared } : entry,
        ),
      )
    } catch (err) {
      setStatus('Share update failed.')
    }
  }

  const togglePublic = async () => {
    if (!settings) return
    const previous = settings
    const next = { is_public: !settings.is_public }
    setSettings(next)
    try {
      await apiClient.updateSettings(next)
    } catch (err) {
      setSettings(previous)
      setStatus('Failed to update dex visibility.')
    }
  }

  const handleCopyShare = async () => {
    if (!selectedEntry?.share_url) return
    const shareLink = `${window.location.origin}${selectedEntry.share_url}`
    try {
      await navigator.clipboard.writeText(shareLink)
      setStatus('Share link copied to clipboard!')
    } catch (err) {
      setStatus('Copy failed. You can still highlight and copy the link.')
    }
  }

  const handleCopyPublic = async () => {
    const link = `${window.location.origin}/public`
    try {
      await navigator.clipboard.writeText(link)
      setStatus('Public link copied!')
    } catch (err) {
      setStatus('Copy failed. You can copy the public link manually.')
    }
  }

  const entryCountLabel = useMemo(() => {
    if (entries.length === 0) return 'No entries yet'
    if (entries.length === 1) return '1 entry'
    return `${entries.length} entries`
  }, [entries.length])

  if (shareToken) {
    return (
      <div className="share-page">
        <div className="share-card">
          <div className="share-header">
            <div className="logo">NaturaDex</div>
            <span className="badge soft">Shared Field Note</span>
          </div>
          {shareEntry ? (
            <div className="share-body">
              <img className="share-image" src={shareEntry.image_url} alt={shareEntry.label} />
              <div className="share-info">
                <h1>{shareEntry.label}</h1>
                <p>{shareEntry.description}</p>
                <div className="tag-row">
                  {shareEntry.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="meta-line">{confidenceLabel(shareEntry.confidence)}</div>
              </div>
            </div>
          ) : (
            <div className="share-body">
              <p>{shareError ?? 'Loading shared entry...'}</p>
            </div>
          )}
          <button className="btn ghost" onClick={() => (window.location.href = '/')}>
            Back to NaturaDex
          </button>
        </div>
      </div>
    )
  }

  if (publicMode) {
    return (
      <div className="share-page">
        <div className="share-card">
          <div className="share-header">
            <div className="logo">NaturaDex</div>
            <span className="badge soft">Public Collection</span>
          </div>
          {publicEntries.length > 0 ? (
            <div className="public-grid">
              {publicEntries.map((entry, index) => (
                <div key={entry.id} className="public-card">
                  <img src={entry.image_url} alt={entry.label} />
                  <div className="public-info" style={{ ['--delay' as string]: `${index * 60}ms` }}>
                    <h3>{entry.label}</h3>
                    <p>{entry.description}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="share-body">
              <p>{publicError ?? 'Loading public collection...'}</p>
            </div>
          )}
          <button className="btn ghost" onClick={() => (window.location.href = '/')}>
            Back to NaturaDex
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`app ${celebrate ? 'celebrate' : ''}`}>
      <div className="sparkle-field" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className="confetti-field" aria-hidden>
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <header className="topbar">
        <div className="logo">
          NaturaDex <span className="logo-sub">field edition</span>
        </div>
        <div className="status-pill">
          <span className="dot" />
          {health ? `${health.model}` : 'Connecting...'}
        </div>
        <div className="mode-switch">
          <button
            className={`chip ${mode === 'scan' ? 'active' : ''}`}
            onClick={() => setMode('scan')}
          >
            Scan
          </button>
          <button
            className={`chip ${mode === 'collection' ? 'active' : ''}`}
            onClick={() => setMode('collection')}
          >
            Collection
          </button>
        </div>
        <div className="dex-toggle">
          <span>Dex is {settings?.is_public ? 'Public' : 'Private'}</span>
          <button
            className={`toggle ${settings?.is_public ? 'on' : ''}`}
            onClick={togglePublic}
            aria-label="Toggle dex visibility"
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </header>

      <main className="layout">
        <section className={`scan-zone ${mode === 'collection' ? 'muted' : ''}`}>
          <div className="hero-card float">
            <div className="hero-badges">
              <span className="badge">Cute + clever</span>
              <span className="badge soft">No copyright vibes</span>
            </div>
            <h1>Snap a scene. Meet its nature spirit.</h1>
            <p>
              NaturaDex turns your photos into a playful field entry with tags, lore, and shareable
              snapshots. Designed for quick discovery and cozy collecting.
            </p>
            <div className="cta-row">
              <button className="btn primary" onClick={startCamera}>
                Open Camera
              </button>
              <button className="btn ghost" onClick={handleDemo}>
                Demo Scan
              </button>
            </div>
            <div className="cta-row">
              <button className="btn outline" onClick={() => fileInputRef.current?.click()}>
                Upload Image
              </button>
              <button className="btn outline" onClick={() => setMode('collection')}>
                View Collection
              </button>
            </div>
            <div className="hero-foot">
              <span>Auto-tagged entries</span>
              <span>Shareable link</span>
              <span>Soft delete + restore</span>
            </div>
            <div className="mascot" aria-hidden>
              <div className="mascot-eye" />
              <div className="mascot-eye" />
              <div className="mascot-blush" />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
            />
          </div>

          <div className="camera-card">
            <div className={`camera-frame ${cameraOn ? 'active' : ''} ${isAnalyzing ? 'scanning' : ''}`}>
              {capture ? (
                <img src={capture.url} alt="Captured nature" />
              ) : cameraOn ? (
                <video ref={videoRef} playsInline muted />
              ) : (
                <div className="camera-placeholder">
                  <div className="lens" />
                  <div className="lens-glint" />
                  <p>Camera ready. Choose a scene to begin.</p>
                </div>
              )}
              <div className="scan-overlay" aria-hidden />
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="camera-actions">
              {!cameraOn && !capture && (
                <button className="btn primary" onClick={startCamera}>
                  Start Camera
                </button>
              )}
              {cameraOn && !capture && (
                <button className="btn primary" onClick={capturePhoto}>
                  Snap
                </button>
              )}
              {cameraOn && (
                <button className="btn ghost" onClick={stopCamera}>
                  Close
                </button>
              )}
              {capture && (
                <button className={`btn primary ${!isAnalyzing ? 'pulse' : ''}`} disabled={isAnalyzing} onClick={analyzeCapture}>
                  {isAnalyzing ? 'Analyzing...' : 'Analyze Scene'}
                </button>
              )}
              {capture && (
                <button className="btn outline" onClick={() => setCapture(null)}>
                  Retake
                </button>
              )}
            </div>
          </div>

          {selectedEntry && (
            <div className="result-card">
              <div className="result-media">
                <img src={selectedEntry.image_url} alt={selectedEntry.label} />
              </div>
              <div className="result-info">
                <div className="result-head">
                  <h2>{selectedEntry.label}</h2>
                  <span className="meta-line">{confidenceLabel(selectedEntry.confidence)}</span>
                </div>
                <p>{selectedEntry.description}</p>
                <div className="tag-row">
                  {selectedEntry.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="result-actions">
                  <button className="btn ghost" onClick={toggleShare}>
                    {selectedEntry.shared ? 'Disable Share' : 'Share Entry'}
                  </button>
                  <button className="btn outline" onClick={() => setCapture(null)}>
                    Take Another
                  </button>
                  <button className="btn outline" onClick={() => setMode('collection')}>
                    View Collection
                  </button>
                </div>
                {selectedEntry.share_url && (
                  <div className="share-line">
                    <span>Share link:</span>
                    <button className="link-chip" onClick={handleCopyShare}>
                      Copy
                    </button>
                    <span className="share-url">
                      {window.location.origin}
                      {selectedEntry.share_url}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className={`collection-zone ${mode === 'collection' ? 'active' : ''}`}>
          <div className="collection-head">
            <div>
              <h2>Field Collection</h2>
              <p>{entryCountLabel}</p>
            </div>
            <button className="btn ghost" onClick={refreshEntries}>
              Refresh
            </button>
          </div>
          <div className="collection-grid">
            {entries.map((entry, index) => (
              <button
                key={entry.id}
                className={`entry-card ${selectedEntry?.id === entry.id ? 'active' : ''}`}
                onClick={() => selectEntry(entry)}
                style={{ ['--delay' as string]: `${index * 60}ms` }}
              >
                <img src={entry.image_url} alt={entry.label} loading="lazy" />
                <div className="entry-info">
                  <h3>{entry.label}</h3>
                  <p>{entry.description}</p>
                  <div className="entry-meta">
                    <span>{formatDate(entry.created_at)}</span>
                    {entry.shared && <span className="chip soft">Shared</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {selectedEntry && mode === 'collection' && (
            <div className="detail-panel">
              <div>
                <h3>{selectedEntry.label}</h3>
                <p>{selectedEntry.description}</p>
                <div className="tag-row">
                  {selectedEntry.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="meta-line">{confidenceLabel(selectedEntry.confidence)}</div>
              </div>
              <div className="detail-actions">
                <button className="btn ghost" onClick={toggleShare}>
                  {selectedEntry.shared ? 'Disable Share' : 'Share Entry'}
                </button>
                <button className="btn outline" onClick={() => setMode('scan')}>
                  Back to Scan
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <div className="status-line">{status || 'Ready to explore.'}</div>
        <div className="footer-note">
          Powered by Claude Opus 4.5 · Axum + React
          {settings?.is_public && (
            <button className="link-chip" onClick={handleCopyPublic}>
              Copy Public Link
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}

export default App

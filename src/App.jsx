import './App.css';

function App() {
  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <div className="brand">
          <span className="brand-kole">KOLE</span>
          <span className="brand-connect">CONNECT</span>
        </div>

        <span className="mobile-label">MOBILE</span>
      </header>

      <main className="mobile-content">
        <section className="welcome">
          <p className="eyebrow">Driver Portal</p>
          <h1>Kole Connect Mobile</h1>
          <p>
            Loads, documents and trip information — built for the road.
          </p>
        </section>

        <section className="placeholder-card">
          <span className="placeholder-label">COMING NEXT</span>
          <h2>Driver Sign In</h2>
          <p>
            This device will be connected to a specific driver profile.
          </p>
        </section>
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <button type="button" className="nav-item active">
          <span className="nav-icon">⌂</span>
          <span>Home</span>
        </button>

        <button type="button" className="nav-item">
          <span className="nav-icon">▣</span>
          <span>Load</span>
        </button>

        <button type="button" className="nav-item">
          <span className="nav-icon">↑</span>
          <span>Upload</span>
        </button>

        <button type="button" className="nav-item">
          <span className="nav-icon">●</span>
          <span>Me</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
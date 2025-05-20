import React, { useState, useEffect } from 'react';

function Dashboard() {
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Define a function to fetch the status data
    async function fetchStatus() {
      try {
        const response = await fetch('/status');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        setStatusData(data);
        setError(null); // clear any previous error on success
      } catch (err) {
        console.error('Error fetching /status:', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    // Fetch once immediately, then set up interval polling
    fetchStatus();
    const intervalId = setInterval(fetchStatus, 5000); // poll every 5 seconds

    // Cleanup on component unmount
    return () => clearInterval(intervalId);
  }, []);

  // Derive data fields for convenience (if statusData is not null)
  const balance = statusData?.balance;
  const position = statusData?.position;
  const ethPrice = statusData?.eth_price;
  // Backend exposes indicators as `sma` and `rsi`. The original
  // component expected `sma_5m` and `rsi_1m`, which meant values were
  // always undefined. Align the field names so the dashboard displays
  // the current indicators correctly.
  const sma = statusData?.sma;
  const rsi = statusData?.rsi;
  const lastAction = statusData?.last_action;
  const pastTrades = statusData?.past_trades || [];
  const logs = statusData?.logs || [];

  // Render loading or error states
  if (loading) {
    return <div className="dashboard"><p className="loading">Loading data&hellip;</p></div>;
  }
  // We can show error message alongside data if partial data available
  // but if there's no data at all yet, just show the error
  if (error && !statusData) {
    return <div className="dashboard"><p className="error">Error fetching data. Please try again later.</p></div>;
  }

  return (
    <div className="dashboard">
      {/* Header Section */}
      <h1 className="title"> Bot Trading Dashboard</h1>
      <p className="subtitle">Real-time updates</p>

      {/* Current Stats Cards */}
      <h2 className="section-title">Current Stats</h2>
      <div className="stats-cards">
        <div className="card">
          <span className="card-label">Balance</span>
          <span className="card-value">
            {balance !== undefined ? `$${balance.toFixed(2)}` : '-'}
          </span>
        </div>
        <div className="card">
          <span className="card-label">Position</span>
          <span className="card-value">{position || 'None'}</span>
        </div>
        <div className="card">
          <span className="card-label">ETH Price</span>
          <span className="card-value">
            {ethPrice !== undefined ? `$${ethPrice.toFixed(2)}` : '-'}
          </span>
        </div>
        <div className="card">
          <span className="card-label">SMA (5m)</span>
          <span className="card-value">
            {sma !== undefined ? `$${sma.toFixed(2)}` : '-'}
          </span>
        </div>
        <div className="card">
          <span className="card-label">RSI (1m)</span>
          <span className="card-value">
            {rsi !== undefined ? rsi.toFixed(2) : '-'}
          </span>
        </div>
        <div className="card">
          <span className="card-label">Last Action</span>
          <span className="card-value">{lastAction || 'None'}</span>
        </div>
      </div>

      {/* If there's some additional note when no active trade, we can show it */}
      {position === 'NONE' && (
        <p className="no-active">No Active Trade</p>
      )}

      {/* Past Trades Section */}
      <h2 className="section-title">Past Trades</h2>
      {pastTrades.length > 0 ? (
        <table className="trades-table">
          <thead>
            <tr>
              <th>Side</th>
              <th>Entry Price</th>
              <th>Exit Price</th>
              <th>PnL</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {pastTrades.map((trade, idx) => (
              <tr key={idx}>
                <td>{trade.side}</td>
                <td>${trade.entryPrice?.toFixed(2)}</td>
                <td>${trade.exitPrice?.toFixed(2)}</td>
                <td>{trade.pnl?.toFixed(2)}</td>
                <td>{trade.timestamp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="no-data">No closed trades yet.</p>
      )}

      {/* Bot Logs Section */}
      <h2 className="section-title">Bot Logs</h2>
      <div className="logs-container">
        {logs.length > 0 ? (
          <ul className="logs-list">
            {logs.map((entry, idx) => (
              <li key={idx}>{entry}</li>
            ))}
          </ul>
        ) : (
          <p className="no-data">No log entries available.</p>
        )}
      </div>

      {/* Error message (if an error occurred after data loaded) */}
      {error && statusData && (
        <p className="error">⚠️ Live update failed. Displaying last known data.</p>
      )}

      {/* CSS Styles */}
      <style>{`
        .dashboard {
          min-height: 100vh;
          background: #121212;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }
        .title {
          font-size: 2rem;
          margin: 0 0 0.5rem;
        }
        .subtitle {
          font-size: 1rem;
          color: #bbbbbb;
          margin: 0 0 2rem;
        }
        .section-title {
          font-size: 1.25rem;
          margin: 2rem 0 1rem;
          color: #ffffff;
        }
        .stats-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
        }
        .card {
          background: #1e1e1e;
          padding: 1rem;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .card-label {
          font-size: 0.9rem;
          color: #cccccc;
          margin-bottom: 0.25rem;
          text-transform: uppercase;
        }
        .card-value {
          font-size: 1.4rem;
          font-weight: bold;
          color: #ffffff;
        }
        .no-active {
          font-style: italic;
          color: #888888;
          margin: 0.5rem 0 0;
        }
        .trades-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 1rem;
        }
        .trades-table th, .trades-table td {
          text-align: left;
          padding: 0.5rem 0.75rem;
        }
        .trades-table th {
          background: #1e1e1e;
          color: #cccccc;
          font-weight: 500;
        }
        .trades-table tr:nth-child(even) {
          background: #2a2a2a;
        }
        .trades-table tr:nth-child(odd) {
          background: #242424;
        }
        .trades-table td {
          border-bottom: 1px solid #333333;
        }
        .no-data {
          color: #aaaaaa;
          font-style: italic;
        }
        .logs-container {
          background: #1e1e1e;
          padding: 0.5rem;
          border-radius: 4px;
          max-height: 200px;
          overflow-y: auto;
          margin-bottom: 2rem;
        }
        .logs-list {
          list-style: disc inside;
          padding-left: 1rem;
          margin: 0;
        }
        .logs-list li {
          margin-bottom: 0.25rem;
        }
        .loading {
          color: #cccccc;
          font-size: 1.1rem;
        }
        .error {
          color: #e57373; /* a soft red for errors */
        }
      `}</style>
    </div>
  );
}

export default Dashboard;

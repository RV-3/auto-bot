import { useState, useEffect } from 'react';
import './Dashboard.css'; // Tailwind + any custom overrides

/**
 * parseClosedTrades parses lines like:
 * [12:35:01] TRADE CLOSE LONG @ $2000.00 STOP hit. PNL=50.00, New Balance=1050.00
 * returning an array of objects with {timestamp, side, closePrice, outcomeType, pnl, newBalance}
 */
function parseClosedTrades(logs) {
  const regex = /\[(.*?)\]\s+TRADE CLOSE (LONG|SHORT)\s+@\s+\$(\d+(\.\d+)?)\s+(STOP|TP)\s+hit\.\s+PNL=(\d+(\.\d+)?),\s+New Balance=(\d+(\.\d+)?)/;
  return logs
    .filter((line) => line.includes("TRADE CLOSE"))
    .map((line) => {
      const match = line.match(regex);
      if (!match) {
        // If format doesn't match exactly, store the raw line
        return { raw: line };
      }
      const [
        full,
        timestamp,
        side,
        closePrice,
        _decClose,
        outcomeType, // "STOP" or "TP"
        pnl,
        _decPnl,
        newBalance
      ] = match;
      return {
        timestamp,
        side,
        closePrice: parseFloat(closePrice),
        outcomeType,
        pnl: parseFloat(pnl),
        newBalance: parseFloat(newBalance),
      };
    });
}

export default function Dashboard() {
  const [statusData, setStatusData] = useState(null);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        // If you have a Vite proxy:
        //   fetch("/status");
        // If not:
        //   fetch("http://localhost:8080/status");
        const res = await fetch("/status");
        if (!res.ok) {
          throw new Error(`Fetch failed with status ${res.status}`);
        }
        const json = await res.json();
        console.log("Fetched data:", json); // << LOG EVERY FETCH RESULT
        setStatusData(json);
        setFetchError(null);
      } catch (err) {
        console.error("Failed to fetch /status:", err);
        setFetchError(err.message || "Unknown fetch error");
      }
    };
    fetchStatus();
    const intervalId = setInterval(fetchStatus, 5000); // poll every 5s
    return () => clearInterval(intervalId);
  }, []);

  if (fetchError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <p>Error fetching /status: {fetchError}</p>
      </div>
    );
  }

  if (!statusData) {
    // still loading or no data
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <p>Loading dashboard...</p>
      </div>
    );
  }

  // Determine if a position is active
  const positionActive = statusData.position && statusData.position !== "NONE";
  // Parse any closed trade logs
  const closedTrades = parseClosedTrades(statusData.logs || []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white p-8">
      {/* Header */}
      <header className="max-w-5xl mx-auto mb-8 text-center">
        <h1 className="text-4xl font-bold mb-2 tracking-wide">
          🧠 GMX Trading Bot Dashboard
        </h1>
        <p className="text-gray-300">High-Frequency Strategy Monitoring</p>
      </header>

      {/* Current Stats */}
      <section className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 uppercase tracking-wide">Current Stats</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
          <div className="bg-gray-800 p-4 rounded shadow hover:shadow-md transition">
            <p className="text-sm text-gray-400">Balance</p>
            <p className="text-xl font-semibold">${statusData.balance.toFixed(2)}</p>
          </div>

          <div className="bg-gray-800 p-4 rounded shadow hover:shadow-md transition">
            <p className="text-sm text-gray-400">Position</p>
            <p className="text-xl font-semibold">{statusData.position}</p>
          </div>

          <div className="bg-gray-800 p-4 rounded shadow hover:shadow-md transition">
            <p className="text-sm text-gray-400">ETH Price</p>
            <p className="text-xl font-semibold">${statusData.eth_price.toFixed(2)}</p>
          </div>

          <div className="bg-gray-800 p-4 rounded shadow hover:shadow-md transition">
            <p className="text-sm text-gray-400">SMA (5m)</p>
            <p className="text-xl font-semibold">${statusData.sma.toFixed(2)}</p>
          </div>

          <div className="bg-gray-800 p-4 rounded shadow hover:shadow-md transition">
            <p className="text-sm text-gray-400">RSI (1m)</p>
            <p className="text-xl font-semibold">{statusData.rsi.toFixed(2)}</p>
          </div>

          <div className="bg-gray-800 p-4 rounded shadow hover:shadow-md transition">
            <p className="text-sm text-gray-400">Last Action</p>
            <p className="text-xl font-semibold">{statusData.last_action}</p>
          </div>
        </div>

        {/* Active/Inactive Position Label */}
        <div className="mt-6 text-center">
          {positionActive ? (
            <div className="inline-block bg-green-600 text-white px-4 py-2 rounded shadow font-bold">
              Position Active: {statusData.position.toUpperCase()}
            </div>
          ) : (
            <div className="inline-block bg-red-600 text-white px-4 py-2 rounded shadow font-bold">
              No Active Position
            </div>
          )}
        </div>
      </section>

      {/* Past Trades */}
      <section className="max-w-5xl mx-auto mt-12">
        <h2 className="text-2xl font-bold mb-4 uppercase tracking-wide">Past Trades</h2>
        <div className="bg-gray-800 p-4 rounded shadow-sm border border-gray-700 overflow-auto">
          {closedTrades.length === 0 ? (
            <p className="text-gray-400">No closed trades yet.</p>
          ) : (
            <table className="w-full text-left text-sm text-gray-300">
              <thead>
                <tr className="border-b border-gray-600 bg-gray-700">
                  <th className="py-2 px-3 uppercase font-medium text-gray-200">Time</th>
                  <th className="py-2 px-3 uppercase font-medium text-gray-200">Side</th>
                  <th className="py-2 px-3 uppercase font-medium text-gray-200">Close Price</th>
                  <th className="py-2 px-3 uppercase font-medium text-gray-200">Outcome</th>
                  <th className="py-2 px-3 uppercase font-medium text-gray-200">PNL</th>
                  <th className="py-2 px-3 uppercase font-medium text-gray-200">New Balance</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map((trade, i) => {
                  if (!trade.timestamp) {
                    // parse fail
                    return (
                      <tr key={i} className="border-b border-gray-700">
                        <td colSpan={6} className="py-2 px-3 text-red-400">
                          Could not parse: {trade.raw}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr
                      key={i}
                      className="border-b border-gray-700 hover:bg-gray-700/25 transition-colors"
                    >
                      <td className="py-2 px-3">{trade.timestamp}</td>
                      <td className="py-2 px-3">{trade.side}</td>
                      <td className="py-2 px-3">${trade.closePrice.toFixed(2)}</td>
                      <td className="py-2 px-3">{trade.outcomeType}</td>
                      <td
                        className={
                          trade.pnl >= 0 ? "py-2 px-3 text-green-400" : "py-2 px-3 text-red-400"
                        }
                      >
                        {trade.pnl.toFixed(2)}
                      </td>
                      <td className="py-2 px-3">${trade.newBalance.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Bot Logs */}
      <section className="max-w-5xl mx-auto mt-12">
        <h2 className="text-2xl font-bold mb-4 uppercase tracking-wide">Bot Logs</h2>
        <div className="bg-gray-800 p-4 rounded shadow-sm border border-gray-700 max-h-64 overflow-y-auto">
          {statusData.logs && statusData.logs.length > 0 ? (
            <ul className="space-y-1 text-sm font-mono text-gray-300">
              {statusData.logs.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400">No logs yet.</p>
          )}
        </div>
      </section>

      {/* Debug Info: raw JSON */}
      <section className="max-w-5xl mx-auto mt-12">
        <h2 className="text-2xl font-bold mb-4 uppercase tracking-wide">Debug Info</h2>
        <div className="bg-gray-800 p-4 rounded shadow-sm border border-gray-700 overflow-auto text-sm text-gray-200 font-mono">
          <pre>{JSON.stringify(statusData, null, 2)}</pre>
        </div>
      </section>
    </main>
  );
}

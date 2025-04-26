import { useEffect, useState } from "react";

// A helper to parse "TRADE CLOSE" lines into objects
function parseClosedTrades(logs) {
  const tradeCloseRegex = /\[(.*?)\]\s+TRADE CLOSE (LONG|SHORT)\s+@\s+\$(\d+(\.\d+)?)\s+(STOP|TP)\s+hit\.\s+PNL=(\d+(\.\d+)?),\s+New Balance=(\d+(\.\d+)?)/;

  const parsed = logs
    .filter((line) => line.includes("TRADE CLOSE"))
    .map((line) => {
      const match = line.match(tradeCloseRegex);
      if (!match) return { raw: line };
      const [
        full,
        timestamp,
        side,
        closePrice,
        _dec1,
        outcomeType, // 'STOP' or 'TP'
        pnl,
        _dec2,
        newBalance
      ] = match;

      return {
        timestamp,
        side,
        closePrice: Number(closePrice),
        outcomeType,
        pnl: Number(pnl),
        newBalance: Number(newBalance),
      };
    });

  return parsed;
}

export default function Dashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/status");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch status:", err);
    }
  };

  if (!data) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white flex flex-col items-center justify-center font-sans">
        <h1 className="text-4xl mb-4 font-bold">🧠 GMX Trading Bot Dashboard</h1>
        <p className="text-gray-300">Loading status...</p>
      </main>
    );
  }

  // tradeIsOn if position !== 'NONE'
  const tradeIsOn = data.position && data.position !== "NONE";

  // parse the "TRADE CLOSE" lines for a table
  let tradeHistory = parseClosedTrades(data.logs || []);

  // (Optional) add a sample row if real trades are empty
  if (tradeHistory.length === 0) {
    tradeHistory = [
      {
        timestamp: "12:00:00",
        side: "LONG",
        closePrice: 1800.45,
        outcomeType: "TP",
        pnl: 50.0,
        newBalance: 10050.0,
        isDummy: true, // mark so we can show a note
      },
    ];
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white p-8 font-sans">
      {/* Header */}
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-2 tracking-wide">
          🧠 GMX Trading Bot Dashboard
        </h1>
        <p className="text-gray-300">
          Real-time updates on your paper trading strategy
        </p>
      </header>

      {/* Stats + Current Trade */}
      <section className="max-w-5xl mx-auto mb-8">
        <h2 className="text-2xl font-bold mb-6 uppercase tracking-wide">
          Current Stats
        </h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {/* Balance */}
          <div className="bg-gray-800 p-4 rounded-xl shadow hover:shadow-lg transition-transform transform hover:scale-105">
            <p className="text-sm text-gray-400 uppercase tracking-wider">Balance</p>
            <p className="text-3xl font-semibold">${data.balance.toFixed(2)}</p>
          </div>

          {/* Position */}
          <div className="bg-gray-800 p-4 rounded-xl shadow hover:shadow-lg transition-transform transform hover:scale-105">
            <p className="text-sm text-gray-400 uppercase tracking-wider">Position</p>
            <p className="text-3xl font-semibold">{data.position}</p>
          </div>

          {/* ETH Price */}
          <div className="bg-gray-800 p-4 rounded-xl shadow hover:shadow-lg transition-transform transform hover:scale-105">
            <p className="text-sm text-gray-400 uppercase tracking-wider">ETH Price</p>
            <p className="text-3xl font-semibold">${data.eth_price.toFixed(2)}</p>
          </div>

          {/* SMA */}
          <div className="bg-gray-800 p-4 rounded-xl shadow hover:shadow-lg transition-transform transform hover:scale-105">
            <p className="text-sm text-gray-400 uppercase tracking-wider">SMA (5m)</p>
            <p className="text-3xl font-semibold">${data.sma.toFixed(2)}</p>
          </div>

          {/* RSI */}
          <div className="bg-gray-800 p-4 rounded-xl shadow hover:shadow-lg transition-transform transform hover:scale-105">
            <p className="text-sm text-gray-400 uppercase tracking-wider">RSI (1m)</p>
            <p className="text-3xl font-semibold">{data.rsi.toFixed(2)}</p>
          </div>

          {/* Last Action */}
          <div className="bg-gray-800 p-4 rounded-xl shadow hover:shadow-lg transition-transform transform hover:scale-105">
            <p className="text-sm text-gray-400 uppercase tracking-wider">Last Action</p>
            <p className="text-3xl font-semibold">{data.last_action}</p>
          </div>
        </div>

        {/* Is a Trade ON? */}
        <div className="mt-6 text-center">
          {tradeIsOn ? (
            <div className="inline-block bg-green-600 text-white px-4 py-2 rounded-lg shadow">
              <span className="font-bold">Trade is ON</span>
            </div>
          ) : (
            <div className="inline-block bg-red-600 text-white px-4 py-2 rounded-lg shadow">
              <span className="font-bold">No Active Trade</span>
            </div>
          )}
        </div>
      </section>

      {/* Bot Logs */}
      <section className="max-w-5xl mx-auto mb-8">
        <h2 className="text-2xl font-bold mb-4 uppercase tracking-wide">Bot Logs</h2>
        <div className="bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-700 max-h-64 overflow-y-auto">
          {data.logs && data.logs.length > 0 ? (
            <ul className="space-y-1">
              {data.logs.map((line, i) => (
                <li key={i} className="text-sm text-gray-300">
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400">No logs yet.</p>
          )}
        </div>
      </section>

      {/* Trade History (parsed from logs, with a demo row if empty) */}
      <section className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold mb-4 uppercase tracking-wide">
          Trade History
        </h2>
        <div className="bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-700 overflow-auto">
          <table className="w-full text-left text-sm text-gray-300">
            <thead>
              <tr className="border-b border-gray-600">
                <th className="py-2 px-3 uppercase">Timestamp</th>
                <th className="py-2 px-3 uppercase">Side</th>
                <th className="py-2 px-3 uppercase">Close Price</th>
                <th className="py-2 px-3 uppercase">Outcome</th>
                <th className="py-2 px-3 uppercase">PNL</th>
                <th className="py-2 px-3 uppercase">New Balance</th>
              </tr>
            </thead>
            <tbody>
              {tradeHistory.map((trade, idx) => {
                // if we have no parse result
                if (!trade.timestamp) {
                  return (
                    <tr key={idx} className="border-b border-gray-700">
                      <td colSpan={6} className="py-2 px-3 text-red-400">
                        Could not parse: {trade.raw}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={idx}
                    className="border-b border-gray-700 hover:bg-gray-700/20 transition"
                  >
                    <td className="py-2 px-3 whitespace-nowrap">
                      {trade.timestamp}
                    </td>
                    <td className="py-2 px-3">{trade.side}</td>
                    <td className="py-2 px-3">
                      ${trade.closePrice.toFixed(2)}
                    </td>
                    <td className="py-2 px-3">{trade.outcomeType}</td>
                    <td
                      className={
                        trade.pnl >= 0
                          ? "py-2 px-3 text-green-400"
                          : "py-2 px-3 text-red-400"
                      }
                    >
                      {trade.pnl.toFixed(2)}
                    </td>
                    <td className="py-2 px-3">
                      ${trade.newBalance.toFixed(2)}
                      {trade.isDummy && (
                        <span className="text-xs text-gray-500 ml-2">
                          (sample)
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

#!/usr/bin/env python3
"""
Example Python Trading Bot.

- Fetches ETH candlestick data from Binance public API.
- Calculates a simple multi-timeframe strategy:
  * 1-hour SMA (trend filter).
  * 5-minute RSI (entry signals).
- Paper trades by default.
- Shows how you could later plug in web3.py calls to interact with GMX for real on-chain trades.
"""

import time
import requests
import pandas as pd
import numpy as np
import ta  # pip install ta
from datetime import datetime

# ------------------------------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------------------------------

# Binance endpoint for candlestick data:
# e.g. GET https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=5m&limit=200
BINANCE_API_BASE = "https://api.binance.com"

# Trading symbol on Binance
# We'll fetch ETH/USDT candles (since USDT is the most liquid pair).
# That price is near-identical to ETH/USD on GMX.
BINANCE_SYMBOL = "ETHUSDT"

# Timeframes: 5m and 1h (Binance intervals are "1m", "3m", "5m", "15m", "30m",
# "1h", "2h", "4h", "6h", "8h", "12h", "1d", etc.)
SHORT_TIMEFRAME = "5m"
MEDIUM_TIMEFRAME = "1h"

SHORT_CANDLE_LIMIT = 200
MEDIUM_CANDLE_LIMIT = 200

# Basic strategy thresholds
RSI_OVERSOLD = 40
RSI_OVERBOUGHT = 60
SMA_PERIOD = 20  # for medium timeframe trend filter
RSI_PERIOD = 14  # for short timeframe

# Paper trading config
STARTING_BALANCE = 10000.00  # $10k hypothetical
RISK_PER_TRADE_PCT = 1.0     # risk 1% of balance per trade

# Sleep interval between loops (in seconds)
LOOP_INTERVAL = 60

# ------------------------------------------------------------------------------------
# HELPER FUNCTIONS
# ------------------------------------------------------------------------------------

def fetch_binance_candles(symbol, interval, limit=200):
    """
    Fetch candlestick data (OHLCV) from Binance public API.
    Endpoint:
      GET /api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}
    Returns a DataFrame with columns:
      timestamp, open, high, low, close, volume
    """
    url = f"{BINANCE_API_BASE}/api/v3/klines"
    params = {
        "symbol": symbol,
        "interval": interval,
        "limit": limit
    }
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        # data is a list of lists like:
        # [
        #   [
        #     1499040000000,      // Open time
        #     "0.01634790",       // Open
        #     "0.80000000",       // High
        #     "0.01575800",       // Low
        #     "0.01577100",       // Close
        #     "148976.11427815",  // Volume
        #     1499644799999,      // Close time
        #     "2434.19055334",    // Quote asset volume
        #     308,                // Number of trades
        #     "1756.87402397",    // Taker buy base asset volume
        #     "28.46694368",      // Taker buy quote asset volume
        #     "17928899.62484339" // Ignore (deprecated)
        #   ],
        #   ...
        # ]

        # We only need: open_time, open, high, low, close, volume
        # open_time is [0], open= [1], high= [2], low= [3], close= [4], volume= [5]
        # We'll also keep close_time [6] if you want, but it's optional.

        df_list = []
        for kline in data:
            df_list.append({
                "timestamp": kline[0],      # open_time in ms
                "open": float(kline[1]),
                "high": float(kline[2]),
                "low": float(kline[3]),
                "close": float(kline[4]),
                "volume": float(kline[5])
            })

        df = pd.DataFrame(df_list)
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
        df.sort_values("timestamp", inplace=True, ascending=True)
        df.reset_index(drop=True, inplace=True)
        return df

    except Exception as e:
        print(f"[!] Error fetching candles for {symbol} {interval}: {e}")
        return pd.DataFrame()


def compute_indicators(df, sma_period=50, rsi_period=14):
    """
    Given a DataFrame with columns [open, high, low, close, volume],
    compute a Simple Moving Average (SMA) and RSI. Return them as new columns.
    """
    if df.empty:
        return df

    df = df.rename(columns={
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume"
    })

    # Simple Moving Average
    df["SMA"] = ta.trend.SMAIndicator(df["Close"], window=sma_period).sma_indicator()

    # RSI
    df["RSI"] = ta.momentum.RSIIndicator(df["Close"], window=rsi_period).rsi()

    return df


# ------------------------------------------------------------------------------------
# PAPER TRADING BOT
# ------------------------------------------------------------------------------------

class PaperTradingBot:
    def __init__(self, starting_balance=10000.0, risk_pct=1.0):
        self.balance = starting_balance
        self.risk_pct = risk_pct
        self.position_active = False
        self.position_side = None
        self.entry_price = 0.0
        self.position_size = 0.0
        self.stop_loss = 0.0
        self.take_profit = 0.0

    def calculate_position_size(self, stop_distance):
        """
        For demonstration: use simple risk-based sizing (1% of balance).
        If stop_distance is the distance from entry to stop in $,
        position_size = (balance * risk_pct) / stop_distance.
        """
        risk_amount = self.balance * (self.risk_pct / 100.0)
        if stop_distance <= 0:
            return 0
        size = risk_amount / stop_distance
        return round(size, 4)

    def open_position(self, side, entry_price, stop_loss, take_profit):
        if self.position_active:
            print("[!] Already in a position, cannot open a new one.")
            return

        self.position_active = True
        self.position_side = side
        self.entry_price = entry_price
        self.stop_loss = stop_loss
        self.take_profit = take_profit

        stop_dist = abs(entry_price - stop_loss)
        self.position_size = self.calculate_position_size(stop_dist)

        print(f"[TRADE OPEN] {side.upper()} @ ${entry_price:.2f}, "
              f"Stop={stop_loss:.2f}, TP={take_profit:.2f}, Size={self.position_size}")

    def check_exit(self, current_price):
        if not self.position_active:
            return

        if self.position_side == "long":
            if current_price <= self.stop_loss:
                self.close_position(current_price, hit_stop=True)
            elif current_price >= self.take_profit:
                self.close_position(current_price, hit_stop=False)

        elif self.position_side == "short":
            if current_price >= self.stop_loss:
                self.close_position(current_price, hit_stop=True)
            elif current_price <= self.take_profit:
                self.close_position(current_price, hit_stop=False)

    def close_position(self, close_price, hit_stop=False):
        if not self.position_active:
            return

        if self.position_side == "long":
            profit = (close_price - self.entry_price) * self.position_size
        else:
            profit = (self.entry_price - close_price) * self.position_size

        self.balance += profit
        print(f"[TRADE CLOSE] {self.position_side.upper()} @ ${close_price:.2f} "
              f"{'STOP' if hit_stop else 'TP'} hit. PNL={profit:.2f}, "
              f"New Balance={self.balance:.2f}")

        # Reset
        self.position_active = False
        self.position_side = None
        self.entry_price = 0.0
        self.position_size = 0.0
        self.stop_loss = 0.0
        self.take_profit = 0.0


def strategy_decision(df_med, df_short, bot: PaperTradingBot):
    """
    Check 1-hour SMA trend, then 5-minute RSI for signals.
    Return "BUY"/"SELL"/"NONE" if a new trade is signaled.
    """
    if df_med.empty or df_short.empty:
        return "NONE"

    last_med = df_med.iloc[-1]
    sma_value = last_med["SMA"]
    current_price_med = last_med["Close"]

    if pd.isna(sma_value):
        return "NONE"

    # If price above SMA => uptrend; else downtrend
    medium_trend = "UP" if current_price_med > sma_value else "DOWN"

    last_short = df_short.iloc[-1]
    rsi_value = last_short["RSI"]
    current_price_short = last_short["Close"]

    if pd.isna(rsi_value):
        return "NONE"

    if bot.position_active:
        return "NONE"

    # Simple approach: uptrend + RSI < 30 => buy, downtrend + RSI > 70 => sell
    if medium_trend == "UP" and rsi_value < RSI_OVERSOLD:
        print(f"Signal: BUY (Uptrend + RSI oversold={rsi_value:.2f})")
        return "BUY"
    elif medium_trend == "DOWN" and rsi_value > RSI_OVERBOUGHT:
        print(f"Signal: SELL (Downtrend + RSI overbought={rsi_value:.2f})")
        return "SELL"

    return "NONE"


def main_loop():
    bot = PaperTradingBot(STARTING_BALANCE, RISK_PER_TRADE_PCT)
    print("----- PYTHON BOT STARTED (PAPER TRADING, BINANCE DATA) -----")
    print(f"Starting Balance: ${bot.balance:.2f}")

    while True:
        print("\n[+] Fetching candle data... ", datetime.utcnow().isoformat())
        # 1) Fetch 1-hour and 5-minute candles from Binance
        df_med = fetch_binance_candles(BINANCE_SYMBOL, MEDIUM_TIMEFRAME, limit=MEDIUM_CANDLE_LIMIT)
        df_short = fetch_binance_candles(BINANCE_SYMBOL, SHORT_TIMEFRAME, limit=SHORT_CANDLE_LIMIT)

        if df_med.empty or df_short.empty:
            print("[!] Could not fetch data properly, skipping this cycle.")
            time.sleep(LOOP_INTERVAL)
            continue

        # 2) Compute indicators
        df_med = compute_indicators(df_med, sma_period=SMA_PERIOD, rsi_period=RSI_PERIOD)
        df_short = compute_indicators(df_short, sma_period=SMA_PERIOD, rsi_period=RSI_PERIOD)

        # 3) If in a trade, check exit
        if bot.position_active:
            current_price = df_short.iloc[-1]["Close"]
            bot.check_exit(current_price)

        # 4) Look for new entries
        signal = strategy_decision(df_med, df_short, bot)
        if signal == "BUY":
            current_price = df_short.iloc[-1]["Close"]
            stop_loss = current_price * 0.99
            take_profit = current_price * 1.015
            bot.open_position("long", current_price, stop_loss, take_profit)
        elif signal == "SELL":
            current_price = df_short.iloc[-1]["Close"]
            stop_loss = current_price * 1.01
            take_profit = current_price * 0.985
            bot.open_position("short", current_price, stop_loss, take_profit)

        print(f"Balance so far: {bot.balance:.2f}")
        time.sleep(LOOP_INTERVAL)


if __name__ == "__main__":
    main_loop()

#!/usr/bin/env python3
"""
Python High-Frequency Bot with GMX Integration on Arbitrum.

- Paper trades by default using the existing "PaperTradingBot" class.
- If LIVE_TRADING=True, also attempts real GMX leveraged trades via PositionRouter.
"""

import os
import time
import requests
import pandas as pd
import numpy as np
import ta
from datetime import datetime
from flask import Flask, jsonify
from threading import Thread
from collections import deque  # for a fixed-size log buffer

# ----------------- GMX / Web3 CONFIG (EDIT THESE!) -----------------
LIVE_TRADING = False  # Set True to actually send trades to GMX
ARBITRUM_RPC = "https://arb1.arbitrum.io/rpc"  # or your custom Alchemy/Infura
PRIVATE_KEY = os.getenv("PRIVATE_KEY") or "0xyourprivatekeyHERE"  # put your private key (with 0x prefix)
ACCOUNT_ADDRESS = None  # will be derived from private key

# GMX contract addresses on Arbitrum (mainnet)
POSITION_ROUTER_ADDR = "0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868"
ROUTER_ADDR = "0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064"
READER_ADDR = "0x22199a49A999c351eF7927602CFB187ec3cae489"
VAULT_ADDR =  "0x489ee077994B6658eAfA855C308275EAd8097C4A"

# Collateral + Index tokens for ETH/USDT example
USDT_ADDR =  "0xfd086bC7CD5C481DCC9C85eBe478A1C0b69FCbb9"  # USDT
WETH_ADDR =  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"  # WETH (for ETH)

# We'll store ABIs in .json or inline. For brevity, placeholders here:
POSITION_ROUTER_ABI = []  # <--- LOAD the real JSON ABI
ROUTER_ABI = []           # <--- LOAD the real JSON ABI
USDT_ABI = []             # <--- Standard ERC20 ABI
# -------------------------------------------------------------------

# ------------------------------------------------------------------------------------
# BOT CONFIG
# ------------------------------------------------------------------------------------
BINANCE_API_BASE = "https://api.binance.com"
BINANCE_SYMBOL = "ETHUSDT"

# Short=1m, Medium=5m
SHORT_TIMEFRAME = "1m"
MEDIUM_TIMEFRAME = "5m"

SHORT_CANDLE_LIMIT = 200
MEDIUM_CANDLE_LIMIT = 200

# RSI thresholds
RSI_OVERSOLD = 45
RSI_OVERBOUGHT = 55

SMA_PERIOD = 5
RSI_PERIOD = 14

STARTING_BALANCE = 10000.00
RISK_PER_TRADE_PCT = 1.0

LOOP_INTERVAL = 5

# ------------------------------------------------------------------------------------
# FLASK + GLOBAL STATUS
# ------------------------------------------------------------------------------------
app = Flask(__name__)

status_data = {
    "balance": 0.0,
    "position": "NONE",
    "eth_price": 0.0,
    "sma": 0.0,
    "rsi": 0.0,
    "last_action": "NONE"
}

status_logs = deque(maxlen=50)

@app.route("/status")
def status():
    data = dict(status_data)
    data["logs"] = list(status_logs)
    return jsonify(data)

def log_message(msg):
    timestamp = datetime.utcnow().strftime("%H:%M:%S")
    line = f"[{timestamp}] {msg}"
    status_logs.append(line)
    print(line)

# ------------------------------------------------------------------------------------
# HELPER FUNCTIONS
# ------------------------------------------------------------------------------------
def fetch_binance_candles(symbol, interval, limit=200):
    """
    Fetch candlestick data (OHLCV) from Binance public API.
    Returns a DataFrame with columns: [timestamp, open, high, low, close, volume]
    """
    url = f"{BINANCE_API_BASE}/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        df_list = []
        for kline in data:
            df_list.append({
                "timestamp": kline[0],
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

        log_message(f"Fetched {len(df)} candles for {symbol} {interval}.")
        return df

    except Exception as e:
        log_message(f"Error fetching candles for {symbol} {interval}: {e}")
        return pd.DataFrame()

def compute_indicators(df, sma_period=20, rsi_period=14):
    """
    Compute SMA and RSI columns on a DataFrame.
    """
    if df.empty:
        log_message("compute_indicators: DataFrame is empty, skipping.")
        return df

    log_message(f"Computing indicators (SMA={sma_period}, RSI={rsi_period}) on {len(df)} rows.")

    df = df.rename(columns={
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume"
    })

    df["SMA"] = ta.trend.SMAIndicator(df["Close"], window=sma_period).sma_indicator()
    df["RSI"] = ta.momentum.RSIIndicator(df["Close"], window=rsi_period).rsi()

    return df

# ------------------------------------------------------------------------------------
# WEB3 SETUP (IF LIVE_TRADING)
# ------------------------------------------------------------------------------------
try:
    from web3 import Web3, exceptions

    web3 = Web3(Web3.HTTPProvider(ARBITRUM_RPC))
    if LIVE_TRADING:
        if not web3.is_connected():
            log_message("ERROR: Web3 not connected to Arbitrum. Check your RPC URL.")
        else:
            log_message("Connected to Arbitrum via Web3.")
        acct = web3.eth.account.from_key(PRIVATE_KEY)
        ACCOUNT_ADDRESS = acct.address
        log_message(f"Trading with account: {ACCOUNT_ADDRESS}")
    else:
        web3 = None
        acct = None
except ImportError:
    web3 = None
    acct = None
    log_message("web3.py not installed or import error. LIVE_TRADING will fail if set True.")

# ------------------------------------------------------------------------------------
# GMX CONNECTOR (REAL TRADES OR SIMULATIONS)
# ------------------------------------------------------------------------------------
class GMXConnector:
    def __init__(self, web3, account, do_live=False):
        self.web3 = web3
        self.account = account
        self.do_live = do_live

        if self.web3 and self.do_live:
            # Initialize contract objects
            self.position_router = self.web3.eth.contract(
                address=Web3.to_checksum_address(POSITION_ROUTER_ADDR),
                abi=POSITION_ROUTER_ABI
            )
            self.router = self.web3.eth.contract(
                address=Web3.to_checksum_address(ROUTER_ADDR),
                abi=ROUTER_ABI
            )
            self.usdt = self.web3.eth.contract(
                address=Web3.to_checksum_address(USDT_ADDR),
                abi=USDT_ABI
            )
        else:
            self.position_router = None
            self.router = None
            self.usdt = None

    def approve_plugin(self):
        """One-time plugin approval: Router.approvePlugin(PositionRouter)."""
        if not self.do_live:
            log_message("Simulate: approvePlugin -> no real tx sent.")
            return

        try:
            nonce = self.web3.eth.get_transaction_count(self.account.address)
            tx = self.router.functions.approvePlugin(POSITION_ROUTER_ADDR).buildTransaction({
                'from': self.account.address,
                'nonce': nonce,
                'gas': 100000,
                'chainId': 42161
            })
            signed = self.account.sign_transaction(tx)
            tx_hash = self.web3.eth.send_raw_transaction(signed.rawTransaction)
            self.web3.eth.wait_for_transaction_receipt(tx_hash)
            log_message(f"Plugin approved! tx={tx_hash.hex()}")
        except exceptions.ContractLogicError as e:
            log_message(f"[!] Plugin approval error: {e}")
        except Exception as e:
            log_message(f"[!] Plugin approval unknown error: {e}")

    def approve_usdt(self, amount):
        """Approve Router to spend USDT (amount in USDT's decimals)."""
        if not self.do_live:
            log_message(f"Simulate: USDT.approve(router, {amount}) -> no real tx sent.")
            return

        try:
            nonce = self.web3.eth.get_transaction_count(self.account.address)
            tx = self.usdt.functions.approve(ROUTER_ADDR, amount).buildTransaction({
                'from': self.account.address,
                'nonce': nonce,
                'gas': 100000,
                'chainId': 42161
            })
            signed = self.account.sign_transaction(tx)
            tx_hash = self.web3.eth.send_raw_transaction(signed.rawTransaction)
            self.web3.eth.wait_for_transaction_receipt(tx_hash)
            log_message(f"USDT approved for Router! tx={tx_hash.hex()}")
        except Exception as e:
            log_message(f"[!] USDT approval error: {e}")

    def open_gmx_position(self, side, collateral_usdt, leverage_usd):
        """
        side: "long" or "short"
        collateral_usdt: how many USDT (int)
        leverage_usd: total notional e.g. 5x => if you put 200 USDT, size=1000
        """
        if not self.do_live:
            log_message(f"Simulate GMX open {side}: Collateral={collateral_usdt} USDT, Notional={leverage_usd} USD.")
            return

        # Setup the call to positionRouter.createIncreasePosition(...)
        # 1) minExecutionFee
        try:
            min_exec_fee = self.position_router.functions.minExecutionFee().call()
        except Exception as e:
            log_message(f"[!] Could not fetch minExecutionFee: {e}")
            return

        # For a long, indexToken = WETH, for short also WETH on GMX but isLong=False
        is_long = (side == "long")

        # Acceptable price (rough example)
        # Suppose current ~2000, let's do +1% if long, -1% if short
        if is_long:
            acceptable_price = int(1.01 * 2000 * 10**30)
        else:
            acceptable_price = int(0.99 * 2000 * 10**30)

        # sizeDelta in 1e30
        size_delta = int(leverage_usd * 10**30)
        amount_in = collateral_usdt  # USDT has 6 decimals => e.g. 200 -> 200e6
        path = [Web3.to_checksum_address(USDT_ADDR)]
        min_out = 0
        referral_code = b'\x00'*32
        callback_target = "0x0000000000000000000000000000000000000000"

        # Build TX
        nonce = self.web3.eth.get_transaction_count(self.account.address)
        tx = self.position_router.functions.createIncreasePosition(
            path,
            Web3.to_checksum_address(WETH_ADDR),  # indexToken = WETH
            amount_in,
            min_out,
            size_delta,
            is_long,
            acceptable_price,
            min_exec_fee,
            referral_code,
            callback_target
        ).buildTransaction({
            'from': self.account.address,
            'value': min_exec_fee,  # pay exec fee in ETH
            'nonce': nonce,
            'gas': 500000,
            'chainId': 42161
        })

        # Sign & send
        signed = self.account.sign_transaction(tx)
        tx_hash = self.web3.eth.send_raw_transaction(signed.rawTransaction)
        log_message(f"GMX IncreasePosition sent, tx={tx_hash.hex()} (Side={side}, Collat={amount_in}, Size={leverage_usd})")

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
        risk_amount = self.balance * (self.risk_pct / 100.0)
        if stop_distance <= 0:
            return 0
        size = risk_amount / stop_distance
        return round(size, 4)

    def open_position(self, side, entry_price, stop_loss, take_profit):
        if self.position_active:
            log_message("[!] Already in a position, cannot open a new one.")
            return

        self.position_active = True
        self.position_side = side
        self.entry_price = entry_price
        self.stop_loss = stop_loss
        self.take_profit = take_profit

        stop_dist = abs(entry_price - stop_loss)
        self.position_size = self.calculate_position_size(stop_dist)

        log_message(f"TRADE OPEN {side.upper()} @ ${entry_price:.2f}, "
                    f"Stop={stop_loss:.2f}, TP={take_profit:.2f}, Size={self.position_size}")

    def check_exit(self, current_price):
        if not self.position_active:
            return

        if self.position_side == "long":
            if current_price <= self.stop_loss:
                log_message(f"check_exit: LONG STOP triggered @ {current_price:.2f}.")
                self.close_position(current_price, hit_stop=True)
            elif current_price >= self.take_profit:
                log_message(f"check_exit: LONG TAKE-PROFIT triggered @ {current_price:.2f}.")
                self.close_position(current_price, hit_stop=False)
        elif self.position_side == "short":
            if current_price >= self.stop_loss:
                log_message(f"check_exit: SHORT STOP triggered @ {current_price:.2f}.")
                self.close_position(current_price, hit_stop=True)
            elif current_price <= self.take_profit:
                log_message(f"check_exit: SHORT TAKE-PROFIT triggered @ {current_price:.2f}.")
                self.close_position(current_price, hit_stop=False)

    def close_position(self, close_price, hit_stop=False):
        if not self.position_active:
            return

        if self.position_side == "long":
            profit = (close_price - self.entry_price) * self.position_size
        else:
            profit = (self.entry_price - close_price) * self.position_size

        self.balance += profit
        log_message(f"TRADE CLOSE {self.position_side.upper()} @ ${close_price:.2f} "
                    f"{'STOP' if hit_stop else 'TP'} hit. PNL={profit:.2f}, "
                    f"New Balance={self.balance:.2f}")

        self.position_active = False
        self.position_side = None
        self.entry_price = 0.0
        self.position_size = 0.0
        self.stop_loss = 0.0
        self.take_profit = 0.0

# ------------------------------------------------------------------------------------
# STRATEGY
# ------------------------------------------------------------------------------------
def strategy_decision(df_med, df_short, bot: PaperTradingBot):
    """1) 5m SMA for 'trend'  2) 1m RSI for entry signals."""
    if df_med.empty or df_short.empty:
        return "NONE"

    last_med = df_med.iloc[-1]
    sma_value = last_med["SMA"]
    current_price_med = last_med["Close"]
    if pd.isna(sma_value):
        return "NONE"

    # If price above 5m SMA => uptrend; else downtrend
    medium_trend = "UP" if current_price_med > sma_value else "DOWN"

    last_short = df_short.iloc[-1]
    rsi_value = last_short["RSI"]
    current_price_short = last_short["Close"]
    if pd.isna(rsi_value):
        return "NONE"

    if bot.position_active:
        return "NONE"

    if medium_trend == "UP" and rsi_value < RSI_OVERSOLD:
        log_message(f"Signal: BUY (Uptrend + RSI={rsi_value:.2f})")
        return "BUY"
    elif medium_trend == "DOWN" and rsi_value > RSI_OVERBOUGHT:
        log_message(f"Signal: SELL (Downtrend + RSI={rsi_value:.2f})")
        return "SELL"

    log_message(f"Signal: NONE (Trend={medium_trend}, RSI={rsi_value:.2f})")
    return "NONE"

# ------------------------------------------------------------------------------------
# MAIN LOOP
# ------------------------------------------------------------------------------------
def main_loop():
    # Paper trading bot
    bot = PaperTradingBot(STARTING_BALANCE, RISK_PER_TRADE_PCT)

    # If we want GMX integration
    try:
        gmx = GMXConnector(web3, acct, do_live=LIVE_TRADING)
    except NameError:
        # If 'web3' or 'acct' doesn't exist, that means the import failed
        gmx = None

    log_message("----- BOT STARTED (HIGH FREQUENCY, 1M) -----")
    log_message(f"Starting Balance: ${bot.balance:.2f}")
    status_data.update({
        "balance": round(bot.balance, 2),
        "position": "NONE",
        "eth_price": 0.0,
        "sma": 0.0,
        "rsi": 0.0,
        "last_action": "NONE"
    })

    # (Optional) Approvals if we want to do real trades. Only do once, or check if needed
    if LIVE_TRADING and gmx and gmx.do_live:
        gmx.approve_plugin()
        # e.g. approve 1000 USDT
        gmx.approve_usdt(1000 * 10**6)

    while True:
        log_message("=== NEW CYCLE: Fetching Candle Data ===")
        df_med = fetch_binance_candles(BINANCE_SYMBOL, MEDIUM_TIMEFRAME, limit=MEDIUM_CANDLE_LIMIT)
        df_short = fetch_binance_candles(BINANCE_SYMBOL, SHORT_TIMEFRAME, limit=SHORT_CANDLE_LIMIT)

        if df_med.empty or df_short.empty:
            log_message("[!] Could not fetch data properly, skipping cycle.")
            time.sleep(LOOP_INTERVAL)
            continue

        df_med = compute_indicators(df_med, sma_period=SMA_PERIOD, rsi_period=RSI_PERIOD)
        df_short = compute_indicators(df_short, sma_period=SMA_PERIOD, rsi_period=RSI_PERIOD)

        if bot.position_active:
            current_price = df_short.iloc[-1]["Close"]
            bot.check_exit(current_price)

        # Evaluate new trade signals
        signal = strategy_decision(df_med, df_short, bot)
        if signal == "BUY":
            current_price = df_short.iloc[-1]["Close"]
            stop_loss = current_price * 0.995
            take_profit = current_price * 1.005

            # Paper trade
            bot.open_position("long", current_price, stop_loss, take_profit)

            # Also GMX real trade if enabled
            if LIVE_TRADING and gmx and gmx.do_live:
                collateral = 200 * 10**6  # e.g. 200 USDT
                size_usd  = 1000          # => 5x if 200 USDT collat
                gmx.open_gmx_position("long", collateral, size_usd)

        elif signal == "SELL":
            current_price = df_short.iloc[-1]["Close"]
            stop_loss = current_price * 1.005
            take_profit = current_price * 0.995

            # Paper trade
            bot.open_position("short", current_price, stop_loss, take_profit)

            if LIVE_TRADING and gmx and gmx.do_live:
                collateral = 200 * 10**6
                size_usd  = 1000
                gmx.open_gmx_position("short", collateral, size_usd)

        # Update status
        current_price = df_short.iloc[-1]["Close"]
        status_data.update({
            "balance": round(bot.balance, 2),
            "position": bot.position_side or "NONE",
            "eth_price": round(current_price, 2),
            "sma": round(df_med.iloc[-1]["SMA"], 2),
            "rsi": round(df_short.iloc[-1]["RSI"], 2),
            "last_action": signal if signal != "NONE" else status_data["last_action"]
        })

        log_message(f"Cycle complete. Current price={current_price:.2f}, Balance={bot.balance:.2f}")
        time.sleep(LOOP_INTERVAL)

# ------------------------------------------------------------------------------------
# ENTRY POINT
# ------------------------------------------------------------------------------------
if __name__ == "__main__":
    bot_thread = Thread(target=main_loop, daemon=True)
    bot_thread.start()
    app.run(host="0.0.0.0", port=8080)

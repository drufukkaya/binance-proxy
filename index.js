import express from "express";
import axios from "axios";
import cors from "cors";
import morgan from "morgan";

const app = express();
const PORT = process.env.PORT || 3000;
const BINANCE = "https://api.binance.com";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// ---- helpers (TA) ----
const ema = (arr, p) => {
  if (!arr?.length) return [];
  const k = 2 / (p + 1);
  const out = new Array(arr.length).fill(null);
  out[0] = arr[0];
  for (let i = 1; i < arr.length; i++) out[i] = arr[i] * k + out[i - 1] * (1 - k);
  return out;
};
const rsi = (close, len = 14) => {
  if (close.length < len + 1) return Array(close.length).fill(null);
  const gains = [], losses = [];
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    gains.push(Math.max(0, d));
    losses.push(Math.max(0, -d));
  }
  const avgGain = ema(gains, len);
  const avgLoss = ema(losses, len);
  const out = Array(close.length).fill(null);
  for (let i = 0; i < avgGain.length; i++) {
    const g = avgGain[i], l = avgLoss[i];
    if (g == null  l == null  l === 0) continue;
    const rs = g / l;
    out[i + 1] = 100 - 100 / (1 + rs);
  }
  return out;
};
const macd = (close, f = 12, s = 26, sig = 9) => {
  const e12 = ema(close, f);
  const e26 = ema(close, s);
  const macd = close.map((_, i) =>
    e12[i] == null || e26[i] == null ? null : e12[i] - e26[i]
  );
  const signal = ema(macd.map(v => (v == null ? 0 : v)), sig);
  const hist = macd.map((v, i) => (v == null || signal[i] == null ? null : v - signal[i]));
  return { macd, signal, hist };
};
const sma = (arr, n) => {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
};
const std = (arr, n, ma) => {
  const out = new Array(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    if (i < n - 1 || ma[i] == null) continue;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += Math.pow(arr[j] - ma[i], 2);
    out[i] = Math.sqrt(v / n);
  }
  return out;
};
const bb = (close, n = 20, k = 2) => {
  const m = sma(close, n);
  const s = std(close, n, m);
  const upper = close.map((_, i) => (m[i] == null || s[i] == null ? null : m[i] + k * s[i]));
  const lower = close.map((_, i) => (m[i] == null || s[i] == null ? null : m[i] - k * s[i]));
  const bbp = close.map((c, i) =>
    m[i] == null  upper[i] == null  lower[i] == null || (upper[i] - lower[i]) === 0
      ? null
      : (c - lower[i]) / (upper[i] - lower[i])
  );
  return { mid: m, upper, lower, bbp };
};
const adx = (high, low, close, n = 14) => {
  const len = close.length;
  const plusDM = new Array(len).fill(0);
  const minusDM = new Array(len).fill(0);
  const TR = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    TR[i] = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
  }
  const ATR = sma(TR, n);
  const plusDI = plusDM.map((v, i) => (ATR[i] ? (100 * sma(plusDM, n)[i]) / ATR[i] : null));
  const minusDI = minusDM.map((v, i) => (ATR[i] ? (100 * sma(minusDM, n)[i]) / ATR[i] : null));
  const DX = plusDI.map((p, i) => {
    const m = minusDI[i];
    if (p == null  m == null  (p + m) === 0) return null;
    return (100 * Math.abs(p - m)) / (p + m);
  });
  const ADX = sma(DX, n);
  return { plusDI, minusDI, ADX };
};

// ---- upstream helpers ----
const api = axios.create({
  baseURL: BINANCE,
  timeout: 20000,
  headers: { "user-agent": "smartscore/1.0" }
});

// ---- endpoints ----
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));
// USDT spot pariteleri (kaldıraç tokenlar hariç)
app.get("/coins", async (req, res) => {
  try {
    const { data } = await api.get("/api/v3/exchangeInfo");
    const bad = ["UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT"];
    const out = data.symbols
      .filter(s =>
        s.status === "TRADING" &&
        s.isSpotTradingAllowed &&
        s.symbol.endsWith("USDT") &&
        !bad.some(b => s.symbol.endsWith(b))
      )
      .map(s => s.symbol);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "exchangeInfo failed", details: e?.message || e.toString() });
  }
});

// 24h ticker (ham)
app.get("/ticker24", async (req, res) => {
  try {
    const { data } = await api.get("/api/v3/ticker/24hr");
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "ticker/24hr failed", details: e?.message || e.toString() });
  }
});

// Klines proxy
app.get("/api/klines", async (req, res) => {
  try {
    const { symbol, interval, limit } = req.query;
    if (!symbol || !interval) return res.status(400).json({ error: "symbol & interval required" });
    const { data } = await api.get("/api/v3/klines", { params: { symbol, interval, limit: Math.min(+limit || 500, 1000) } });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "klines failed", details: e?.message || e.toString() });
  }
});

// Tek sembol indikatör (son mum setinden hesap)
app.get("/indicators", async (req, res) => {
  try {
    const symbol   = req.query.symbol || "BTCUSDT";
    const interval = req.query.interval || "1h";
    const limit    = Math.min(parseInt(req.query.limit || "300", 10), 1000);

    const { data } = await api.get("/api/v3/klines", { params: { symbol, interval, limit } });
    if (!Array.isArray(data) || data.length < 60) return res.status(422).json({ error: "not_enough_data" });

    const open  = data.map(r => +r[1]);
    const high  = data.map(r => +r[2]);
    const low   = data.map(r => +r[3]);
    const close = data.map(r => +r[4]);
    const vol   = data.map(r => +r[5]);
    const closeTime = data.map(r => r[6]);

    const rsi14 = rsi(close, 14);
    const { macd: macdLine, signal, hist } = macd(close, 12, 26, 9);
    const { mid: bbmid, upper: bbup, lower: bblow, bbp } = bb(close, 20, 2);
    const { plusDI, minusDI, ADX } = adx(high, low, close, 14);

    const i = close.length - 1;
    res.json({
      symbol, interval, length: close.length,
      close: close[i], volume: vol[i], closeTime: closeTime[i],
      rsi14: rsi14[i] ?? null,
      macd: macdLine[i] ?? null, macd_signal: signal[i] ?? null, macd_hist: hist[i] ?? null,
      bb_mid: bbmid[i] ?? null, bb_upper: bbup[i] ?? null, bb_lower: bblow[i] ?? null, bbp: bbp[i] ?? null,
      plus_di: plusDI[i] ?? null, minus_di: minusDI[i] ?? null, adx14: ADX[i] ?? null
    });
  } catch (e) {
    res.status(500).json({ error: "indicators failed", details: e?.message || e.toString() });
  }
});

// Çoklu timeframe tek cevap
app.get("/indicators/multi", async (req, res) => {
  try {
    const symbol = req.query.symbol || "BTCUSDT";
    const intervals = (req.query.intervals || "15m,1h,4h,1d,1w,1M").split(",").map(s => s.trim());
    const limit = Math.min(parseInt(req.query.limit || "300", 10), 1000);

    const out = {};
    for (const iv of intervals) {
      const { data } = await api.get("/api/v3/klines", { params: { symbol, interval: iv, limit } });
      if (!Array.isArray(data) || data.length < 60) { out[iv] = { error: "not_enough_data" }; continue; }
      const open  = data.map(r => +r[1]);
      const high  = data.map(r => +r[2]);
      const low   = data.map(r => +r[3]);
      const close = data.map(r => +r[4]);
      const vol   = data.map(r => +r[5]);
      const ct    = data.map(r => r[6]);

      const rsi14 = rsi(close,14);
      const { macd: ml, signal: sg, hist: hs } = macd(close,12,26,9);
      const { mid, upper, lower, bbp } = bb(close,20,2);
      const { plusDI, minusDI, ADX } = adx(high, low, close,14);
      const i = close.length - 1;

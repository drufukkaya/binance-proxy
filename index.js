// Modüller
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

// Sunucu ayarları
const app = express();
const PORT = process.env.PORT || 3000;
const BINANCE = "https://api.binance.com";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// ===== Helpers (TA) =====
const ema = (arr, p) => {
    if (!arr || arr.length < p) return [];
    const k = 2 / (p + 1);
    const out = new Array(arr.length).fill(null);
    out[0] = arr[0];
    for (let i = 1; i < arr.length; i++) {
        out[i] = arr[i] * k + out[i - 1] * (1 - k);
    }
    return out;
};

const rsi = (close, len = 14) => {
    if (close.length < len + 1) return [];
    const gains = [];
    const losses = [];
    for (let i = 1; i < close.length; i++) {
        const diff = close[i] - close[i - 1];
        gains.push(Math.max(diff, 0));
        losses.push(Math.max(-diff, 0));
    }
    let avgGain = gains.slice(0, len).reduce((a, b) => a + b, 0) / len;
    let avgLoss = losses.slice(0, len).reduce((a, b) => a + b, 0) / len;
    const rsis = [100 - 100 / (1 + avgGain / avgLoss)];
    for (let i = len; i < gains.length; i++) {
        avgGain = (avgGain * (len - 1) + gains[i]) / len;
        avgLoss = (avgLoss * (len - 1) + losses[i]) / len;
        rsis.push(100 - 100 / (1 + avgGain / avgLoss));
    }
    return rsis;
};

// ===== API endpoint =====
app.get("/", (req, res) => {
    res.json({ message: "Server çalışıyor 🚀" });
});

// Sunucu başlat
app.listen(PORT, () => {
    console.log(Server http://localhost:${PORT} üzerinde çalışıyor);
});

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/prices', async (req, res) => {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price');
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Binance verisi alınamadı', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(Proxy server is running on port ${PORT});
});

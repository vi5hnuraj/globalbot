let inMemoryRateCache = null;
let inMemoryRateCacheTime = 0;

let inMemoryBotPriceCache = null;
let inMemoryBotPriceCacheTime = 0;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches live fiat exchange rates against USD with 5-minute caching.
 * Throws a financial integrity error if rates cannot be retrieved.
 */
export const getLiveExchangeRates = async () => {
  if (inMemoryRateCache && (Date.now() - inMemoryRateCacheTime < CACHE_TTL_MS)) {
    return inMemoryRateCache;
  }

  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD');
    if (res.ok) {
      const data = await res.json();
      const rates = { USD: 1.0, ...data.rates };
      inMemoryRateCache = rates;
      inMemoryRateCacheTime = Date.now();
      return rates;
    }
  } catch (err) {
    console.warn("[LiveRateService] Primary exchange rate API warning:", err.message);
  }

  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (res.ok) {
      const data = await res.json();
      inMemoryRateCache = data.rates;
      inMemoryRateCacheTime = Date.now();
      return data.rates;
    }
  } catch (err) {
    console.warn("[LiveRateService] Secondary exchange rate API warning:", err.message);
  }

  if (inMemoryRateCache) {
    return inMemoryRateCache;
  }

  throw new Error("FINANCIAL_ERROR: Live fiat exchange rates unavailable. Financial transaction rejected to prevent price slippage.");
};

/**
 * Fetches the live BOTUSDT price from Coinstore. A cached result is used only
 * when the ticker is temporarily unavailable; no fixed BOT/USD rate is used.
 */
export const getLiveBotPrice = async () => {
  if (inMemoryBotPriceCache && (Date.now() - inMemoryBotPriceCacheTime < CACHE_TTL_MS)) {
    return inMemoryBotPriceCache;
  }

  try {
    const res = await fetch('https://api.coinstore.com/api/v1/ticker/price?symbol=BOTUSDT');
    if (res.ok) {
      const data = await res.json();
      const tickerList = Array.isArray(data?.data) ? data.data : (data?.data ? [data.data] : []);
      const ticker = tickerList.find((item) => item?.symbol === 'BOTUSDT');
      if (ticker?.price) {
        const price = Number(ticker.price);
        if (!isNaN(price) && price > 0) {
          inMemoryBotPriceCache = price;
          inMemoryBotPriceCacheTime = Date.now();
          return price;
        }
      }
    }
  } catch (err) {
    console.warn("[LiveRateService] Coinstore BOTUSDT API warning:", err.message);
  }

  if (inMemoryBotPriceCache) {
    return inMemoryBotPriceCache;
  }

  throw new Error("FINANCIAL_ERROR: Live BOTUSDT price unavailable. Please try again shortly.");
};

/**
 * Converts a fiat amount in target currency to BOT amount using live rates
 */
export const convertFiatToBot = async (amount, currencyCode = 'INR') => {
  const rates = await getLiveExchangeRates();
  const botPrice = await getLiveBotPrice();

  const rate = rates[currencyCode.toUpperCase()] || rates['INR'] || 83.5;
  const usdValue = Number(amount) / rate;
  const botAmount = usdValue / botPrice;

  return {
    usdValue: parseFloat(usdValue.toFixed(4)),
    botAmount: parseFloat(botAmount.toFixed(6)),
    exchangeRate: rate,
    botPrice: botPrice
  };
};

import { NextResponse } from "next/server";

const FALLBACK_PRICES = {
  ethereum: 100,
  bitcoin: 65000,
  solana: 150
};

export async function GET() {
  const ids = Object.keys(FALLBACK_PRICES).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;

  try {
    const response = await fetch(url, {
      next: { revalidate: 60 },
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("CoinGecko unavailable");
    }

    const data = await response.json();
    return NextResponse.json({
      source: "coingecko",
      prices: {
        ethereum: Number(data.ethereum?.usd ?? FALLBACK_PRICES.ethereum),
        bitcoin: Number(data.bitcoin?.usd ?? FALLBACK_PRICES.bitcoin),
        solana: Number(data.solana?.usd ?? FALLBACK_PRICES.solana)
      }
    });
  } catch {
    return NextResponse.json({
      source: "fallback",
      prices: FALLBACK_PRICES
    });
  }
}

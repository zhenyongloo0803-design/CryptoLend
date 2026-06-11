import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const prisma = getPrisma();
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");

  const history = await prisma.repayTransaction.findMany({
    where: wallet ? { walletAddress: wallet } : undefined,
    orderBy: { createdAt: "desc" },
    take: 20
  });

  return NextResponse.json(history);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { walletAddress, amount, interestPaid = "0", principalPaid = "0", txHash } = body;

  if (!walletAddress || !amount || !txHash) {
    return NextResponse.json({ message: "Missing repay history fields" }, { status: 400 });
  }

  const prisma = getPrisma();
  const record = await prisma.repayTransaction.upsert({
    where: { txHash },
    update: {},
    create: {
      walletAddress,
      amount,
      interestPaid,
      principalPaid,
      txHash
    }
  });

  return NextResponse.json(record, { status: 201 });
}

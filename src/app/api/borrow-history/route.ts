import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export async function GET() {
  const prisma = getPrisma();
  const history = await prisma.borrowTransaction.findMany({
    orderBy: { createdAt: "desc" },
    take: 20
  });

  return NextResponse.json(history);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { walletAddress, collateralAmount, borrowAmount, txHash } = body;

  if (!walletAddress || !collateralAmount || !borrowAmount || !txHash) {
    return NextResponse.json({ message: "Missing borrow history fields" }, { status: 400 });
  }

  const prisma = getPrisma();
  const record = await prisma.borrowTransaction.upsert({
    where: { txHash },
    update: {},
    create: {
      walletAddress,
      collateralAmount,
      borrowAmount,
      txHash
    }
  });

  return NextResponse.json(record, { status: 201 });
}

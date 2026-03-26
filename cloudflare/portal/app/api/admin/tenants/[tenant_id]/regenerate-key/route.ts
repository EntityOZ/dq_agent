import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const WORKER_URL =
  process.env.LICENCE_WORKER_URL || "https://licence.meridian.vantax.co.za";
const ADMIN_SECRET = process.env.LICENCE_ADMIN_SECRET || "";

type Params = Promise<{ tenant_id: string }>;

export async function POST(_req: NextRequest, { params }: { params: Params }) {
  const { sessionClaims } = await auth();
  const isAdmin =
    (sessionClaims?.publicMetadata as { is_meridian_admin?: boolean })
      ?.is_meridian_admin === true;
  if (!isAdmin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { tenant_id } = await params;
  const resp = await fetch(
    `${WORKER_URL}/api/admin/tenants/${tenant_id}/regenerate-key`,
    { method: "POST", headers: { "X-Admin-Secret": ADMIN_SECRET } }
  );
  return NextResponse.json(await resp.json(), { status: resp.status });
}
